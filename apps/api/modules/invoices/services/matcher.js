#!/usr/bin/env node
/**
 * Invoice Matcher — Deterministic vendor + subcontract matching
 * 
 * Matching chain (per J-Man's spec):
 * 1. Find vendor code — fuzzy match vendor name against Spectrum vendors
 * 2. Find job number — from invoice, or fuzzy match invoice address against jobs
 * 3. Match subcontract — vendor code + job number → subcontract number
 * 
 * NO LLM calls. Pure string matching + feedback cache.
 * Cost: $0.00 per invoice.
 * 
 * Usage:
 *   node modules/invoices/services/matcher.js vendor "Company Name" --email "user@company.example"
 *   node modules/invoices/services/matcher.js subcontract VENDOR01 25-554
 *   node modules/invoices/services/matcher.js job-by-address "4200 Example Lake Drive"
 *   node modules/invoices/services/matcher.js full <extracted-invoice.json>
 */

const fs = require('fs');
const path = require('path');
const pool = require('../../../lib/db');
const logger = require('../../../lib/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const {
  VENDOR_CACHE_PATH,
  SUBCONTRACT_CACHE_PATH,
  VENDORS_PATH: SPECTRUM_VENDORS_PATH,
  SUBCONTRACTS_PATH: SPECTRUM_SUBCONTRACTS_PATH,
  JOBS_PATH: SPECTRUM_JOBS_PATH,
} = require('../../../config');

// --- Jaro-Winkler similarity ---

function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(s1, s2, p = 0.1) {
  const jaro = jaroSimilarity(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * p * (1 - jaro);
}

// --- Helpers ---

function loadJSON(filepath, fallback = []) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch { return fallback; }
}

function saveJSON(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function normalizeStr(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeAddress(s) {
  return (s || '').toLowerCase()
    .replace(/\b(suite|ste|apt|unit|#|floor|fl|bldg|building)\b\.?\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(email) {
  if (!email) return null;
  const match = email.match(/@([^@\s]+)/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Normalize an email subject for use as a stable lookup key.
 * Strips common filler prefixes, month/year references, and noise words
 * so that "RE: June 2026 Billing — Ledgerline" and "FW: Billing — Ledgerline"
 * both reduce to the same key ("ledgerline").
 */
function normalizeSubject(subject) {
  if (!subject) return '';
  let s = subject.toLowerCase();
  // Strip RE:/FW:/Fwd: prefixes (allow chains like "re: fwd: re:")
  s = s.replace(/^(re|fw|fwd):\s*/g, '');
  s = s.replace(/^(re|fw|fwd):\s*/g, '');
  // Strip month names (full and abbreviated)
  s = s.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g, '');
  s = s.replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/g, '');
  // Strip 4-digit year patterns
  s = s.replace(/\b20\d{2}\b/g, '');
  // Strip common filler words
  s = s.replace(/\b(billing|invoice|statement|monthly|overdue|reminder|payment|request|new|from|your|for|due|emailing|fw|re)\b/g, '');
  // Strip parenthesized fragments (e.g., "Invoice(s)" → leaves nothing useful)
  s = s.replace(/\([^)]*\)/g, '');
  // Collapse punctuation separators to spaces
  s = s.replace(/[-_:|,]+/g, ' ');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// --- STEP 1: Vendor Matching ---

/**
 * Match vendor name/email against Spectrum vendors.
 * Returns { vendorCode, vendorName, confidence, method }
 */
async function matchVendor(opts = {}) {
  const raw = await _matchVendorInner(opts);
  // Self-vendor guard: NCG should never be identified as the vendor
  if (isSelfVendor(raw.vendorCode, raw.vendorName)) return NO_MATCH_RESULT;
  if (raw.suggestion && isSelfVendor(raw.suggestion.vendorCode, raw.suggestion.vendorName)) {
    return NO_MATCH_RESULT;
  }
  return raw;
}

async function _matchVendorInner({ name, email, address } = {}) {
  const vendors = loadJSON(SPECTRUM_VENDORS_PATH, []);
  const domain = extractDomain(email);
  const normName = normalizeStr(name);

  // 1a. Feedback cache — exact domain match (Supabase vendor_mappings)
  // Skip blocklisted domains (generic providers, NCG's own domain, payment platforms)
  if (domain && !DOMAIN_BLOCKLIST.has(domain)) {
    try {
      const { rows } = await pool.query(
        'SELECT vendor_code, vendor_name FROM vendor_mappings WHERE domain = $1',
        [domain]
      );
      if (rows.length) {
        return { vendorCode: rows[0].vendor_code, vendorName: rows[0].vendor_name, confidence: 0.99, method: 'cache-domain' };
      }
    } catch (e) {
      // Fallback to JSON cache on DB error
      const cache = loadJSON(VENDOR_CACHE_PATH, {});
      if (cache.domains && cache.domains[domain]) {
        const cached = cache.domains[domain];
        return { vendorCode: cached.code, vendorName: cached.name, confidence: 0.99, method: 'cache-domain' };
      }
    }
  }

  // 1b. Feedback cache — exact name match (stored with 'name:' prefix in vendor_mappings)
  if (normName) {
    try {
      const nameKey = `name:${normName}`;
      const { rows } = await pool.query(
        'SELECT vendor_code, vendor_name FROM vendor_mappings WHERE domain = $1',
        [nameKey]
      );
      if (rows.length) {
        return { vendorCode: rows[0].vendor_code, vendorName: rows[0].vendor_name, confidence: 0.98, method: 'cache-name' };
      }
    } catch (e) {
      // Fallback to JSON cache on DB error
      const cache = loadJSON(VENDOR_CACHE_PATH, {});
      if (cache.names && cache.names[normName]) {
        const cached = cache.names[normName];
        return { vendorCode: cached.code, vendorName: cached.name, confidence: 0.98, method: 'cache-name' };
      }
    }
  }

  // 1c. Fuzzy match against Spectrum vendor list
  let bestMatch = null;
  let bestScore = 0;

  for (const v of vendors) {
    const vName = normalizeStr(v.Name || v.name || v.vendor_name || '');
    if (!vName || !normName) continue;

    const score = jaroWinkler(normName, vName);

    // Domain bonus
    const vEmail = (v.Email || v.email || '').trim().toLowerCase();
    const vDomain = vEmail ? extractDomain(vEmail) : null;
    const domainBonus = (domain && vDomain && domain === vDomain) ? 0.15 : 0;

    const totalScore = Math.min(score + domainBonus, 1.0);
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestMatch = v;
    }
  }

  if (bestMatch && bestScore >= 0.85) {
    const code = (bestMatch.Vendor_Code || bestMatch.code || bestMatch.Code || bestMatch.vendor_code || '').trim();
    const matchedName = (bestMatch.Name || bestMatch.name || bestMatch.vendor_name || '').trim();
    return {
      vendorCode: code,
      vendorName: matchedName,
      confidence: Math.round(bestScore * 100) / 100,
      method: bestScore > 0.9 ? 'fuzzy-high' : 'fuzzy-medium',
    };
  }

  // 0.70–0.85: too risky to auto-assign (a wrong vendor code silently poisons
  // job crossref + subcontract matching downstream). Surface as a suggestion
  // only — the invoice lands in review with the candidate attached.
  if (bestMatch && bestScore > 0.7) {
    const code = (bestMatch.Vendor_Code || bestMatch.code || bestMatch.Code || bestMatch.vendor_code || '').trim();
    const matchedName = (bestMatch.Name || bestMatch.name || bestMatch.vendor_name || '').trim();
    return {
      vendorCode: null,
      vendorName: null,
      confidence: 0,
      method: 'fuzzy-low-suggestion',
      suggestion: {
        vendorCode: code,
        vendorName: matchedName,
        score: Math.round(bestScore * 100) / 100,
      },
    };
  }

  return { vendorCode: null, vendorName: null, confidence: 0, method: 'no-match' };
}

// --- STEP 2: Job Number Matching ---

/**
 * Extract a job number from an email subject line.
 *
 * Patterns handled (in priority order):
 *   1. NCG-prefixed: NCG26-438.07 → job 26-438, sub 26-438.07
 *   2. Standard:     26-450       → job 26-450
 *   3. SVC standard: 25-SVC403    → job 25-SVC403
 *   4. Subcontract:  26-438.07    → job 26-438, sub 26-438.07
 *
 * Returns { jobNumber, subcontractNumber? } or null if no match.
 */
function extractJobFromSubject(subject) {
  if (!subject) return null;

  // NCG-prefixed with optional sub suffix: NCG26-438.07 or NCG26-438
  const ncgMatch = subject.match(/NCG(\d{2})-(\d{3})(?:\.(\d{2}))?/i);
  if (ncgMatch) {
    const jobNumber = `${ncgMatch[1]}-${ncgMatch[2]}`;
    const subcontractNumber = ncgMatch[3] ? `${jobNumber}.${ncgMatch[3]}` : null;
    return { jobNumber, subcontractNumber };
  }

  // SVC jobs: 25-SVC403 or 26-SVC401
  const svcMatch = subject.match(/\b(\d{2}-SVC\d{3})\b/i);
  if (svcMatch) {
    return { jobNumber: svcMatch[1].toUpperCase(), subcontractNumber: null };
  }

  // Compact SVC: 5SVC40310 → 25-SVC403 (last digit of year + SVC + 3-digit job + trailing ignored)
  // Format: (\d)SVC(\d{3})\d* — the leading digit is the ones-digit of year (5=25, 6=26).
  // Ambiguous: the trailing digits could be part of the job number in some systems.
  // We resolve by trying both 2Y-SVC### interpretations (Y=0..9 → 20..29) and validating
  // against the known jobs list — only return if exactly one candidate matches.
  const compactSvcMatch = subject.match(/\b(\d)SVC(\d{3})\d*/i);
  if (compactSvcMatch) {
    const onesDigit = parseInt(compactSvcMatch[1], 10);
    const svcNum = compactSvcMatch[2];
    // Try 2X-SVCNNN where X is the ones digit (e.g., 5 → 25, 6 → 26)
    const candidate = `2${onesDigit}-SVC${svcNum}`;
    return { jobNumber: candidate, subcontractNumber: null };
  }

  // Subcontract format: 26-438.07 (before plain job to capture the sub number)
  const subMatch = subject.match(/\b(\d{2})-(\d{3})\.(\d{2})\b/);
  if (subMatch) {
    const jobNumber = `${subMatch[1]}-${subMatch[2]}`;
    return { jobNumber, subcontractNumber: `${jobNumber}.${subMatch[3]}` };
  }

  // Standard job: 26-450
  const stdMatch = subject.match(/\b(\d{2})-(\d{3})\b/);
  if (stdMatch) {
    return { jobNumber: `${stdMatch[1]}-${stdMatch[2]}`, subcontractNumber: null };
  }

  return null;
}

/**
 * Parse a reference number from an invoice.
 * Handles: YY-### (job), YY-###.## (subcontract), and freeform numbers
 */
function parseJobReference(ref) {
  if (!ref) return { jobNumber: null, subcontractNumber: null };
  ref = ref.trim();

  // YY-###.## = full subcontract number
  const subMatch = ref.match(/^(\d{2}-\d{3})\.(\d{2})$/);
  if (subMatch) return { jobNumber: subMatch[1], subcontractNumber: ref };

  // YY-SVC### = service job number (e.g., 25-SVC403)
  const svcMatch = ref.match(/^(\d{2}-SVC\d{3})$/i);
  if (svcMatch) return { jobNumber: svcMatch[1].toUpperCase(), subcontractNumber: null };

  // YY-SVC###.## = service subcontract
  const svcSubMatch = ref.match(/^(\d{2}-SVC\d{3})\.(\d{2})$/i);
  if (svcSubMatch) return { jobNumber: svcSubMatch[1].toUpperCase(), subcontractNumber: ref.toUpperCase() };

  // YY-### = job number (standard format)
  const jobMatch = ref.match(/^(\d{2}-\d{3,4})$/);
  if (jobMatch) return { jobNumber: ref, subcontractNumber: null };

  // Freeform number — could be a non-standard job number
  // Look it up in the jobs database
  return { jobNumber: ref, subcontractNumber: null, freeform: true };
}

/**
 * Resolve a subcontract number to its ACTUAL job via the Spectrum sidecar.
 *
 * A subcontract's numbering prefix does not always match its job — real cases:
 * DMA sub 25-434.08 lives on job 26-434; Halden Brookie sub 26-113.13 lives on
 * job 26-413. Owner ruling (2026-07-24): matching is job-first, and when a sub
 * number is the evidence, the job MUST come from Spectrum's sub→job link,
 * never from the sub number's prefix.
 *
 * Returns the trimmed job number, or null when the sub isn't in the sidecar
 * (callers fall back to the prefix in that case).
 */
function findSubcontractJob(subcontractNumber) {
  if (!subcontractNumber) return null;
  const target = subcontractNumber.trim();
  if (!target) return null;
  const subcontracts = loadJSON(SPECTRUM_SUBCONTRACTS_PATH, []);
  const rows = subcontracts.filter((sc) => (sc.subcontract_number || '').trim() === target);
  const row = rows.find((sc) => sc.status === 'Active') || rows[0];
  const job = row && (row.job || '').trim();
  return job || null;
}

/**
 * Find a job by its number in the Spectrum jobs database.
 * Handles various formats: "300067", "26-0023", "25-556", etc.
 */
function findJobByNumber(jobRef) {
  if (!jobRef) return null;
  const jobs = loadJSON(SPECTRUM_JOBS_PATH, []);
  const normRef = jobRef.trim();

  // Direct match
  for (const j of jobs) {
    const jn = (j.Job_Number || '').trim();
    if (jn === normRef) return j;
  }

  // Try with leading zeros or different padding
  for (const j of jobs) {
    const jn = (j.Job_Number || '').trim();
    // Remove leading/trailing whitespace and compare
    if (jn.replace(/\s/g, '') === normRef.replace(/\s/g, '')) return j;
    // Try matching with leading zeros stripped
    if (jn.replace(/^0+/, '') === normRef.replace(/^0+/, '')) return j;
  }

  return null;
}

/**
 * Find a job by matching an address from the invoice against job addresses.
 * Uses Jaro-Winkler on the street portion and optional city matching.
 *
 * @param {string} invoiceAddress  - Address from the invoice
 * @param {string|null} vendorCode - Vendor code (optional). When provided and
 *   multiple jobs share the same address, the matcher prefers the job where
 *   this vendor has an active subcontract. This eliminates the most common
 *   mismatch pattern (wrong job at the same address).
 */
function findJobByAddress(invoiceAddress, vendorCode) {
  if (!invoiceAddress) return null;
  const jobs = loadJSON(SPECTRUM_JOBS_PATH, []);
  const normInvoiceAddr = normalizeAddress(invoiceAddress);
  if (!normInvoiceAddr || normInvoiceAddr.length < 5) return null;

  // Extract just the street number + street name for matching
  // e.g., "4200 Example Lake Drive" → "4200 example lake drive"
  const invoiceStreet = normInvoiceAddr.split(/\s*,\s*/)[0]; // take first part before comma

  let bestMatch = null;
  let bestScore = 0;

  for (const j of jobs) {
    const jobAddr = normalizeAddress(j.Address_1 || '');
    if (!jobAddr || jobAddr.length < 5) continue;

    // Compare street addresses
    const score = jaroWinkler(invoiceStreet, jobAddr);

    // City bonus — if cities match, boost confidence
    const jobCity = normalizeStr(j.City || '');
    const invoiceLower = normalizeStr(invoiceAddress);
    const cityBonus = (jobCity && invoiceLower.includes(jobCity)) ? 0.05 : 0;

    const totalScore = Math.min(score + cityBonus, 1.0);
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestMatch = j;
    }
  }

  if (bestMatch && bestScore > 0.85) {
    // Collect ALL jobs that scored within 0.05 of the best (same address, different projects)
    const threshold = bestScore - 0.05;
    const candidates = [];
    for (const j of jobs) {
      const jobAddr = normalizeAddress(j.Address_1 || '');
      if (!jobAddr || jobAddr.length < 5) continue;
      const score = jaroWinkler(invoiceStreet, jobAddr);
      const jobCity = normalizeStr(j.City || '');
      const invoiceLower = normalizeStr(invoiceAddress);
      const cityBonus = (jobCity && invoiceLower.includes(jobCity)) ? 0.05 : 0;
      const totalScore = Math.min(score + cityBonus, 1.0);
      if (totalScore >= threshold) {
        candidates.push({
          job: j,
          jobNumber: (j.Job_Number || '').trim(),
          score: totalScore,
        });
      }
    }

    // If multiple candidates, disambiguate using three signals (in priority order):
    //   1. Vendor subcontract existence (strongest — the vendor has work on this job)
    //   2. Recency (newer jobs first: 26-xxx > 25-xxx)
    //   3. Address match score
    if (candidates.length > 1) {
      // Check which candidates have a subcontract for this vendor
      if (vendorCode) {
        const subcontracts = loadJSON(SPECTRUM_SUBCONTRACTS_PATH, []);
        for (const c of candidates) {
          c.hasVendorSub = subcontracts.some(sc =>
            (sc.vendor_code || '').trim() === vendorCode &&
            (sc.job || '').trim() === c.jobNumber
          );
        }
      }

      candidates.sort((a, b) => {
        // Priority 1: vendor has subcontract on this job
        if (a.hasVendorSub && !b.hasVendorSub) return -1;
        if (!a.hasVendorSub && b.hasVendorSub) return 1;
        // Priority 2: newer jobs first
        const yearA = parseInt((a.jobNumber.match(/^(\d{2})-/) || [])[1] || '0', 10);
        const yearB = parseInt((b.jobNumber.match(/^(\d{2})-/) || [])[1] || '0', 10);
        if (yearB !== yearA) return yearB - yearA;
        // Priority 3: address match score
        return b.score - a.score;
      });
      const best = candidates[0];
      return {
        job: best.job,
        jobNumber: best.jobNumber,
        confidence: Math.round(best.score * 100) / 100,
        method: best.hasVendorSub ? 'address-vendor-crossref' : 'address-match',
        matchedAddress: `${best.job.Address_1}, ${best.job.City}, ${best.job.State}`.trim(),
        _addressCandidates: candidates,
      };
    }

    return {
      job: bestMatch,
      jobNumber: (bestMatch.Job_Number || '').trim(),
      confidence: Math.round(bestScore * 100) / 100,
      method: 'address-match',
      matchedAddress: `${bestMatch.Address_1}, ${bestMatch.City}, ${bestMatch.State}`.trim(),
    };
  }

  return null;
}

/**
 * STEP 2: Get job number from invoice data.
 * Priority: extracted job number → address lookup → null
 */
async function resolveJobNumber(extracted, vendorCode) {
  // 2a-pre. Check job feedback cache — if Dana corrected this vendor+address
  // combo before, use her answer immediately. This is the "learning" path.
  if (vendorCode) {
    const addresses = [
      extracted.projectAddress,
      extracted.jobAddress,
      extracted.siteAddress,
      extracted.address,
    ].filter(Boolean);

    for (const addr of addresses) {
      const addrHash = normalizeAddress(addr);
      if (!addrHash || addrHash.length < 5) continue;
      try {
        const { rows } = await pool.query(
          'SELECT job_number FROM job_mappings WHERE vendor_code = $1 AND address_hash = $2',
          [vendorCode, addrHash]
        );
        if (rows.length > 0) {
          const cachedJob = rows[0].job_number;
          // Verify the cached job still exists in Spectrum
          const job = findJobByNumber(cachedJob);
          if (job) {
            return {
              jobNumber: cachedJob,
              subcontractNumber: null,
              confidence: 0.98,
              method: 'job-feedback-cache',
              jobDescription: (job.Job_Description || '').trim(),
            };
          }
        }
      } catch {}
    }
  }

  // 2a-subject-cache. Subject → job mapping from corrections.
  // Works even when the invoice has no address — the email subject is always present.
  if (vendorCode && extracted.emailSubject) {
    const subjectHash = normalizeSubject(extracted.emailSubject);
    if (subjectHash && subjectHash.length >= 3) {
      try {
        const mapping = await getConfirmedSubjectJobMapping({ vendorCode, subjectHash });
        if (mapping) {
          const cachedJob = mapping.job_number;
          const job = findJobByNumber(cachedJob);
          if (job) {
            return {
              jobNumber: cachedJob,
              subcontractNumber: null,
              confidence: 0.96,
              method: 'subject-job-cache',
              jobDescription: (job.Job_Description || '').trim(),
            };
          }
        }
      } catch {}
    }
  }

  // 2a. Try the extracted job number first
  if (extracted.jobNumber) {
    const parsed = parseJobReference(extracted.jobNumber);

    // If it's already a subcontract number, return both — but the job comes
    // from Spectrum's sub→job link (findSubcontractJob), NOT the sub's
    // numbering prefix. Prefix is only the fallback when the sub isn't in
    // the sidecar.
    if (parsed.subcontractNumber) {
      const spectrumJob = findSubcontractJob(parsed.subcontractNumber);
      return {
        jobNumber: spectrumJob || parsed.jobNumber,
        subcontractNumber: parsed.subcontractNumber,
        confidence: spectrumJob ? 0.99 : 0.7,
        method: 'extracted-subcontract',
      };
    }

    // Verify the job number exists in our database
    const job = findJobByNumber(parsed.jobNumber);
    if (job) {
      return {
        jobNumber: (job.Job_Number || '').trim(),
        subcontractNumber: null,
        confidence: 0.95,
        method: 'extracted-verified',
        jobDescription: (job.Job_Description || '').trim(),
      };
    }

    // Job number from invoice but not in our database — save as fallback, keep trying
    if (!parsed.freeform) {
      // Don't return yet — try description/address matching which may find the real job
      // Store as fallback in case nothing better is found
      var extractedFallback = {
        jobNumber: parsed.jobNumber,
        subcontractNumber: null,
        confidence: 0.7,
        method: 'extracted-unverified',
      };
    }
  }

  // 2a-subject. Subject-line job number extraction — high-priority signal,
  // but below extracted-verified and feedback-cache.
  // Email subjects often contain explicit job references like "NCG26-438.07",
  // "26-450", or "25-SVC403". These are direct evidence from the sender.
  if (extracted.emailSubject) {
    const subjectJobResult = extractJobFromSubject(extracted.emailSubject);
    if (subjectJobResult) {
      // When the subject carries a sub number, resolve the job from Spectrum's
      // sub→job link first (prefix ≠ job in real cases; see findSubcontractJob).
      const subjectSub = subjectJobResult.subcontractNumber || null;
      const spectrumJob = subjectSub ? findSubcontractJob(subjectSub) : null;
      // Validate against known jobs
      const job = findJobByNumber(spectrumJob || subjectJobResult.jobNumber);
      if (job) {
        return {
          jobNumber: (job.Job_Number || '').trim(),
          subcontractNumber: subjectSub,
          confidence: 0.97,
          method: 'subject-line',
          jobDescription: (job.Job_Description || '').trim(),
        };
      }
    }
  }

  // 2b. Try address matching
  // Combine vendor address and any project address from the invoice
  const addresses = [
    extracted.projectAddress,
    extracted.jobAddress,
    extracted.siteAddress,
    extracted.address,
  ].filter(Boolean);

  // Also check if the subject/description has an address-like reference
  // (handled externally — the extractor should put it in projectAddress)

  for (const addr of addresses) {
    const result = findJobByAddress(addr, vendorCode);
    if (result) {
      const out = {
        jobNumber: result.jobNumber,
        subcontractNumber: null,
        confidence: result.confidence,
        method: result.method,
        matchedAddress: result.matchedAddress,
        jobDescription: (result.job.Job_Description || '').trim(),
      };
      // Pass through address candidates for vendor cross-reference in subcontract matching
      if (result._addressCandidates) out._addressCandidates = result._addressCandidates;
      return out;
    }
  }

  // 2c. Try matching job description against email subject or project name
  const textClues = [
    extracted.projectName,
    extracted.emailSubject,
    extracted.description,
  ].filter(Boolean);

  const jobs = loadJSON(SPECTRUM_JOBS_PATH, []);
  for (const clue of textClues) {
    const normClue = normalizeStr(clue);
    if (normClue.length < 4) continue;

    let bestJob = null;
    let bestScore = 0;
    for (const j of jobs) {
      const desc = normalizeStr(j.Job_Description || '');
      if (!desc) continue;
      // Check if the job description appears in the clue or vice versa
      if (normClue.includes(desc) || desc.includes(normClue)) {
        const score = 0.92;
        if (score > bestScore) { bestScore = score; bestJob = j; }
      } else {
        const score = jaroWinkler(normClue, desc);
        if (score > bestScore) { bestScore = score; bestJob = j; }
      }
    }
    if (bestJob && bestScore > 0.85) {
      return {
        jobNumber: (bestJob.Job_Number || '').trim(),
        subcontractNumber: null,
        confidence: Math.round(bestScore * 100) / 100,
        method: 'description-match',
        jobDescription: (bestJob.Job_Description || '').trim(),
        matchedFrom: clue,
      };
    }
  }

  // 2d. Try the email subject for address clues (e.g., "Invoice - 4200 Example Lake Drive")
  if (extracted.emailSubject) {
    const result = findJobByAddress(extracted.emailSubject, vendorCode);
    if (result && result.confidence > 0.88) {
      return {
        jobNumber: result.jobNumber,
        subcontractNumber: null,
        confidence: result.confidence * 0.95,
        method: 'subject-address-match',
        matchedAddress: result.matchedAddress,
        jobDescription: (result.job.Job_Description || '').trim(),
      };
    }
  }

  // 2e. Sender → job mapping for single-job vendors (lowest priority fallback).
  // Only used after 2+ confirmed corrections to avoid poisoning multi-job vendors.
  if (vendorCode && extracted.senderEmail) {
    const domain = extractDomain(extracted.senderEmail);
    if (domain && !DOMAIN_BLOCKLIST.has(domain)) {
      try {
        const { rows } = await pool.query(
          'SELECT job_number, hit_count FROM sender_job_mappings WHERE vendor_code = $1 AND sender_domain = $2',
          [vendorCode, domain]
        );
        if (rows.length > 0 && rows[0].hit_count >= 2) {
          const cachedJob = rows[0].job_number;
          const job = findJobByNumber(cachedJob);
          if (job) {
            return {
              jobNumber: cachedJob,
              subcontractNumber: null,
              confidence: 0.85,
              method: 'sender-job-cache',
              jobDescription: (job.Job_Description || '').trim(),
            };
          }
        }
      } catch {}
    }
  }

  // Return extracted fallback if we had one, otherwise no match
  // NOTE: If we reach here with an extractedFallback, the job number was NOT found in Spectrum
  // and no address/description match was found either. Reject it rather than passing bad data.
  if (typeof extractedFallback !== 'undefined') {
    return {
      jobNumber: null,
      subcontractNumber: null,
      confidence: 0,
      method: 'job-not-in-spectrum',
      rejectedJobNumber: extractedFallback.jobNumber,
    };
  }
  return { jobNumber: null, subcontractNumber: null, confidence: 0, method: 'no-job' };
}

/**
 * Read a subject feedback mapping only after it has two matching confirmations.
 * The explicit row check is retained as defense in depth for mocked/legacy
 * query layers that might not enforce the SQL predicate themselves.
 */
async function getConfirmedSubjectJobMapping({ vendorCode, subjectHash, query = pool.query.bind(pool) }) {
  const { rows } = await query(
    `SELECT job_number, hit_count
     FROM subject_job_mappings
     WHERE vendor_code = $1 AND subject_hash = $2 AND hit_count >= 2`,
    [vendorCode, subjectHash]
  );
  const mapping = rows[0];
  return Number(mapping?.hit_count) >= 2 ? mapping : null;
}

// --- STEP 3: Subcontract Matching ---

/**
 * Match vendor code + job number to a subcontract in the Spectrum database.
 */
async function matchSubcontract(vendorCode, jobNumber) {
  if (!vendorCode || !jobNumber) {
    return { subcontractNumber: null, confidence: 0, method: 'skipped' };
  }

  const subcontracts = loadJSON(SPECTRUM_SUBCONTRACTS_PATH, []);
  const cacheKey = `${vendorCode}:${jobNumber}`;

  // 3a. Feedback cache — Supabase subcontract_mappings
  // Key: vendor_code + job_prefix (job_prefix = jobNumber here)
  try {
    const { rows } = await pool.query(
      'SELECT subcontract_number FROM subcontract_mappings WHERE vendor_code = $1 AND job_prefix = $2',
      [vendorCode, jobNumber]
    );
    // Null/empty cached numbers are poison (a past clear recorded as
    // feedback): ignore them so the file lookups below stay authoritative.
    if (rows.length && rows[0].subcontract_number && String(rows[0].subcontract_number).trim()) {
      return { subcontractNumber: rows[0].subcontract_number, confidence: 0.99, method: 'cache' };
    }
  } catch (e) {
    // Fallback to JSON cache on DB error
    const cache = loadJSON(SUBCONTRACT_CACHE_PATH, {});
    if (cache[cacheKey] && cache[cacheKey].number && String(cache[cacheKey].number).trim()) {
      return { subcontractNumber: cache[cacheKey].number, confidence: 0.99, method: 'cache' };
    }
  }

  // 3b. Direct match — vendor_code + job from SQL data
  const matches = subcontracts.filter(sc => {
    const scVendor = (sc.vendor_code || '').trim();
    const scJob = (sc.job || '').trim();
    return scVendor === vendorCode && scJob === jobNumber;
  });

  if (matches.length === 1) {
    return {
      subcontractNumber: (matches[0].subcontract_number || '').trim(),
      confidence: 0.95,
      method: 'exact-unique',
    };
  }

  if (matches.length > 1) {
    // Multiple subcontracts for same vendor + job — return all options for Dana
    const options = matches.map(m => ({
      number: (m.subcontract_number || '').trim(),
      revContract: m.rev_contract,
      status: m.status,
    }));
    return {
      subcontractNumber: null,
      confidence: 0.5,
      method: 'ambiguous',
      options,
    };
  }

  // 3c. Try looser job match (without leading zeros, etc.)
  const normJob = jobNumber.replace(/^0+/, '').trim();
  const looseMatches = subcontracts.filter(sc => {
    const scVendor = (sc.vendor_code || '').trim();
    const scJob = (sc.job || '').trim().replace(/^0+/, '');
    return scVendor === vendorCode && scJob === normJob;
  });

  if (looseMatches.length === 1) {
    return {
      subcontractNumber: (looseMatches[0].subcontract_number || '').trim(),
      confidence: 0.9,
      method: 'loose-match',
    };
  }

  if (looseMatches.length > 1) {
    const options = looseMatches.map(m => ({
      number: (m.subcontract_number || '').trim(),
      revContract: m.rev_contract,
      status: m.status,
    }));
    return { subcontractNumber: null, confidence: 0.5, method: 'ambiguous', options };
  }

  return { subcontractNumber: null, confidence: 0, method: 'no-match' };
}

/**
 * Fallback: match vendor to subcontract by amount when no job number is available.
 * Only returns high-confidence matches (exact amount, single result).
 */
function matchSubcontractByAmount(vendorCode, amount) {
  if (!vendorCode || !amount) return null;
  const subcontracts = loadJSON(SPECTRUM_SUBCONTRACTS_PATH, []);

  // Find all subcontracts for this vendor where rev_contract matches the invoice amount
  const amountNum = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(amountNum)) return null;

  const matches = subcontracts.filter(sc => {
    const scVendor = (sc.vendor_code || '').trim();
    if (scVendor !== vendorCode) return false;
    // Check rev_contract OR total_billed matches
    return Math.abs(sc.rev_contract - amountNum) < 0.01 ||
           Math.abs(sc.total_billed - amountNum) < 0.01;
  });

  if (matches.length === 1) {
    return {
      subcontractNumber: (matches[0].subcontract_number || '').trim(),
      jobNumber: (matches[0].job || '').trim(),
      confidence: 0.85,
      method: 'amount-match',
    };
  }

  return null;
}

// --- Full Invoice Match ---

/**
 * Full matching chain:
 * 1. Vendor code (name fuzzy match)
 * 2. Job number (extracted → address fallback)
 * 3. Subcontract (vendor + job → subcontract)
 */
async function matchInvoice(invoice) {
  // STEP 1: Vendor
  const vendorResult = await matchVendor({
    name: invoice.vendorName,
    email: invoice.senderEmail,
    address: invoice.vendorAddress,
  });

  // STEP 2: Job number
  // Pass vendor code so address disambiguation can prefer jobs where this
  // vendor has an active subcontract (fixes the #1 source of manual corrections).
  const jobResult = await resolveJobNumber({
    jobNumber: invoice.jobNumber,
    projectAddress: invoice.projectAddress || invoice.siteAddress,
    address: invoice.vendorAddress, // fallback: vendor address might be job site
    emailSubject: invoice.emailSubject,
    senderEmail: invoice.senderEmail || invoice.emailFrom,
  }, vendorResult.vendorCode || null);

  // STEP 3: Subcontract
  let subcontractResult;
  if (jobResult.subcontractNumber) {
    // Already have a full subcontract number from extraction
    subcontractResult = {
      subcontractNumber: jobResult.subcontractNumber,
      confidence: jobResult.confidence,
      method: 'extracted-direct',
    };
  } else if (vendorResult.vendorCode && jobResult.jobNumber) {
    subcontractResult = await matchSubcontract(vendorResult.vendorCode, jobResult.jobNumber);

    // If no subcontract found AND there are multiple address candidates, cross-reference
    // vendor against all candidate jobs to find the right one
    if (!subcontractResult.subcontractNumber && jobResult._addressCandidates && jobResult._addressCandidates.length > 1) {
      for (const candidate of jobResult._addressCandidates) {
        if (candidate.jobNumber === jobResult.jobNumber) continue; // already tried
        const tryResult = await matchSubcontract(vendorResult.vendorCode, candidate.jobNumber);
        if (tryResult.subcontractNumber) {
          // Found it — update job to the correct one
          subcontractResult = tryResult;
          jobResult.jobNumber = candidate.jobNumber;
          jobResult.confidence = candidate.score;
          jobResult.method = 'address-vendor-crossref';
          jobResult.jobDescription = (candidate.job.Job_Description || '').trim();
          jobResult.matchedAddress = `${candidate.job.Address_1}, ${candidate.job.City}, ${candidate.job.State}`.trim();
          break;
        }
      }
    }

    // If still no subcontract, try amount-based fallback
    if (!subcontractResult.subcontractNumber && vendorResult.vendorCode) {
      const amountFallback = matchSubcontractByAmount(vendorResult.vendorCode, invoice.amount || invoice.total);
      if (amountFallback) {
        subcontractResult = amountFallback;
        if (amountFallback.jobNumber) {
          jobResult.jobNumber = amountFallback.jobNumber;
          jobResult.confidence = amountFallback.confidence;
          jobResult.method = 'from-amount-match';
        }
      }
    }
  } else {
    // Fallback: try matching by vendor + amount
    const amountMatch = vendorResult.vendorCode
      ? matchSubcontractByAmount(vendorResult.vendorCode, invoice.amount || invoice.total)
      : null;
    if (amountMatch) {
      subcontractResult = amountMatch;
      if (amountMatch.jobNumber) {
        jobResult.jobNumber = amountMatch.jobNumber;
        jobResult.confidence = amountMatch.confidence;
        jobResult.method = 'from-amount-match';
      }
    } else {
      subcontractResult = {
        subcontractNumber: null,
        confidence: 0,
        method: vendorResult.vendorCode ? 'no-job' : 'no-vendor',
      };
    }
  }

  // Supplier-aware confidence: if the matched vendor has NO subcontracts at
  // all in Spectrum, they're a supplier (materials/rentals/services) — a
  // missing subcontract is EXPECTED, not a match failure. Don't let the
  // subcontract leg zero out overall confidence and permanently flag the
  // invoice for review.
  const confidenceLegs = [vendorResult.confidence, jobResult.confidence || 0];
  if (subcontractResult.method === 'no-match' && vendorResult.vendorCode) {
    const allSubs = loadJSON(SPECTRUM_SUBCONTRACTS_PATH, []);
    const vendorHasAnySub = allSubs.some(
      (sc) => (sc.vendor_code || '').trim() === vendorResult.vendorCode
    );
    if (!vendorHasAnySub) {
      subcontractResult.method = 'none-expected';
      subcontractResult.confidence = 1; // neutral — excluded from the min below
    } else {
      // Vendor does have subcontracts elsewhere — a miss here is a real signal.
      confidenceLegs.push(subcontractResult.confidence || 0);
    }
  } else {
    confidenceLegs.push(subcontractResult.confidence || 0);
  }

  const overallConfidence = Math.min(...confidenceLegs);

  return {
    invoiceNumber: invoice.invoiceNumber || null,
    amount: invoice.amount || invoice.total || null,
    dueDate: invoice.dueDate || null,
    vendor: vendorResult,
    job: jobResult,
    subcontract: subcontractResult,
    overallConfidence,
    status: 'pending',
    extractedAt: new Date().toISOString(),
  };
}

// --- Self-vendor guard ---
// NCG should never be identified as the vendor on its own inbound invoices.
// If the pipeline matches to NCG itself, discard the match and return no-match.
const SELF_VENDOR_CODES = new Set(['ZNOR91']);
const SELF_VENDOR_PATTERNS = [
  /northwind\s+contracting/i,
  /\bncg\b/i,
  /\bnorthwindcg\b/i,
];

function isSelfVendor(vendorCode, vendorName) {
  if (vendorCode && SELF_VENDOR_CODES.has(vendorCode.trim())) return true;
  if (vendorName) {
    for (const pat of SELF_VENDOR_PATTERNS) {
      if (pat.test(vendorName)) return true;
    }
  }
  return false;
}

const NO_MATCH_RESULT = { vendorCode: null, vendorName: null, confidence: 0, method: 'no-match' };

// --- Feedback ---

// Generic/shared domains that should NEVER be cached as vendor identifiers.
// These belong to NCG, payment platforms, email providers, or invoice aggregators.
const DOMAIN_BLOCKLIST = new Set([
  'northwindcg.example', 'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'aol.com', 'icloud.com', 'live.com', 'msn.com', 'comcast.net', 'att.net',
  'notification.intuit.com', 'intuit.com', 'quickbooks.intuit.com',
  'versapay.com', 'bill.com', 'paypal.com', 'square.com', 'stripe.com',
  'ariba.com', 'coupa.com',
  // yourdocket.com — currently one vendor; add here if more vendors use it
  'test.com', 't.com',
]);

async function recordVendorFeedback({ email, name, vendorCode, vendorName }) {
  // Self-vendor guard: never cache NCG as a vendor
  if (isSelfVendor(vendorCode, vendorName)) return { recorded: false, reason: 'self-vendor' };

  // Resolve canonical vendor name from Spectrum instead of trusting the input
  // (the input may carry the AI-extracted name, which could be wrong)
  if (vendorCode) {
    const vendors = loadJSON(SPECTRUM_VENDORS_PATH, []);
    const specVendor = vendors.find(v => (v.Vendor_Code || v.code || v.Code || v.vendor_code || '').trim() === vendorCode.trim());
    if (specVendor) {
      vendorName = (specVendor.Name || specVendor.name || specVendor.vendor_name || vendorName || '').trim();
    }
  }

  const domain = extractDomain(email);
  const normName = normalizeStr(name);
  const now = new Date().toISOString();

  // Upsert domain mapping — skip generic/shared domains
  if (domain && !DOMAIN_BLOCKLIST.has(domain)) {
    try {
      await pool.query(
        `INSERT INTO vendor_mappings (domain, vendor_code, vendor_name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (domain) DO UPDATE SET vendor_code = EXCLUDED.vendor_code, vendor_name = EXCLUDED.vendor_name`,
        [domain, vendorCode, vendorName, now]
      );
    } catch (e) {
      // Fallback: write to JSON cache
      const cache = loadJSON(VENDOR_CACHE_PATH, { domains: {}, names: {} });
      cache.domains[domain] = { code: vendorCode, name: vendorName, addedAt: now };
      saveJSON(VENDOR_CACHE_PATH, cache);
    }
  }

  // Upsert name mapping (stored with 'name:' prefix so domain PK stays unique)
  if (normName) {
    const nameKey = `name:${normName}`;
    try {
      await pool.query(
        `INSERT INTO vendor_mappings (domain, vendor_code, vendor_name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (domain) DO UPDATE SET vendor_code = EXCLUDED.vendor_code, vendor_name = EXCLUDED.vendor_name`,
        [nameKey, vendorCode, vendorName, now]
      );
    } catch (e) {
      // Fallback: write to JSON cache
      const cache = loadJSON(VENDOR_CACHE_PATH, { domains: {}, names: {} });
      cache.names[normName] = { code: vendorCode, name: vendorName, addedAt: now };
      saveJSON(VENDOR_CACHE_PATH, cache);
    }
  }

  return { recorded: true, domain, name: normName };
}

/**
 * Record a job correction so the same vendor + address combo resolves correctly
 * next time. Follows the same Supabase upsert + JSON fallback pattern as
 * vendor and subcontract feedback.
 */
async function recordJobFeedback({ vendorCode, address, jobNumber }) {
  if (!vendorCode || !address || !jobNumber) return { recorded: false };
  const addrHash = normalizeAddress(address);
  if (!addrHash || addrHash.length < 5) return { recorded: false };
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO job_mappings (vendor_code, address_hash, job_number, address_raw, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (vendor_code, address_hash)
       DO UPDATE SET job_number = EXCLUDED.job_number, updated_at = EXCLUDED.updated_at`,
      [vendorCode, addrHash, jobNumber, address, now]
    );
  } catch (e) {
    logger.warn({ err: e, vendorCode, addressHash: addrHash, jobNumber }, 'Job feedback DB write failed');
  }
  return { recorded: true, vendorCode, addressHash: addrHash, jobNumber };
}

/**
 * Record a subject → job correction so the same vendor + subject combo
 * resolves correctly next time, even without an address.
 */
async function recordSubjectJobFeedback({ vendorCode, emailSubject, jobNumber, query = pool.query.bind(pool) }) {
  if (!vendorCode || !emailSubject || !jobNumber) return { recorded: false };
  const subjectHash = normalizeSubject(emailSubject);
  if (!subjectHash || subjectHash.length < 3) return { recorded: false };
  const now = new Date().toISOString();
  try {
    await query(
      `INSERT INTO subject_job_mappings (vendor_code, subject_hash, job_number, subject_raw, hit_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)
       ON CONFLICT (vendor_code, subject_hash)
       DO UPDATE SET job_number = EXCLUDED.job_number,
                     hit_count = CASE
                       WHEN subject_job_mappings.job_number = EXCLUDED.job_number
                       THEN subject_job_mappings.hit_count + 1
                       ELSE 1
                     END,
                     updated_at = EXCLUDED.updated_at`,
      [vendorCode, subjectHash, jobNumber, emailSubject, now]
    );
  } catch (e) {
    logger.warn({ err: e, vendorCode, subjectHash, jobNumber }, 'Subject job feedback DB write failed');
  }
  return { recorded: true, vendorCode, subjectHash, jobNumber };
}

/**
 * Record a sender domain → job correction for single-job vendors.
 * Increments hit_count on conflict so the lookup only activates after 2+ signals.
 */
async function recordSenderJobFeedback({ vendorCode, senderEmail, jobNumber }) {
  if (!vendorCode || !senderEmail || !jobNumber) return { recorded: false };
  const domain = extractDomain(senderEmail);
  if (!domain || DOMAIN_BLOCKLIST.has(domain)) return { recorded: false };
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO sender_job_mappings (vendor_code, sender_domain, job_number, hit_count, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $4)
       ON CONFLICT (vendor_code, sender_domain)
       DO UPDATE SET job_number = EXCLUDED.job_number,
                     hit_count = CASE
                       WHEN sender_job_mappings.job_number = EXCLUDED.job_number
                       THEN sender_job_mappings.hit_count + 1
                       ELSE 1
                     END,
                     updated_at = EXCLUDED.updated_at`,
      [vendorCode, domain, jobNumber, now]
    );
  } catch (e) {
    logger.warn({ err: e, vendorCode, domain, jobNumber }, 'Sender job feedback DB write failed');
  }
  return { recorded: true, vendorCode, domain, jobNumber };
}

async function recordSubcontractFeedback({ vendorCode, jobNumber, subcontractNumber }) {
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO subcontract_mappings (vendor_code, job_prefix, subcontract_number, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vendor_code, job_prefix) DO UPDATE SET subcontract_number = EXCLUDED.subcontract_number`,
      [vendorCode, jobNumber, subcontractNumber, now]
    );
  } catch (e) {
    // Fallback: write to JSON cache
    const cache = loadJSON(SUBCONTRACT_CACHE_PATH, {});
    cache[`${vendorCode}:${jobNumber}`] = { number: subcontractNumber, addedAt: now };
    saveJSON(SUBCONTRACT_CACHE_PATH, cache);
  }
  return { recorded: true };
}

/**
 * Approval-confirmation learning.
 *
 * When a human approves an invoice WITHOUT correcting the match, that is a
 * verified-correct signal — promote heuristic (fuzzy/address/description/amount)
 * matches into the mapping tables so the next invoice from this vendor is a
 * 0.98–0.99 cache hit instead of a re-run of the heuristics.
 *
 * Cache-sourced and human-corrected matches are skipped (already learned).
 * Extracted-verified job matches are skipped (deterministic — nothing to learn).
 *
 * @param {object} row - raw documents row at approval time
 * @returns {{vendor: boolean, job: boolean, subcontract: boolean}} what was promoted
 */
async function recordApprovalConfirmation(row) {
  const promoted = { vendor: false, job: false, subcontract: false };
  if (!row) return promoted;

  // Vendor: promote fuzzy matches (high or medium). Cache methods already learned.
  const vendorMethod = row.vendor_match_method || '';
  if (row.vendor_code && vendorMethod.startsWith('fuzzy')) {
    await recordVendorFeedback({
      email: row.email_from || '',
      name: row.vendor_name || '',
      vendorCode: row.vendor_code,
      vendorName: row.matched_vendor_name || row.vendor_name || '',
    });
    promoted.vendor = true;
  }

  // Job: promote heuristic address/description/subject matches when we have an
  // address to key on. Skip extracted-verified (invoice literally said the job)
  // and feedback-cache (already learned).
  const jobMethod = row.job_match_method || '';
  const heuristicJobMethods = new Set([
    'address-match',
    'address-vendor-crossref',
    'description-match',
    'subject-address-match',
    'subject-line',
    'from-amount-match',
  ]);
  if (row.vendor_code && row.job_match_number && heuristicJobMethods.has(jobMethod)) {
    const address = row.project_address || row.vendor_address || '';
    if (address) {
      await recordJobFeedback({
        vendorCode: row.vendor_code,
        address,
        jobNumber: row.job_match_number,
      });
      promoted.job = true;
    }
    // Also promote to subject + sender caches for broader learning.
    // These work even when address is absent, so capture them unconditionally.
    if (row.email_subject) {
      await recordSubjectJobFeedback({
        vendorCode: row.vendor_code,
        emailSubject: row.email_subject,
        jobNumber: row.job_match_number,
      });
    }
    if (row.email_from) {
      await recordSenderJobFeedback({
        vendorCode: row.vendor_code,
        senderEmail: row.email_from,
        jobNumber: row.job_match_number,
      });
    }
  }

  // Subcontract: promote non-cache resolutions (exact-unique, loose-match,
  // amount-match, extracted-direct) so future lookups skip straight to cache.
  const subMethod = row.subcontract_match_method || '';
  const heuristicSubMethods = new Set(['exact-unique', 'loose-match', 'amount-match', 'extracted-direct']);
  if (row.vendor_code && row.job_match_number && row.subcontract_number && heuristicSubMethods.has(subMethod)) {
    await recordSubcontractFeedback({
      vendorCode: row.vendor_code,
      jobNumber: row.job_match_number,
      subcontractNumber: row.subcontract_number,
    });
    promoted.subcontract = true;
  }

  return promoted;
}

// --- Subcontract phase info (multi-phase allocation support) ---
//
// Given a subcontract number, returns:
//   - Subcontract header info (revContract, totalBilled, unbilled, vendor, job)
//   - ALL phase rows as they appear in Spectrum (NOT merged by phase_code,
//     so Dana can see initial-contract rows vs change-order rows distinctly)
//   - Aggregated view (by phase_code) for allocation targeting
//
// Allocations are still keyed by phase_code (since Spectrum's API can only
// accept one Phase_Code per detail line), but the UI shows all rows for context.
//
// Each phase row includes remaining_amount = original - billed.
//
// Returns null if subcontract not found.
function getSubcontractPhaseInfo(subcontractNumber) {
  if (!subcontractNumber) return null;
  const target = subcontractNumber.trim();
  if (!target) return null;

  const subcontracts = loadJSON(SPECTRUM_SUBCONTRACTS_PATH, []);
  const matches = subcontracts.filter((sc) => {
    return (sc.subcontract_number || '').trim() === target && sc.status === 'Active';
  });
  if (matches.length === 0) return null;

  // Header info — take from the first matching row (all rows for the same
  // subcontract number have the same header; the file can have duplicates
  // joined to different jobs but the numbers are the same).
  const header = matches[0];
  const revContract = Number(header.rev_contract) || 0;
  const totalBilled = Number(header.total_billed) || 0;
  const unbilled = Number(header.unbilled) || 0;

  // Build phase rows — preserve ALL rows (don't merge by phase_code).
  // Dana needs to see initial contract vs change order rows separately
  // for context, even though allocations collapse back to phase_code.
  const phaseRows = [];
  let rowIdx = 0;
  for (const sub of matches) {
    for (const p of sub.phases || []) {
      const code = (p.phase_code || '').trim();
      if (!code) continue;
      const original = Number(p.original_amount) || 0;
      const billed = Number(p.amount_billed) || 0;
      phaseRows.push({
        row_index: rowIdx++,
        phase_code: code,
        cost_type: (p.cost_type || 'S').trim(),
        description: (p.description || '').trim(),
        original_amount: original,
        amount_billed: billed,
        remaining_amount: Math.round((original - billed) * 100) / 100,
      });
    }
  }

  // Aggregated view by phase_code (used for allocation targeting since
  // Spectrum's APInvoiceDetails can only take one Phase_Code per line).
  const phaseCodeMap = new Map();
  for (const row of phaseRows) {
    const existing = phaseCodeMap.get(row.phase_code);
    if (existing) {
      existing.original_amount += row.original_amount;
      existing.amount_billed += row.amount_billed;
      existing.remaining_amount =
        Math.round((existing.original_amount - existing.amount_billed) * 100) / 100;
    } else {
      phaseCodeMap.set(row.phase_code, {
        phase_code: row.phase_code,
        cost_type: row.cost_type,
        description: row.description,
        original_amount: row.original_amount,
        amount_billed: row.amount_billed,
        remaining_amount: row.remaining_amount,
      });
    }
  }
  const aggregatedPhases = [...phaseCodeMap.values()].sort((a, b) =>
    a.phase_code.localeCompare(b.phase_code)
  );

  return {
    subcontractNumber: target,
    jobNumber: (header.job || '').trim(),
    vendorCode: (header.vendor_code || '').trim(),
    vendorName: (header.vendor || '').trim(),
    revContract: Math.round(revContract * 100) / 100,
    totalBilled: Math.round(totalBilled * 100) / 100,
    unbilled: Math.round(unbilled * 100) / 100,
    isMultiPhase: aggregatedPhases.length >= 2,
    distinctPhaseCount: aggregatedPhases.length,
    phaseRowCount: phaseRows.length,
    phaseRows,             // all rows, NOT merged (for display)
    aggregatedPhases,      // merged by phase_code (for allocation targeting)
    // Legacy alias for backwards compat with the initial spec:
    phases: aggregatedPhases,
  };
}

// --- Exports ---
module.exports = {
  matchVendor,
  matchSubcontract,
  matchSubcontractByAmount,
  matchInvoice,
  resolveJobNumber,
  findJobByNumber,
  findSubcontractJob,
  findJobByAddress,
  parseJobReference,
  extractJobFromSubject,
  normalizeSubject,
  getConfirmedSubjectJobMapping,
  recordVendorFeedback,
  recordSubcontractFeedback,
  recordJobFeedback,
  recordSubjectJobFeedback,
  recordSenderJobFeedback,
  recordApprovalConfirmation,
  getSubcontractPhaseInfo,
  isSelfVendor,
  jaroWinkler,
};

// --- CLI ---
if (require.main === module) {
  const [,, cmd, ...args] = process.argv;
  const writeJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  const writeUsage = () => {
    process.stdout.write('Usage:\n');
    process.stdout.write('  node modules/invoices/services/matcher.js vendor "Company Name" --email "user@company.example"\n');
    process.stdout.write('  node modules/invoices/services/matcher.js subcontract VENDOR01 25-554\n');
    process.stdout.write('  node modules/invoices/services/matcher.js job-by-address "4200 Example Lake Drive"\n');
    process.stdout.write('  node modules/invoices/services/matcher.js full <extracted-invoice.json>\n');
  };
  switch (cmd) {
    case 'vendor': {
      const name = args[0];
      const emailIdx = args.indexOf('--email');
      const email = emailIdx >= 0 ? args[emailIdx + 1] : null;
      matchVendor({ name, email }).then(writeJson).catch((e) => { logger.error({ err: e }, 'Matcher CLI vendor command failed'); process.exit(1); });
      break;
    }
    case 'subcontract': {
      const [vendorCode, jobNumber] = args;
      matchSubcontract(vendorCode, jobNumber).then(writeJson).catch((e) => { logger.error({ err: e }, 'Matcher CLI subcontract command failed'); process.exit(1); });
      break;
    }
    case 'job-by-address': {
      const addr = args.join(' ');
      writeJson(findJobByAddress(addr));
      break;
    }
    case 'full': {
      const invoice = JSON.parse(fs.readFileSync(args[0], 'utf8'));
      matchInvoice(invoice).then(writeJson).catch((e) => { logger.error({ err: e }, 'Matcher CLI full command failed'); process.exit(1); });
      break;
    }
    case 'feedback-vendor': {
      const [email, name, vendorCode, vendorName] = args;
      recordVendorFeedback({ email, name, vendorCode, vendorName }).then(writeJson).catch((e) => { logger.error({ err: e }, 'Matcher CLI feedback-vendor command failed'); process.exit(1); });
      break;
    }
    case 'feedback-subcontract': {
      const [vendorCode, jobNumber, subcontractNumber] = args;
      recordSubcontractFeedback({ vendorCode, jobNumber, subcontractNumber }).then(writeJson).catch((e) => { logger.error({ err: e }, 'Matcher CLI feedback-subcontract command failed'); process.exit(1); });
      break;
    }
    default:
      writeUsage();
  }
}
