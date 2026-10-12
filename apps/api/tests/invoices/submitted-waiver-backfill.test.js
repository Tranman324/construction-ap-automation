'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(root, relativePath);
}

async function withOfflineBackfillScript(fn) {
  const scriptPath = modulePath('modules/invoices/scripts/backfill-submitted-waivers.js');
  const discardServicePath = modulePath('modules/invoices/services/documentDiscardService.js');
  const auditEventsPath = modulePath('lib/auditEvents.js');
  const paths = [scriptPath, discardServicePath, auditEventsPath];
  const previous = new Map(paths.map((filePath) => [filePath, require.cache[filePath]]));
  const auditEvents = [];

  for (const filePath of paths) delete require.cache[filePath];
  require.cache[auditEventsPath] = {
    id: auditEventsPath,
    filename: auditEventsPath,
    loaded: true,
    exports: {
      emitInvoiceAuditEvent: async (...args) => { auditEvents.push(args); },
      emitLegacyInvoiceAuditEvent: async (...args) => { auditEvents.push(args); },
    },
  };

  try {
    return await fn(require(scriptPath), auditEvents);
  } finally {
    for (const filePath of paths) {
      const cached = previous.get(filePath);
      if (cached) require.cache[filePath] = cached;
      else delete require.cache[filePath];
    }
  }
}

test('submitted-waiver backfill defaults to dry-run and issues no mutation or audit', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/SELECT id, linked_lien_waiver_id/.test(sql)) {
        return { rows: [{ id: 'invoice-1', linked_lien_waiver_id: 'waiver-1' }] };
      }
      throw new Error(`Unexpected write in dry run: ${sql}`);
    },
  };
  const { summary, auditEvents } = await withOfflineBackfillScript(async ({ backfillSubmittedLinkedWaivers }, emittedAudits) => ({
    summary: await backfillSubmittedLinkedWaivers({ db }),
    auditEvents: emittedAudits,
  }));

  assert.equal(summary.dryRun, true);
  assert.equal(summary.total, 1);
  assert.equal(summary.wouldDiscard, 1);
  assert.equal(calls.some((sql) => /UPDATE|INSERT|BEGIN|COMMIT/.test(sql)), false);
  assert.equal(auditEvents.length, 0);
});
