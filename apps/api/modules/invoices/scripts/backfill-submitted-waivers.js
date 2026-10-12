#!/usr/bin/env node
'use strict';

/**
 * Operator-run historical repair for lien waivers paired to invoices that
 * were submitted before automatic discard existed. This script is dry-run by
 * default; apply mode requires an explicit --apply and is never invoked by
 * application code.
 */

const logger = require('../../../lib/logger');
const { withScriptClient } = require('../../../lib/scriptDb');
const { discardLinkedLienWaiverForSubmittedInvoice } = require('../services/documentDiscardService');

async function withClientTransaction(db, work) {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch {}
    throw err;
  }
}

async function backfillSubmittedLinkedWaivers({ db, dryRun = true } = {}) {
  if (!db) return withScriptClient((client) => backfillSubmittedLinkedWaivers({ db: client, dryRun }));

  const { rows } = await db.query(
    `SELECT id, linked_lien_waiver_id
     FROM documents
     WHERE status = 'submitted'
       AND classification IN ('invoice', 'pay-application')
       AND deleted_at IS NULL
       AND linked_lien_waiver_id IS NOT NULL
     ORDER BY updated_at, id`
  );
  const summary = {
    dryRun,
    total: rows.length,
    wouldDiscard: 0,
    discarded: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const row of rows) {
    if (dryRun) {
      summary.wouldDiscard++;
      summary.details.push({ invoiceId: row.id, waiverId: row.linked_lien_waiver_id, outcome: 'would_discard' });
      continue;
    }

    try {
      const outcome = await withClientTransaction(db, async () => {
        const current = (await db.query(
          `SELECT id, status, classification, deleted_at, linked_lien_waiver_id
           FROM documents WHERE id = $1 FOR UPDATE`,
          [row.id]
        )).rows[0];
        if (!current || current.status !== 'submitted' || current.deleted_at || !current.linked_lien_waiver_id) {
          return { outcome: 'invoice_changed' };
        }
        return discardLinkedLienWaiverForSubmittedInvoice({
          db,
          invoiceId: current.id,
          waiverId: current.linked_lien_waiver_id,
        });
      });
      summary.details.push({ invoiceId: row.id, waiverId: row.linked_lien_waiver_id, outcome: outcome.outcome });
      if (outcome.outcome === 'discarded') summary.discarded++;
      else summary.skipped++;
    } catch (err) {
      summary.errors++;
      logger.warn({ err, invoiceId: row.id }, 'backfillSubmittedLinkedWaivers: invoice skipped');
    }
  }

  logger.info(summary, 'backfillSubmittedLinkedWaivers: complete');
  return summary;
}

function parseArgs(argv) {
  return { dryRun: !argv.includes('--apply') };
}

async function main(argv) {
  const { dryRun } = parseArgs(argv);
  const summary = await backfillSubmittedLinkedWaivers({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.errors > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  backfillSubmittedLinkedWaivers,
  parseArgs,
  withClientTransaction,
};
