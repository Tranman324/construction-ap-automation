'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { run } = require('../../modules/invoices/scripts/purge');
const {
  getConfirmedSubjectJobMapping,
  recordSubjectJobFeedback,
} = require('../../modules/invoices/services/matcher');
const { classifyMigrationSql } = require('../../lib/migrations');

const oldUpdatedAt = '2026-01-01T00:00:00.000Z';

function makePurgePool({ failureByDocument = {} } = {}) {
  const calls = [];
  const released = [];
  const documents = [
    { id: 'fk-blocked', classification: 'receipt', status: 'discarded', file_path: '/tmp/fk-blocked.pdf', box_file_id: 'box-fk', updated_at: oldUpdatedAt },
    { id: 'eligible-after-fk', classification: 'receipt', status: 'discarded', file_path: '/tmp/eligible.pdf', box_file_id: 'box-ok', updated_at: oldUpdatedAt },
  ];

  return {
    calls,
    released,
    async query(sql) {
      if (sql.includes('FROM retention_settings')) {
        return { rows: [{ classification: '*', status: 'discarded', retention_days: 1, delete_pdf: true, delete_box: true }] };
      }
      if (sql.includes('FROM documents') && sql.includes('ORDER BY updated_at')) return { rows: documents };
      if (sql.includes("SET status = 'error'")) return { rows: [] };
      throw new Error(`unexpected pool query: ${sql}`);
    },
    async connect() {
      const clientCalls = [];
      calls.push(clientCalls);
      return {
        async query(sql, params = []) {
          clientCalls.push({ sql, params });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
          if (sql.includes('INSERT INTO audit_events')) {
            const documentId = params[5];
            if (failureByDocument[documentId] === 'audit') throw new Error('audit store unavailable');
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith('DELETE FROM documents')) {
            const documentId = params[0];
            if (failureByDocument[documentId] === 'fk') {
              const error = new Error('update or delete violates foreign key constraint');
              error.code = '23503';
              throw error;
            }
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`unexpected client query: ${sql}`);
        },
        release() { released.push(clientCalls); },
      };
    },
    async end() {},
  };
}

test('purge rolls back an FK-blocked document, preserves its files, and continues with later eligible documents', async () => {
  const pool = makePurgePool({ failureByDocument: { 'fk-blocked': 'fk' } });
  const localDeletes = [];
  const boxDeletes = [];
  const notices = [];

  const result = await run({
    pool,
    dryRun: false,
    deleteLocalFile(filePath) { localDeletes.push(filePath); return 128; },
    async deleteFromBox(fileId) { boxDeletes.push(fileId); return true; },
    async notifyDiscord(message) { notices.push(message); },
  });

  assert.equal(result.totalPurged, 1);
  assert.deepEqual(localDeletes, ['/tmp/eligible.pdf']);
  assert.deepEqual(boxDeletes, ['box-ok']);
  assert.equal(notices.length, 1);
  assert.equal(pool.released.length, 2);

  const blockedCalls = pool.calls[0].map(({ sql }) => sql);
  assert.deepEqual(blockedCalls.slice(0, 4), ['BEGIN', blockedCalls[1], blockedCalls[2], 'ROLLBACK']);
  assert.match(blockedCalls[1], /INSERT INTO audit_events/i);
  assert.match(blockedCalls[2], /^DELETE FROM documents/i);

  const successfulCalls = pool.calls[1].map(({ sql }) => sql);
  assert.deepEqual(successfulCalls.slice(0, 4), ['BEGIN', successfulCalls[1], successfulCalls[2], 'COMMIT']);
  assert.match(successfulCalls[1], /INSERT INTO audit_events/i);
  assert.doesNotMatch(successfulCalls[1], /document_id/i);
  assert.match(successfulCalls[2], /^DELETE FROM documents/i);
});

test('purge does not delete a document when durable audit insertion fails', async () => {
  const pool = makePurgePool({ failureByDocument: { 'fk-blocked': 'audit', 'eligible-after-fk': 'audit' } });
  const localDeletes = [];
  const boxDeletes = [];

  const result = await run({
    pool,
    dryRun: false,
    deleteLocalFile(filePath) { localDeletes.push(filePath); return 1; },
    async deleteFromBox(fileId) { boxDeletes.push(fileId); return true; },
  });

  assert.equal(result.totalPurged, 0);
  assert.deepEqual(localDeletes, []);
  assert.deepEqual(boxDeletes, []);
  for (const clientCalls of pool.calls) {
    assert.equal(clientCalls.some(({ sql }) => /^DELETE FROM documents/i.test(sql)), false);
    assert.equal(clientCalls.at(-1).sql, 'ROLLBACK');
  }
});

test('subject feedback mappings require two confirmations before they can be read', async () => {
  const queries = [];
  const oneHit = await getConfirmedSubjectJobMapping({
    vendorCode: 'V-1',
    subjectHash: 'invoice-july',
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ job_number: '26-101', hit_count: 1 }] };
    },
  });
  const twoHits = await getConfirmedSubjectJobMapping({
    vendorCode: 'V-1',
    subjectHash: 'invoice-july',
    async query() {
      return { rows: [{ job_number: '26-101', hit_count: 2 }] };
    },
  });

  assert.equal(oneHit, null);
  assert.deepEqual(twoHits, { job_number: '26-101', hit_count: 2 });
  assert.match(queries[0].sql, /hit_count\s*>=\s*2/i);
  assert.deepEqual(queries[0].params, ['V-1', 'invoice-july']);
});

test('subject feedback records increment only matching confirmations and reset on a changed job', async () => {
  let captured;
  const result = await recordSubjectJobFeedback({
    vendorCode: 'V-1',
    emailSubject: 'Invoice for North Tower',
    jobNumber: '26-101',
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [] };
    },
  });

  assert.equal(result.recorded, true);
  assert.match(captured.sql, /hit_count\s*=\s*CASE/i);
  assert.match(captured.sql, /job_number\s*=\s*EXCLUDED\.job_number[\s\S]*hit_count\s*\+\s*1/i);
  assert.match(captured.sql, /ELSE\s+1/i);
  assert.equal(captured.params[0], 'V-1');
  assert.equal(captured.params[2], '26-101');
});

test('purge and subject-feedback migration is additive, transaction-wrapped, and safe to rerun', () => {
  const migrationPath = path.join(__dirname, '..', '..', 'migrations', '2026-07-16_purge_audit_and_subject_feedback.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_subject_job_mappings_confirmed/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
});
