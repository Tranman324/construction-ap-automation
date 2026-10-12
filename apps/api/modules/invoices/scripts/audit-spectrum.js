#!/usr/bin/env node
/**
 * Invoice Pipeline → Spectrum Audit
 *
 * Purpose:
 *   Compare invoices from the pipeline (Supabase `documents` where
 *   classification='invoice') against what exists in Spectrum across the
 *   AP-related tables, and produce a mismatch report.
 *
 * Usage:
 *   node scripts/audit-spectrum.js                  # run full audit
 *   node scripts/audit-spectrum.js --no-upload      # skip Box upload
 *   node scripts/audit-spectrum.js --no-discord     # skip Discord post
 *   node scripts/audit-spectrum.js --limit 20       # limit pipeline rows (debug)
 *
 * Output:
 *   - JSON  → data/audit/YYYY-MM-DD_HHMMSS_audit.json
 *   - CSV   → data/audit/YYYY-MM-DD_HHMMSS_audit.csv
 *   - Both uploaded to Box /Toolbox/invoices/audit/
 *   - Discord summary posted to #accounting
 *
 * Matching rules (per the product owner, no normalization — exact string match):
 *   - Primary:   (vendor_code, invoice_number) exact, trimmed, same-case
 *   - Fallback:  (invoice_number only) — flags vendor mismatch
 *   - Miss:      no match anywhere in Spectrum
 *
 * Fields compared for matched rows:
 *   - vendor_code, job_number, subcontract_number
 *   - Phase code is intentionally OUT OF SCOPE (per the product owner — handled by
 *     subcontract association in Spectrum automatically).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const paths = require('/etc/toolbox/paths.js');

// ────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────
const BOX_SCRIPT = paths.BOX_SCRIPT;
const BOX_AUDIT_FOLDER = '100000000003';
const SPECTRUM_SQL = paths.SPECTRUM_SQL;
const AUDIT_DIR = path.join(__dirname, '..', 'data', 'audit');
const DISCORD_CHANNEL = '100000000000000001'; // #accounting

const args = new Set(process.argv.slice(2));
const NO_UPLOAD = args.has('--no-upload');
const NO_DISCORD = args.has('--no-discord');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  if (idx === -1) return null;
  return parseInt(process.argv[idx + 1], 10) || null;
})();

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function trim(v) {
  return (v == null ? '' : String(v)).trim();
}

function sqlQuery(sql) {
  // sql.js tool returns JSON arrays — capture stdout
  // Flatten multi-line SQL into a single line so shell doesn't choke on newlines
  const flat = sql.replace(/\s+/g, ' ').trim();
  const out = execFileSync('node', [SPECTRUM_SQL, 'query', flat], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    timeout: 60000,
  });
  // strip the "(N rows)" footer
  const cleaned = out.replace(/\n?\(\d+ rows?\)\s*$/, '').trim();
  if (!cleaned) return [];
  return JSON.parse(cleaned);
}

function postDiscord(message, isError = false) {
  if (NO_DISCORD) return;
  try {
    const tag = isError ? '🚨 Invoice Audit ERROR' : '✅ Invoice Audit Complete';
    const body = `${tag}\n\n${message}`;
    execFileSync(
      'agent-runtime', ['message', 'send', '--channel', 'discord', '-t', DISCORD_CHANNEL, '--message', body],
      { stdio: 'inherit', timeout: 30000 }
    );
  } catch (e) {
    log(`⚠️  Discord post failed: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Data pulls
// ────────────────────────────────────────────────────────────────────────
async function pullPipelineInvoices() {
  log('Pulling pipeline invoices from Supabase…');
  const sql = `
    SELECT
      id,
      invoice_number,
      vendor_code,
      matched_vendor_name,
      vendor_name,
      job_match_number,
      subcontract_number,
      amount,
      status,
      email_from,
      email_subject,
      queued_at
    FROM documents
    WHERE classification IN ('invoice', 'pay-application')
    ORDER BY queued_at DESC
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `;
  const res = await pool.query(sql);
  log(`  → ${res.rows.length} pipeline invoices`);
  return res.rows;
}

function pullSpectrumInvoices() {
  log('Pulling Spectrum invoices from 3 sources…');

  // Source 1: VN_OPEN_ITEMS_MC — open/unpaid invoices
  const openItems = sqlQuery(`
    SELECT
      'OPEN_ITEMS' AS source,
      LTRIM(RTRIM(Vendor_Code)) AS vendor_code,
      LTRIM(RTRIM(Invoice_Number)) AS invoice_number,
      LTRIM(RTRIM(Subcontract_Job)) AS job_number,
      LTRIM(RTRIM(Subcontract_Number)) AS subcontract_number,
      Invoice_Amount AS invoice_amount,
      '' AS status
    FROM VN_OPEN_ITEMS_MC
    WHERE Company_Code = 'NCG'
      AND Invoice_Number IS NOT NULL
      AND LTRIM(RTRIM(Invoice_Number)) <> ''
  `);
  log(`  → VN_OPEN_ITEMS_MC: ${openItems.length} rows`);

  // Source 2: VN_INVOICE_APPROVAL_HDR_MC — in-approval invoices
  // Join to DET to pick up per-line job/phase (take first row per invoice)
  const approvalHdr = sqlQuery(`
    SELECT
      'APPROVAL_HDR' AS source,
      LTRIM(RTRIM(h.Vendor_Code)) AS vendor_code,
      LTRIM(RTRIM(h.Invoice_Number)) AS invoice_number,
      LTRIM(RTRIM(h.Subcontract_Job)) AS job_number,
      LTRIM(RTRIM(h.Contract_Number)) AS subcontract_number,
      h.Invoice_Amount AS invoice_amount,
      LTRIM(RTRIM(h.Status)) AS status
    FROM VN_INVOICE_APPROVAL_HDR_MC h
    WHERE h.Company_Code = 'NCG'
      AND h.Invoice_Number IS NOT NULL
      AND LTRIM(RTRIM(h.Invoice_Number)) <> ''
  `);
  log(`  → VN_INVOICE_APPROVAL_HDR_MC: ${approvalHdr.length} rows`);

  // Source 2a: Fill in job/subcontract from DET table for approval rows that
  // don't have them at the header level (most don't — job lives on detail lines)
  const approvalDet = sqlQuery(`
    SELECT
      LTRIM(RTRIM(Vendor_Code)) AS vendor_code,
      LTRIM(RTRIM(Invoice_Number)) AS invoice_number,
      LTRIM(RTRIM(Job_Number)) AS job_number,
      LTRIM(RTRIM(SC_Contract)) AS subcontract_number,
      LTRIM(RTRIM(Phase_Code)) AS phase_code,
      LTRIM(RTRIM(Cost_Type)) AS cost_type
    FROM VN_INVOICE_APPROVAL_DET_MC
    WHERE Company_Code = 'NCG'
      AND Invoice_Number IS NOT NULL
      AND LTRIM(RTRIM(Invoice_Number)) <> ''
  `);
  log(`  → VN_INVOICE_APPROVAL_DET_MC: ${approvalDet.length} rows (detail)`);

  // Index detail by (vendor, invoice) → first line
  const detByKey = new Map();
  for (const d of approvalDet) {
    const key = `${d.vendor_code}::${d.invoice_number}`;
    if (!detByKey.has(key)) detByKey.set(key, d);
  }

  // Enrich approval headers with detail job/subcontract where empty
  for (const h of approvalHdr) {
    const key = `${h.vendor_code}::${h.invoice_number}`;
    const d = detByKey.get(key);
    if (d) {
      if (!h.job_number) h.job_number = d.job_number;
      if (!h.subcontract_number) h.subcontract_number = d.subcontract_number;
    }
  }

  // Source 3: VN_PAYMENT_HISTORY_MC — historical posted invoices (last 3 months)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const paymentHistory = sqlQuery(`
    SELECT
      'PAYMENT_HIST' AS source,
      LTRIM(RTRIM(Vendor_Code)) AS vendor_code,
      LTRIM(RTRIM(Invoice_Number)) AS invoice_number,
      LTRIM(RTRIM(Subcontract_Job)) AS job_number,
      LTRIM(RTRIM(Contract_Number)) AS subcontract_number,
      Original_Invoice_Amount AS invoice_amount,
      '' AS status
    FROM VN_PAYMENT_HISTORY_MC
    WHERE Company_Code = 'NCG'
      AND Invoice_Number IS NOT NULL
      AND LTRIM(RTRIM(Invoice_Number)) <> ''
      AND Check_Date >= '${cutoffStr}'
  `);
  log(`  → VN_PAYMENT_HISTORY_MC (last 3mo): ${paymentHistory.length} rows`);

  const combined = [...openItems, ...approvalHdr, ...paymentHistory];
  log(`  → TOTAL Spectrum rows: ${combined.length}`);
  return combined;
}

// ────────────────────────────────────────────────────────────────────────
// Matcher
// ────────────────────────────────────────────────────────────────────────
function buildSpectrumIndex(spectrumRows) {
  // Primary index: (vendor_code, invoice_number) → rows
  // Secondary index: (invoice_number) → rows (for vendor-mismatch detection)
  const primary = new Map();
  const byInvoice = new Map();

  for (const row of spectrumRows) {
    const vk = `${trim(row.vendor_code)}::${trim(row.invoice_number)}`;
    if (!primary.has(vk)) primary.set(vk, []);
    primary.get(vk).push(row);

    const ik = trim(row.invoice_number);
    if (!byInvoice.has(ik)) byInvoice.set(ik, []);
    byInvoice.get(ik).push(row);
  }

  return { primary, byInvoice };
}

function auditOne(pipelineRow, index) {
  const pVendor = trim(pipelineRow.vendor_code);
  const pInvoice = trim(pipelineRow.invoice_number);
  const pJob = trim(pipelineRow.job_match_number);
  const pSub = trim(pipelineRow.subcontract_number);

  const result = {
    pipeline_id: pipelineRow.id,
    pipeline_invoice_number: pInvoice,
    pipeline_vendor_code: pVendor,
    pipeline_vendor_name: trim(pipelineRow.matched_vendor_name || pipelineRow.vendor_name),
    pipeline_job_number: pJob,
    pipeline_subcontract_number: pSub,
    pipeline_amount: pipelineRow.amount,
    pipeline_status: pipelineRow.status,
    pipeline_email_from: trim(pipelineRow.email_from),
    pipeline_email_domain: (trim(pipelineRow.email_from).split('@')[1] || '').toLowerCase(),
    // match fields
    match_type: null,
    spectrum_source: null,
    spectrum_vendor_code: null,
    spectrum_invoice_number: null,
    spectrum_job_number: null,
    spectrum_subcontract_number: null,
    spectrum_amount: null,
    // diff flags
    vendor_mismatch: false,
    job_mismatch: false,
    subcontract_mismatch: false,
    amount_mismatch: false,
    notes: [],
  };

  if (!pInvoice) {
    result.match_type = 'NO_INVOICE_NUMBER';
    result.notes.push('Pipeline row has no invoice number');
    return result;
  }

  // Try primary match: (vendor, invoice)
  const vk = `${pVendor}::${pInvoice}`;
  const primaryHits = index.primary.get(vk);

  let matchedRow = null;
  if (primaryHits && primaryHits.length > 0) {
    // Prefer APPROVAL_HDR > OPEN_ITEMS > PAYMENT_HIST when multiple hits
    const byPriority = {
      APPROVAL_HDR: 0,
      OPEN_ITEMS: 1,
      PAYMENT_HIST: 2,
    };
    const sorted = [...primaryHits].sort(
      (a, b) => (byPriority[a.source] ?? 99) - (byPriority[b.source] ?? 99)
    );
    matchedRow = sorted[0];
    result.match_type = 'EXACT';
  } else {
    // Try invoice-only fallback
    const invoiceHits = index.byInvoice.get(pInvoice);
    if (invoiceHits && invoiceHits.length > 0) {
      matchedRow = invoiceHits[0];
      result.match_type = 'INVOICE_ONLY';
      result.vendor_mismatch = true;
      result.notes.push(
        `Vendor mismatch: pipeline=${pVendor}, spectrum=${trim(matchedRow.vendor_code)}`
      );
    } else {
      result.match_type = 'NOT_IN_SPECTRUM';
      result.notes.push('No match in Spectrum (open items, in-approval, or 2y payment history)');
      return result;
    }
  }

  // Populate Spectrum fields
  result.spectrum_source = matchedRow.source;
  result.spectrum_vendor_code = trim(matchedRow.vendor_code);
  result.spectrum_invoice_number = trim(matchedRow.invoice_number);
  result.spectrum_job_number = trim(matchedRow.job_number);
  result.spectrum_subcontract_number = trim(matchedRow.subcontract_number);
  result.spectrum_amount = matchedRow.invoice_amount;

  // Field-level diffs (only when both sides have a value)
  if (pJob && result.spectrum_job_number && pJob !== result.spectrum_job_number) {
    result.job_mismatch = true;
    result.notes.push(`Job: pipeline=${pJob}, spectrum=${result.spectrum_job_number}`);
  }
  if (
    pSub &&
    result.spectrum_subcontract_number &&
    pSub !== result.spectrum_subcontract_number
  ) {
    result.subcontract_mismatch = true;
    result.notes.push(
      `Subcontract: pipeline=${pSub}, spectrum=${result.spectrum_subcontract_number}`
    );
  }

  // Amount compare (to 2 decimals)
  if (pipelineRow.amount != null && result.spectrum_amount != null) {
    const p = Number(pipelineRow.amount);
    const s = Number(result.spectrum_amount);
    if (!Number.isNaN(p) && !Number.isNaN(s) && Math.abs(p - s) > 0.01) {
      result.amount_mismatch = true;
      result.notes.push(`Amount: pipeline=${p.toFixed(2)}, spectrum=${s.toFixed(2)}`);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Output
// ────────────────────────────────────────────────────────────────────────
function summarize(results) {
  const buckets = {
    EXACT_CLEAN: 0,
    EXACT_WITH_MISMATCH: 0,
    INVOICE_ONLY: 0,
    NOT_IN_SPECTRUM: 0,
    NO_INVOICE_NUMBER: 0,
  };

  const mismatchCounts = {
    vendor: 0,
    job: 0,
    subcontract: 0,
    amount: 0,
  };

  for (const r of results) {
    if (r.match_type === 'EXACT') {
      const anyMismatch =
        r.vendor_mismatch || r.job_mismatch || r.subcontract_mismatch || r.amount_mismatch;
      if (anyMismatch) buckets.EXACT_WITH_MISMATCH++;
      else buckets.EXACT_CLEAN++;
    } else if (r.match_type === 'INVOICE_ONLY') {
      buckets.INVOICE_ONLY++;
    } else if (r.match_type === 'NOT_IN_SPECTRUM') {
      buckets.NOT_IN_SPECTRUM++;
    } else if (r.match_type === 'NO_INVOICE_NUMBER') {
      buckets.NO_INVOICE_NUMBER++;
    }

    if (r.vendor_mismatch) mismatchCounts.vendor++;
    if (r.job_mismatch) mismatchCounts.job++;
    if (r.subcontract_mismatch) mismatchCounts.subcontract++;
    if (r.amount_mismatch) mismatchCounts.amount++;
  }

  return { buckets, mismatchCounts, total: results.length };
}

function toCsv(results) {
  const headers = [
    'pipeline_id',
    'pipeline_invoice_number',
    'pipeline_vendor_code',
    'pipeline_vendor_name',
    'pipeline_job_number',
    'pipeline_subcontract_number',
    'pipeline_amount',
    'pipeline_status',
    'pipeline_email_domain',
    'match_type',
    'spectrum_source',
    'spectrum_vendor_code',
    'spectrum_invoice_number',
    'spectrum_job_number',
    'spectrum_subcontract_number',
    'spectrum_amount',
    'vendor_mismatch',
    'job_mismatch',
    'subcontract_mismatch',
    'amount_mismatch',
    'notes',
  ];

  const escape = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const lines = [headers.join(',')];
  for (const r of results) {
    const row = headers.map((h) => {
      if (h === 'notes') return escape((r.notes || []).join(' | '));
      return escape(r[h]);
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function uploadToBox(filePath) {
  if (NO_UPLOAD) {
    log(`[no-upload] would upload: ${filePath}`);
    return;
  }
  try {
    const out = execFileSync(
      'node', [BOX_SCRIPT, 'upload', filePath, BOX_AUDIT_FOLDER],
      { encoding: 'utf8', timeout: 60000 }
    );
    log(`  ↑ Box upload: ${path.basename(filePath)}`);
    return out;
  } catch (e) {
    log(`  ⚠️  Box upload failed for ${path.basename(filePath)}: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const runId = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .replace('T', '_');

  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });

    const pipelineRows = await pullPipelineInvoices();
    const spectrumRows = pullSpectrumInvoices();

    log('Building Spectrum indexes…');
    const index = buildSpectrumIndex(spectrumRows);

    log('Auditing pipeline rows…');
    const results = pipelineRows.map((row) => auditOne(row, index));

    const summary = summarize(results);
    const durationMs = Date.now() - startTime;

    const report = {
      runId,
      generatedAt: new Date().toISOString(),
      durationMs,
      pipelineCount: pipelineRows.length,
      spectrumCount: spectrumRows.length,
      summary,
      results,
    };

    // Write outputs
    const jsonPath = path.join(AUDIT_DIR, `${runId}_audit.json`);
    const csvPath = path.join(AUDIT_DIR, `${runId}_audit.csv`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(csvPath, toCsv(results));
    log(`Wrote ${jsonPath}`);
    log(`Wrote ${csvPath}`);

    // Box upload
    uploadToBox(jsonPath);
    uploadToBox(csvPath);

    // Discord summary
    const { buckets, mismatchCounts, total } = summary;
    const msg = [
      `📊 **Audit run ${runId}**`,
      `Pipeline invoices scanned: **${total}**`,
      `Spectrum rows indexed: **${spectrumRows.length}**`,
      `Duration: ${(durationMs / 1000).toFixed(1)}s`,
      ``,
      `**Match results:**`,
      `  ✅ Exact match, clean: **${buckets.EXACT_CLEAN}**`,
      `  ⚠️ Exact match, field mismatch: **${buckets.EXACT_WITH_MISMATCH}**`,
      `  🟡 Invoice# match, vendor mismatch: **${buckets.INVOICE_ONLY}**`,
      `  🔴 Not in Spectrum: **${buckets.NOT_IN_SPECTRUM}**`,
      `  ❓ Missing invoice number: **${buckets.NO_INVOICE_NUMBER}**`,
      ``,
      `**Field-level mismatches:**`,
      `  Vendor: ${mismatchCounts.vendor} · Job: ${mismatchCounts.job} · Subcontract: ${mismatchCounts.subcontract} · Amount: ${mismatchCounts.amount}`,
      ``,
      `📁 Uploaded to Box: invoices/audit/${runId}_audit.json + .csv`,
    ].join('\n');

    log('─'.repeat(60));
    log('SUMMARY');
    log('─'.repeat(60));
    console.log(msg);

    postDiscord(msg);

    await pool.end();
    process.exit(0);
  } catch (err) {
    log(`ERROR: ${err.message}`);
    console.error(err.stack);
    postDiscord(`\`\`\`\n${err.message}\n\`\`\``, true);
    try {
      await pool.end();
    } catch {}
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { sqlQuery, postDiscord, uploadToBox };
