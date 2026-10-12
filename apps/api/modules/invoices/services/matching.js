'use strict';
/**
 * Matching service
 * - Waiver scoring algorithm
 * - Subcontracts map cache
 */

const fs = require('fs');
const { SUBCONTRACTS_PATH, JOBS_PATH } = require('../../../config');
const logger = require('../../../lib/logger');

// ─── Cached Subcontracts Map ─────────────────────────────────────────────────
let _subcontractsCache = null;
let _subcontractsMtime = 0;

function getSubcontractsMap() {
  try {
    const stat = fs.statSync(SUBCONTRACTS_PATH);
    if (!_subcontractsCache || stat.mtimeMs !== _subcontractsMtime) {
      const data = JSON.parse(fs.readFileSync(SUBCONTRACTS_PATH, 'utf8'));
      const arr = Array.isArray(data) ? data : (data.Subcontracts || data.subcontracts || []);
      const map = {};
      for (const s of arr) {
        if (s.subcontract_number) map[s.subcontract_number] = s;
      }
      _subcontractsCache = map;
      _subcontractsMtime = stat.mtimeMs;
      logger.info({ subcontractCount: Object.keys(map).length }, 'Subcontracts cache loaded');
    }
  } catch (e) {
    logger.error({ err: e }, 'Failed to load subcontracts cache');
    if (!_subcontractsCache) _subcontractsCache = {};
  }
  return _subcontractsCache;
}

// ─── Cached Job Descriptions Map ─────────────────────────────────────────────
let _jobDescCache = null;
let _jobDescMtime = 0;

const decodeHTMLEntities = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'");

/**
 * Job number → Spectrum job description map, cached on file mtime.
 * Display-only: consumers must not feed these values into filing paths
 * or filenames (those resolve through filingValueResolver precedence).
 */
function getJobDescriptionMap() {
  try {
    const stat = fs.statSync(JOBS_PATH);
    if (!_jobDescCache || stat.mtimeMs !== _jobDescMtime) {
      const data = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
      const arr = Array.isArray(data) ? data : (data.Jobs || data.jobs || []);
      const map = {};
      for (const j of arr) {
        const num = String(j.Job_Number || j.number || '').trim();
        const desc = decodeHTMLEntities(String(j.Job_Description || j.description || '').trim());
        if (num && desc) map[num] = desc;
      }
      _jobDescCache = map;
      _jobDescMtime = stat.mtimeMs;
      logger.info({ jobCount: Object.keys(map).length }, 'Job descriptions cache loaded');
    }
  } catch (e) {
    logger.error({ err: e }, 'Failed to load job descriptions cache');
    if (!_jobDescCache) _jobDescCache = {};
  }
  return _jobDescCache;
}

/** Spectrum description for a job number, or null when unknown. */
function getJobDescription(jobNumber) {
  if (!jobNumber) return null;
  return getJobDescriptionMap()[String(jobNumber).trim()] || null;
}

/**
 * Score how well a waiver matches an invoice.
 * Returns { score, tags, matchStrength } or null if below threshold.
 *
 * Scoring (max 110):
 *   vendor exact match  = 50pts
 *   amount exact match  = 30pts | within 5% = 25pts | within 10% = 15pts | within 20% = 5pts
 *   job exact match     = 15pts
 *   same email sender   = 5pts
 *   date proximity      = 10pts (≤7d) | 5pts (≤30d) | 0pts (>30d)
 *
 * Minimum threshold: 50pts
 */
function scoreWaiverMatch(invoice, waiver) {
  let score = 0;
  const tags = [];

  const iVendor = invoice.vendor_code || null;
  const iAmount = invoice.amount != null ? parseFloat(invoice.amount) : null;
  const iJob    = invoice.job_match_number || null;
  const iEmail  = invoice.email_from || null;
  const iDate   = invoice.email_received_at || invoice.queued_at || null;

  const wVendor = waiver.vendor_code || null;
  const wAmount = waiver.amount != null ? parseFloat(waiver.amount) : null;
  const wJob    = waiver.job_match_number || null;
  const wEmail  = waiver.email_from || null;
  const wDate   = waiver.email_received_at || waiver.queued_at || null;

  // Vendor (50pts)
  if (iVendor && wVendor && iVendor === wVendor) {
    score += 50;
    tags.push('same-vendor');
  }

  // Amount — fuzzy (30/25/15/5pts)
  if (iAmount != null && wAmount != null && iAmount > 0 && wAmount > 0) {
    const diff = Math.abs(iAmount - wAmount) / Math.max(iAmount, wAmount);
    if (diff === 0) {
      score += 30; tags.push('amount-exact');
    } else if (diff <= 0.05) {
      score += 25; tags.push('amount-close-5pct');
    } else if (diff <= 0.10) {
      score += 15; tags.push('amount-close-10pct');
    } else if (diff <= 0.20) {
      score += 5;  tags.push('amount-close-20pct');
    }
  }

  // Job (15pts)
  if (iJob && wJob && iJob === wJob) {
    score += 15;
    tags.push('same-job');
  }

  // Email (5pts)
  if (iEmail && wEmail && iEmail === wEmail) {
    score += 5;
    tags.push('same-email');
  }

  // Date proximity (10/5pts)
  if (iDate && wDate) {
    const daysDiff = Math.abs(new Date(iDate) - new Date(wDate)) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 7) {
      score += 10; tags.push('date-within-7d');
    } else if (daysDiff <= 30) {
      score += 5;  tags.push('date-within-30d');
    }
  }

  if (score < 50) return null;

  let matchStrength;
  if (score >= 80) matchStrength = 'strong';
  else if (score >= 65) matchStrength = 'moderate';
  else matchStrength = 'weak';

  return { score, tags, matchStrength };
}

module.exports = { getSubcontractsMap, getJobDescription };
