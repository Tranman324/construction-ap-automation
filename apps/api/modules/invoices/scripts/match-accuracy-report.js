#!/usr/bin/env node
'use strict';
/**
 * Match Accuracy Report — feedback-loop telemetry for the invoice pipeline.
 *
 * Answers: "Is matching getting better?" by aggregating, for a given window:
 *   - match method distribution (cache vs fuzzy vs heuristic vs no-match)
 *   - cache hit rate (the learning loop's success metric)
 *   - human correction rate (edited/reclassified vs approved-unchanged)
 *   - which fields humans corrected (from audit_log diffs)

 *
 * Usage:
 *   node match-accuracy-report.js            — last 30 days
 *   node match-accuracy-report.js --days 90  — custom window
 *   node match-accuracy-report.js --json     — machine-readable output
 */

const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();

const CACHE_METHODS = new Set(['cache-domain', 'cache-name', 'cache', 'job-feedback-cache']);

async function buildReport(days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const [vendorMethods, jobMethods, subMethods, auditActions, editDiffs, mappingSizes] = await Promise.all([
    pool.query(
      `SELECT COALESCE(vendor_match_method,'(null)') m, COUNT(*) c FROM documents
       WHERE classification IN ('invoice','receipt') AND deleted_at IS NULL AND queued_at >= $1
       GROUP BY 1 ORDER BY 2 DESC`, [since]),
    pool.query(
      `SELECT COALESCE(job_match_method,'(null)') m, COUNT(*) c FROM documents
       WHERE classification IN ('invoice','receipt') AND deleted_at IS NULL AND queued_at >= $1
       GROUP BY 1 ORDER BY 2 DESC`, [since]),
    pool.query(
      `SELECT COALESCE(subcontract_match_method,'(null)') m, COUNT(*) c FROM documents
       WHERE classification IN ('invoice','receipt') AND deleted_at IS NULL AND queued_at >= $1
       GROUP BY 1 ORDER BY 2 DESC`, [since]),
    pool.query(
      `SELECT action, COUNT(*) c FROM audit_log
       WHERE created_at >= $1 AND action IN ('approved','edited','reclassified','rejected')
       GROUP BY 1`, [since]),
    pool.query(
      `SELECT changes FROM audit_log
       WHERE created_at >= $1 AND action = 'edited' AND changes IS NOT NULL`, [since]),
    pool.query(
      `SELECT
        (SELECT COUNT(*) FROM vendor_mappings) vendors,
        (SELECT COUNT(*) FROM job_mappings) jobs,
        (SELECT COUNT(*) FROM subcontract_mappings) subs`),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.m, parseInt(r.c, 10)]));
  const vendor = toMap(vendorMethods.rows);
  const job = toMap(jobMethods.rows);
  const sub = toMap(subMethods.rows);

  const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
  const cacheHits = (obj) => Object.entries(obj)
    .filter(([m]) => CACHE_METHODS.has(m))
    .reduce((a, [, c]) => a + c, 0);

  const totalDocs = sum(vendor);
  const actions = Object.fromEntries(auditActions.rows.map((r) => [r.action, parseInt(r.c, 10)]));

  // Which fields do humans fix?
  const correctedFields = {};
  for (const row of editDiffs.rows) {
    try {
      const changes = typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes;
      for (const key of Object.keys(changes)) correctedFields[key] = (correctedFields[key] || 0) + 1;
    } catch {}
  }


  const approved = actions.approved || 0;
  const edited = actions.edited || 0;

  return {
    windowDays: days,
    since,
    totalDocs,
    vendorMethods: vendor,
    jobMethods: job,
    subcontractMethods: sub,
    cacheHitRate: {
      vendor: totalDocs ? +(cacheHits(vendor) / totalDocs * 100).toFixed(1) : 0,
      job: totalDocs ? +(cacheHits(job) / totalDocs * 100).toFixed(1) : 0,
      subcontract: totalDocs ? +(cacheHits(sub) / totalDocs * 100).toFixed(1) : 0,
    },

    humanActions: actions,
    correctionRate: approved + edited ? +(edited / (approved + edited) * 100).toFixed(1) : 0,
    correctedFields,
    mappingTableSizes: mappingSizes.rows[0],
  };
}

function formatText(r) {
  const lines = [];
  lines.push(`📊 Invoice Match Accuracy — last ${r.windowDays} days (${r.totalDocs} docs)`);
  lines.push('');
  lines.push(`Cache hit rate (learning loop): vendor ${r.cacheHitRate.vendor}% | job ${r.cacheHitRate.job}% | subcontract ${r.cacheHitRate.subcontract}%`);

  lines.push(`Human correction rate: ${r.correctionRate}% (${r.humanActions.edited || 0} edited vs ${r.humanActions.approved || 0} approved)`);
  const cf = Object.entries(r.correctedFields).sort((a, b) => b[1] - a[1]);
  if (cf.length) lines.push(`Fields corrected: ${cf.map(([k, v]) => `${k}×${v}`).join(', ')}`);
  lines.push(`Mapping tables: ${r.mappingTableSizes.vendors} vendors, ${r.mappingTableSizes.jobs} jobs, ${r.mappingTableSizes.subs} subcontracts`);
  lines.push('');
  const fmt = (obj) => Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(' ');
  lines.push(`Vendor methods: ${fmt(r.vendorMethods)}`);
  lines.push(`Job methods: ${fmt(r.jobMethods)}`);
  lines.push(`Subcontract methods: ${fmt(r.subcontractMethods)}`);
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) || 30 : 30;
  const asJson = args.includes('--json');

  buildReport(days)
    .then((report) => {
      process.stdout.write(asJson ? JSON.stringify(report, null, 2) : formatText(report));
      process.stdout.write('\n');
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`match-accuracy-report failed: ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { buildReport, formatText };
