#!/usr/bin/env node
/**
 * One-time routing-code backfill (owner ruling 2026-07-23).
 *
 * Scope: PENDING documents with a job match and no routing_code. For each,
 * derive routing = pm_to_routing[job PM] || 'D' and persist it with a
 * system-actor audit entry. Non-pending documents (approved/submitted/
 * discarded/deleted history) are never touched, and an existing routing_code
 * is never overwritten (enforced in both the SELECT and the UPDATE WHERE).
 *
 * Usage:
 *   node backfill-routing-codes.js            # apply
 *   node backfill-routing-codes.js --dry-run  # preview only
 */

'use strict';

const logger = require('../../../lib/logger');
const { deriveRoutingCode } = require('../services/submitRouting');

async function backfillRoutingCodes({ db, dryRun = false } = {}) {
  if (!db) {
    // Scripts must not hold the shared API pool — run on a single script client.
    const { withScriptClient } = require('../../../lib/scriptDb');
    return withScriptClient((client) => backfillRoutingCodes({ db: client, dryRun }));
  }
  const pool = db;

  const { rows } = await pool.query(`
    SELECT id, job_match_number, routing_code
    FROM documents
    WHERE status = 'pending'
      AND deleted_at IS NULL
      AND job_match_number IS NOT NULL AND btrim(job_match_number) <> ''
      AND (routing_code IS NULL OR btrim(routing_code) = '')
    ORDER BY queued_at
  `);

  const summary = { total: rows.length, updated: 0, skipped: 0, errors: 0, details: [] };

  for (const row of rows) {
    try {
      const routingCode = deriveRoutingCode(row.job_match_number);
      if (!routingCode) {
        summary.skipped++;
        continue;
      }

      summary.details.push({ docId: row.id, jobNumber: row.job_match_number, routingCode });

      if (!dryRun) {
        const result = await pool.query(
          `UPDATE documents
           SET routing_code = $1, updated_at = NOW()
           WHERE id = $2
             AND status = 'pending'
             AND (routing_code IS NULL OR btrim(routing_code) = '')
             AND job_match_number = $3`,
          [routingCode, row.id, row.job_match_number]
        );
        if (result.rowCount === 0) {
          summary.skipped++;
          summary.details.pop();
          continue;
        }
        await pool.query(
          'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
          [row.id, 'routing_backfilled', 'system', JSON.stringify({
            routing_code: [row.routing_code || null, routingCode],
            source: 'backfill-routing-codes (PM-else-D, owner ruling 2026-07-23)',
          })]
        );
      }
      summary.updated++;
    } catch (err) {
      summary.errors++;
      logger.warn({ err, docId: row.id }, 'backfillRoutingCodes: error processing document (skipped)');
    }
  }

  logger.info(
    { total: summary.total, updated: summary.updated, skipped: summary.skipped, errors: summary.errors, dryRun },
    'backfillRoutingCodes: complete'
  );
  return summary;
}

module.exports = { backfillRoutingCodes };

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  backfillRoutingCodes({ dryRun })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      process.exit(summary.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
