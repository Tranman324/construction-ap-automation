'use strict';

// A Spectrum COI upload that returns no transaction ID never attached the PDF.
// It must land as a retryable 'failed', never 'success' / 'submitted'.

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const servicePath = path.join(root, 'modules/invoices/services/spectrumCoiUploadService.js');

function load(uploadResult) {
  const statusWrites = [];
  const audits = [];
  const logs = [];
  const uploadCoi = typeof uploadResult === 'function' ? uploadResult : async () => uploadResult;
  const pool = {
    async query(sql, params = []) {
      if (sql.startsWith('UPDATE documents SET spectrum_upload_status')) {
        const cols = [...sql.matchAll(/(\w+) = \$(\d+)/g)].reduce((acc, [, col, n]) => {
          acc[col] = params[Number(n) - 1];
          return acc;
        }, {});
        statusWrites.push(cols);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const original = Module._load;
  Module._load = function mocked(request, parent, isMain) {
    if (parent?.filename === servicePath && request === '../../../lib/db') return pool;
    if (parent?.filename === servicePath && request === '../../../lib/logger') return { info() {}, warn() {}, error(obj) { logs.push(obj); } };
    if (parent?.filename === servicePath && request === '../../../lib/auditEvents') {
      return { emitInvoiceAuditEvent: async (_req, _res, event) => { audits.push(event); } };
    }
    if (parent?.filename === servicePath && request === './utils') return { readJSON: () => [] };
    if (request.endsWith('/lib/coi-upload')) return { uploadCoi, getQueueDepth: () => 0 };
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  const service = require(servicePath);
  return {
    service, statusWrites, audits, logs,
    cleanup() { Module._load = original; delete require.cache[servicePath]; },
  };
}

test('missing transId is recorded as a retryable failure, not success', async () => {
  const t = load({ success: false, transId: null, trackingCode: 'COI 2027', message: 'skipped', sweep: null });
  try {
    await t.service._processUpload({}, {}, 'doc-1', 'ZTEN91', '2027-10-01', '/tmp/coi.pdf', 2);
  } finally { t.cleanup(); }

  const final = t.statusWrites.at(-1);
  assert.equal(final.spectrum_upload_status, 'failed');
  assert.equal(final.status, undefined, 'document must stay pending, not submitted');
  assert.match(final.spectrum_upload_error, /PDF was not attached/);
  assert.match(final.spectrum_upload_error, /Retry the upload/);
  assert.equal(
    final.spectrum_upload_error,
    'Spectrum did not confirm the COI tracking item, so the PDF was not attached. '
      + 'Nothing was saved in Spectrum. Retry the upload.',
    'the service-authored plain-English message passes through unchanged',
  );
  assert.ok(!t.statusWrites.some((w) => w.spectrum_upload_status === 'success'));
  assert.deepEqual(t.audits.map((a) => a.type), ['document.spectrum_upload_failed']);
});

test('a returned transId still records success and submits the document', async () => {
  const t = load({ success: true, transId: 'ABC-123', trackingCode: 'COI 2027', message: 'ok', sweep: null });
  try {
    await t.service._processUpload({}, {}, 'doc-1', 'ZTEN91', '2027-10-01', '/tmp/coi.pdf', 1);
  } finally { t.cleanup(); }

  const final = t.statusWrites.at(-1);
  assert.equal(final.spectrum_upload_status, 'success');
  assert.equal(final.spectrum_upload_trans_id, 'ABC-123');
  assert.equal(final.status, 'submitted');
  assert.deepEqual(t.audits.map((a) => a.type), ['document.spectrum_upload_succeeded']);
});

test('a thrown credentials error stores the plain-English message; raw text stays in audit and logs', async () => {
  const raw = 'Credentials not found. Set SPECTRUM_USER/SPECTRUM_PASS env vars or create /etc/toolbox/spectrum.env';
  const t = load(async () => { throw new Error(raw); });
  try {
    await t.service._processUpload({}, {}, 'doc-1', 'ZTEN91', '2027-10-01', '/tmp/coi.pdf', 1);
  } finally { t.cleanup(); }

  const friendly = 'Toolbox could not sign in to Spectrum. Ask an admin to check the Spectrum connection, then retry.';
  const final = t.statusWrites.at(-1);
  assert.equal(final.spectrum_upload_status, 'failed');
  assert.equal(final.spectrum_upload_error, friendly);
  assert.ok(!final.spectrum_upload_error.includes('/root/'));
  assert.ok(!final.spectrum_upload_error.includes('SPECTRUM_'));

  assert.equal(t.audits.length, 1);
  const [audit] = t.audits;
  assert.equal(audit.type, 'document.spectrum_upload_failed');
  assert.equal(audit.summary, `COI upload failed: ${friendly}`);
  assert.equal(audit.afterState.error, raw);
  assert.equal(audit.afterState.userMessage, friendly);

  assert.equal(t.logs.length, 1);
  assert.equal(t.logs[0].err.message, raw);
  assert.equal(t.logs[0].userMessage, friendly);
});
