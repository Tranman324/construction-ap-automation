'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function createCoiPool(row) {
  const calls = [];
  return {
    calls,
    row,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^UPDATE documents\s+SET spectrum_upload_status = 'queued'/.test(sql)) {
        const eligible = row.id === params[0]
          && row.classification === 'coi'
          && row.file_path
          && (row.spectrum_upload_status == null || row.spectrum_upload_status === 'failed');
        if (!eligible) return { rows: [] };
        row.spectrum_upload_status = 'queued';
        row.spectrum_upload_vendor_code = params[1];
        row.spectrum_upload_attempts = (row.spectrum_upload_attempts || 0) + 1;
        return { rows: [{ ...row }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('atomic COI claim allows exactly one concurrent eligible uploader', async () => {
  const pool = createCoiPool({
    id: 'coi-1',
    classification: 'coi',
    file_path: '/tmp/coi.pdf',
    spectrum_upload_status: null,
    spectrum_upload_attempts: 0,
  });

  await withMockedModules({
    '../../../lib/db': pool,
    '../../../lib/logger': { info() {}, warn() {}, error() {} },
    '../../../lib/auditEvents': { emitInvoiceAuditEvent: async () => null },
  }, async () => {
    const { claimUpload } = freshRequire('modules/invoices/services/spectrumCoiUploadService.js');
    const claims = await Promise.all([
      claimUpload('coi-1', 'VENDOR-1'),
      claimUpload('coi-1', 'VENDOR-1'),
    ]);

    assert.deepEqual(claims.map(Boolean).sort(), [false, true]);
    assert.equal(pool.row.spectrum_upload_status, 'queued');
    assert.equal(pool.row.spectrum_upload_attempts, 1);
    assert.match(pool.calls[0].sql, /classification = 'coi'/);
    assert.match(pool.calls[0].sql, /file_path IS NOT NULL/);
    assert.match(pool.calls[0].sql, /spectrum_upload_status IS NULL OR spectrum_upload_status = 'failed'/);
  });
});

test('atomic COI claim permits a failed upload retry and increments its attempt once', async () => {
  const pool = createCoiPool({
    id: 'coi-retry',
    classification: 'coi',
    file_path: '/tmp/coi.pdf',
    spectrum_upload_status: 'failed',
    spectrum_upload_attempts: 3,
  });

  await withMockedModules({
    '../../../lib/db': pool,
    '../../../lib/logger': { info() {}, warn() {}, error() {} },
    '../../../lib/auditEvents': { emitInvoiceAuditEvent: async () => null },
  }, async () => {
    const { claimUpload } = freshRequire('modules/invoices/services/spectrumCoiUploadService.js');
    const claimed = await claimUpload('coi-retry', 'VENDOR-2');
    assert.equal(claimed.spectrum_upload_attempts, 4);
    assert.equal(pool.row.spectrum_upload_status, 'queued');
  });
});

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createErrorResponseMock() {
  function errorBody(message, code, details) {
    const body = { error: typeof message === 'string' && message ? message : 'Request failed' };
    if (typeof code === 'string' && code) body.code = code;
    if (details !== undefined) body.details = details;
    return body;
  }

  function fail(response, status, message, legacyDetailsOrCode, details) {
    if (arguments.length < 5) {
      if (legacyDetailsOrCode
        && typeof legacyDetailsOrCode === 'object'
        && !Array.isArray(legacyDetailsOrCode)
        && typeof legacyDetailsOrCode.code === 'string') {
        const { code, ...legacyDetails } = legacyDetailsOrCode;
        return response.status(status).json(errorBody(
          message,
          code,
          Object.keys(legacyDetails).length > 0 ? legacyDetails : undefined
        ));
      }
      return response.status(status).json(errorBody(message, undefined, legacyDetailsOrCode));
    }
    return response.status(status).json(errorBody(message, legacyDetailsOrCode, details));
  }

  function failFromBody(response, status, body) {
    const { error, code, details, ...legacyDetails } = body;
    const normalizedDetails = Object.keys(legacyDetails).length === 0
      ? details
      : details && typeof details === 'object' && !Array.isArray(details)
        ? { ...details, ...legacyDetails }
        : details === undefined
          ? legacyDetails
          : { value: details, ...legacyDetails };
    return response.status(status).json(errorBody(error, code, normalizedDetails));
  }

  function safeError(response, err) {
    const status = err?.statusCode || err?.status || 500;
    return status < 500
      ? fail(response, status, err?.message || 'Bad request')
      : fail(response, 500, 'Internal server error');
  }

  return { errorBody, fail, failFromBody, safeError };
}

function createLinkPool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM documents WHERE id IN/.test(sql)) {
        return {
          rows: rows
            .filter((row) => params.includes(row.id) && !row.deleted_at)
            .map((row) => ({ ...row })),
        };
      }
      if (/UPDATE documents SET linked_lien_waiver_id = \$1, waiver_link_source/.test(sql)) {
        const invoice = rows.find((row) => row.id === params[3]);
        invoice.linked_lien_waiver_id = params[0];
        return { rows: [] };
      }
      if (/UPDATE documents\s+SET linked_lien_waiver_id = \$1,\s+filed = true,/.test(sql)) {
        const waiver = rows.find((row) => row.id === params[2]);
        waiver.linked_lien_waiver_id = params[0];
        waiver.filed = true;
        waiver.filed_at ||= params[1];
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

async function linkWithRows(rows, waiverId, { failLegacyAudit = false } = {}) {
  const pool = createLinkPool(rows);
  const audits = [];
  const structuredAudits = [];
  const transactionCalls = [];
  const res = makeRes();
  const req = {
    params: { id: 'invoice-1' },
    body: { waiverId, source: 'manual' },
    log: { info() {}, error() {} },
  };

  await withMockedModules({
    '../../../middleware/errorResponse': createErrorResponseMock(),
    '../../../lib/auditEvents': {
      emitLegacyInvoiceAuditEvent: async (...args) => {
        audits.push(args);
        if (failLegacyAudit) throw new Error('audit failed');
      },
      emitInvoiceAuditEvent: async (_req, _res, event) => structuredAudits.push(event),
    },
    './pdfMergeService': { deleteMergedPdf() {}, mergeWaiverPdfForInvoice: async () => null },
    './supabase': { pool },
    './transaction': {
      withTransaction: async (dbPool, work) => {
        transactionCalls.push('BEGIN');
        try {
          const result = await work(dbPool);
          transactionCalls.push('COMMIT');
          return result;
        } catch (error) {
          transactionCalls.push('ROLLBACK');
          throw error;
        }
      },
    },
  }, async () => {
    const { linkWaiver } = freshRequire('modules/invoices/services/lienWaiverLinkService.js');
    await linkWaiver(req, res);
  });

  return { pool, audits, structuredAudits, transactionCalls, res };
}

test('lien waiver link distinguishes a missing waiver from a wrong live classification', async () => {
  const invoice = { id: 'invoice-1', classification: 'invoice', status: 'pending', linked_lien_waiver_id: null };
  const missing = await linkWithRows([{ ...invoice }], 'missing-waiver');
  assert.equal(missing.res.statusCode, 404);
  assert.equal(missing.res.body.error, 'Waiver not found');
  assert.equal(missing.audits.length, 0);

  const invalid = await linkWithRows([
    { ...invoice },
    { id: 'not-a-waiver', classification: 'receipt', linked_lien_waiver_id: null },
  ], 'not-a-waiver');
  assert.equal(invalid.res.statusCode, 422);
  assert.equal(invalid.res.body.code, 'WAIVER_CLASSIFICATION_MISMATCH');
  assert.equal(invalid.audits.length, 0);
  assert.equal(invalid.pool.calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);

  const deleted = await linkWithRows([
    { ...invoice },
    {
      id: 'deleted-waiver',
      classification: 'lien-waiver',
      linked_lien_waiver_id: null,
      deleted_at: '2026-07-16T12:00:00.000Z',
    },
  ], 'deleted-waiver');
  assert.equal(deleted.res.statusCode, 404);
  assert.equal(deleted.res.body.error, 'Waiver not found');
  assert.equal(deleted.audits.length, 0);
  assert.equal(deleted.pool.calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
});

test('lien waiver link locks and accepts a live lien-waiver document', async () => {
  const rows = [
    { id: 'invoice-1', classification: 'invoice', status: 'pending', linked_lien_waiver_id: null },
    { id: 'waiver-1', classification: 'lien-waiver', status: 'pending', linked_lien_waiver_id: null },
  ];
  const result = await linkWithRows(rows, 'waiver-1');

  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.success, true);
  assert.equal(rows[0].linked_lien_waiver_id, 'waiver-1');
  assert.equal(rows[1].linked_lien_waiver_id, 'invoice-1');
  assert.equal(rows[1].filed, true);
  assert.equal(typeof rows[1].filed_at, 'string');
  assert.match(result.pool.calls[0].sql, /deleted_at IS NULL/);
  assert.match(result.pool.calls[0].sql, /ORDER BY id FOR UPDATE/);
  const waiverUpdate = result.pool.calls.find((call) => /filed = true/.test(call.sql));
  assert.ok(waiverUpdate);
  assert.match(waiverUpdate.sql, /filed_at = COALESCE\(filed_at, \$2\)/);
  assert.equal(result.audits.length, 2);
  assert.deepEqual(result.audits[1][2], {
    invoiceId: 'invoice-1',
    linkedAt: rows[1].filed_at,
    source: 'manual',
    filed: true,
    filedAt: rows[1].filed_at,
  });
  assert.equal(result.audits[0][4], result.pool);
  assert.equal(result.audits[1][4], result.pool);
  assert.equal(result.structuredAudits.length, 2);
  assert.ok(result.structuredAudits.every((event) => event.client === result.pool));
});

test('lien waiver link refuses a terminal parent invoice before any write or audit', async () => {
  const rows = [
    { id: 'invoice-1', classification: 'invoice', status: 'submitted', linked_lien_waiver_id: null },
    { id: 'waiver-1', classification: 'lien-waiver', status: 'pending', linked_lien_waiver_id: null },
  ];
  const result = await linkWithRows(rows, 'waiver-1');

  assert.equal(result.res.statusCode, 409);
  assert.equal(result.res.body.code, 'WAIVER_PARENT_STATUS_PROTECTED');
  assert.equal(result.pool.calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
  assert.equal(result.audits.length, 0);
  assert.equal(result.structuredAudits.length, 0);
});

test('lien waiver link refuses an approved parent invoice (F3 freeze)', async () => {
  const rows = [
    { id: 'invoice-1', classification: 'invoice', status: 'approved', linked_lien_waiver_id: null },
    { id: 'waiver-1', classification: 'lien-waiver', status: 'pending', linked_lien_waiver_id: null },
  ];
  const result = await linkWithRows(rows, 'waiver-1');

  assert.equal(result.res.statusCode, 409);
  assert.equal(result.res.body.code, 'WAIVER_PARENT_STATUS_PROTECTED');
  assert.equal(result.pool.calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
  assert.equal(result.audits.length, 0);
  assert.equal(result.structuredAudits.length, 0);
});

test('lien waiver unlink refuses an approved invoice (F3 freeze)', async () => {
  const rows = [
    {
      id: 'invoice-1',
      classification: 'invoice',
      status: 'approved',
      linked_lien_waiver_id: 'waiver-1',
      merged_file_path: '/tmp/merged_invoice-1.pdf',
    },
    {
      id: 'waiver-1',
      classification: 'lien-waiver',
      status: 'pending',
      linked_lien_waiver_id: 'invoice-1',
      filed: true,
      filed_at: '2026-08-14T12:00:00.000Z',
    },
  ];
  const calls = [];
  const audits = [];
  const deletedPaths = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT linked_lien_waiver_id FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [{ linked_lien_waiver_id: rows[0].linked_lien_waiver_id }] };
      }
      if (/SELECT \* FROM documents WHERE id IN/.test(sql)) {
        return { rows: rows.filter((candidate) => params.includes(candidate.id)).map((row) => ({ ...row })) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const req = { params: { id: 'invoice-1' }, body: {}, log: { info() {}, error() {} } };
  const res = makeRes();

  await withMockedModules({
    '../../../middleware/errorResponse': createErrorResponseMock(),
    '../../../lib/auditEvents': {
      emitLegacyInvoiceAuditEvent: async (...args) => audits.push(args),
      emitInvoiceAuditEvent: async () => {},
    },
    './pdfMergeService': { deleteMergedPdf: (filePath) => deletedPaths.push(filePath) },
    './supabase': { pool },
    './transaction': { withTransaction: async (dbPool, work) => work(dbPool) },
    './waiverLinkedStatusService': { restoreLinkedWaiverPending: async () => ({ outcome: 'not_parked' }) },
  }, async () => {
    const { unlinkWaiver } = freshRequire('modules/invoices/services/lienWaiverLinkService.js');
    await unlinkWaiver(req, res);
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'WAIVER_PARENT_STATUS_PROTECTED');
  assert.match(res.body.error, /approved/i);
  assert.equal(calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
  assert.equal(audits.length, 0);
  assert.equal(deletedPaths.length, 0);
  assert.equal(rows[0].linked_lien_waiver_id, 'waiver-1');
  assert.equal(rows[1].filed, true);
});

test('merged PDF publisher re-checks the reciprocal link before writing merged_file_path (F3)', async () => {
  async function run(linkStillHolds) {
    const calls = [];
    const pool = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        assert.match(sql, /UPDATE documents SET merged_file_path = \$1/);
        assert.match(sql, /AND linked_lien_waiver_id = \$4/);
        return { rowCount: linkStillHolds ? 1 : 0, rows: [] };
      },
    };
    let result;
    await withMockedModules({
      './pdf': {
        ensurePdf: async (doc) => doc.file_path,
        mergePdfs: async () => {},
      },
    }, async () => {
      const { mergeWaiverPdfForInvoice } = freshRequire('modules/invoices/services/pdfMergeService.js');
      result = await mergeWaiverPdfForInvoice({
        pool,
        invoice: { id: 'invoice-1', file_path: '/tmp/f3-recheck/invoice.pdf' },
        waiver: { id: 'waiver-1', file_path: '/tmp/f3-recheck/waiver.pdf' },
        invoiceId: 'invoice-1',
        waiverId: 'waiver-1',
        requestLog: { info() {}, warn() {}, error() {} },
      });
    });
    return { calls, result };
  }

  const holds = await run(true);
  assert.equal(holds.result, '/tmp/f3-recheck/merged_invoice-1.pdf');
  assert.equal(holds.calls[0].params[3], 'waiver-1');

  const stale = await run(false);
  assert.equal(stale.result, null);
});

for (const status of ['submitted', 'submitting', 'split-processing', 'discarded']) {
  test(`lien waiver link refuses a ${status} waiver before any write or audit`, async () => {
    const rows = [
      { id: 'invoice-1', classification: 'invoice', status: 'pending', linked_lien_waiver_id: null },
      { id: 'waiver-1', classification: 'lien-waiver', status, linked_lien_waiver_id: null },
    ];
    const result = await linkWithRows(rows, 'waiver-1');

    assert.equal(result.res.statusCode, 409);
    assert.equal(result.res.body.code, 'WAIVER_STATUS_PROTECTED');
    assert.equal(result.pool.calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
    assert.equal(result.audits.length, 0);
    assert.equal(result.structuredAudits.length, 0);
  });
}

test('lien waiver link preserves an existing shelf timestamp while keeping the waiver filed', async () => {
  const existingFiledAt = '2026-08-01T12:00:00.000Z';
  const rows = [
    { id: 'invoice-1', classification: 'invoice', status: 'pending', linked_lien_waiver_id: null },
    {
      id: 'waiver-1',
      classification: 'lien-waiver',
      status: 'pending',
      linked_lien_waiver_id: null,
      filed: true,
      filed_at: existingFiledAt,
    },
  ];

  const result = await linkWithRows(rows, 'waiver-1');

  assert.equal(result.res.statusCode, 200);
  assert.equal(rows[1].filed, true);
  assert.equal(rows[1].filed_at, existingFiledAt);
  assert.equal(result.audits[1][2].filedAt, existingFiledAt);
});

test('manual link audit failure rolls back instead of reporting a committed link as failed', async () => {
  const rows = [
    { id: 'invoice-1', classification: 'invoice', status: 'pending', linked_lien_waiver_id: null },
    { id: 'waiver-1', classification: 'lien-waiver', status: 'pending', linked_lien_waiver_id: null },
  ];
  const result = await linkWithRows(rows, 'waiver-1', { failLegacyAudit: true });

  assert.equal(result.res.statusCode, 500);
  assert.deepEqual(result.transactionCalls, ['BEGIN', 'ROLLBACK']);
  assert.equal(result.transactionCalls.includes('COMMIT'), false);
});

test('waiver auto-link persists the multi-waiver-bundle skip reason without linking (W13)', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
    connect: async () => assert.fail('bundle skip must not open a transaction'),
  };

  await withMockedModules({
    '../../../lib/auditEvents': { emitLegacyInvoiceAuditEvent: async () => assert.fail('no audits on bundle skip') },
    './supabase': { pool },
  }, async () => {
    const { autoLinkWaiver } = freshRequire('modules/invoices/services/waiverAutoLinkService.js');
    const result = await autoLinkWaiver({
      id: 'bundle-waiver',
      email_conversation_id: 'conversation-1',
      pageClassifications: ['lien-waiver', 'lien-waiver', 'lien-waiver'],
    });
    assert.deepEqual(result, { linked: false, reason: 'multi-waiver-bundle' });
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SET waiver_auto_link_skip_reason = 'multi-waiver-bundle'/);
  assert.match(calls[0].sql, /deleted_at IS NULL/);
  assert.deepEqual(calls[0].params, ['bundle-waiver']);
});

test('waiver auto-link bundle persistence failure never changes the skip decision (W13)', async () => {
  await withMockedModules({
    '../../../lib/auditEvents': { emitLegacyInvoiceAuditEvent: async () => {} },
    './supabase': { pool: { query: async () => { throw new Error('db down'); } } },
  }, async () => {
    const { autoLinkWaiver } = freshRequire('modules/invoices/services/waiverAutoLinkService.js');
    const result = await autoLinkWaiver({
      id: 'bundle-waiver',
      pageClassifications: ['lien-waiver', 'lien-waiver', 'lien-waiver'],
    });
    assert.deepEqual(result, { linked: false, reason: 'multi-waiver-bundle' });
  });
});

test('waiver auto-link treats a soft-deleted locked waiver as missing without writes or audits', async () => {
  const calls = [];
  const audits = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
      if (/SELECT id, linked_lien_waiver_id, classification/.test(sql)) {
        return { rows: [] };
      }
      assert.fail(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const pool = { connect: async () => client };

  await withMockedModules({
    '../../../lib/auditEvents': { emitLegacyInvoiceAuditEvent: async (...args) => audits.push(args) },
    './supabase': { pool },
  }, async () => {
    const { autoLinkWaiver } = freshRequire('modules/invoices/services/waiverAutoLinkService.js');
    const result = await autoLinkWaiver({
      id: 'deleted-waiver',
      email_conversation_id: 'conversation-1',
    });

    assert.deepEqual(result, { linked: false, reason: 'waiver-not-linkable' });
  });

  assert.match(calls[1].sql, /deleted_at IS NULL/);
  assert.equal(calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
  assert.equal(audits.length, 0);
  assert.equal(calls.filter((call) => call.sql === 'ROLLBACK').length, 1);
});

test('waiver auto-link matches a persisted request thread and refuses cross-column ambiguity', async () => {
  async function run(invoiceRows) {
    const calls = [];
    const audits = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (/SELECT id, linked_lien_waiver_id, classification/.test(sql)) {
          return { rows: [{ id: 'waiver-1', classification: 'lien-waiver', linked_lien_waiver_id: null }] };
        }
        if (/SELECT id, invoice_number, status, email_conversation_id, waiver_request_conversation_id/.test(sql)) {
          return { rows: invoiceRows };
        }
        if (/^UPDATE documents/.test(sql)) return { rows: [] };
        assert.fail(`Unexpected SQL: ${sql}`);
      },
      release() {},
    };
    await withMockedModules({
      '../../../lib/auditEvents': { emitLegacyInvoiceAuditEvent: async (...args) => audits.push(args) },
      './supabase': { pool: { connect: async () => client } },
    }, async () => {
      const { autoLinkWaiver } = freshRequire('modules/invoices/services/waiverAutoLinkService.js');
      const result = await autoLinkWaiver({ id: 'waiver-1', email_conversation_id: 'request-thread-1' });
      if (invoiceRows.length === 1) assert.deepEqual(result, { linked: true, invoiceId: 'invoice-1' });
      else assert.match(result.reason, /^ambiguous-thread-2/);
    });
    return { calls, audits };
  }

  const requestMatch = await run([{
    id: 'invoice-1', invoice_number: '100', status: 'approved', email_conversation_id: 'source-thread-1', waiver_request_conversation_id: 'request-thread-1',
  }]);
  const invoiceUpdate = requestMatch.calls.find((call) => /waiver_link_source/.test(call.sql));
  assert.equal(invoiceUpdate.params[1], 'request-thread');
  const waiverUpdate = requestMatch.calls.find((call) => /filed = true/.test(call.sql));
  assert.ok(waiverUpdate, 'auto-link must shelf the waiver in the reciprocal-link transaction');
  assert.match(waiverUpdate.sql, /filed_at = COALESCE\(filed_at, \$2\)/);
  assert.equal(requestMatch.audits[1][2].filed, true);
  assert.equal(requestMatch.audits[1][2].filedAt, requestMatch.audits[1][2].linkedAt);
  assert.equal(requestMatch.audits.length, 2);
  assert.ok(requestMatch.audits.every((entry) => entry[4]));

  const ambiguous = await run([
    { id: 'invoice-email', invoice_number: '101', status: 'approved', email_conversation_id: 'request-thread-1', waiver_request_conversation_id: null },
    { id: 'invoice-request', invoice_number: '102', status: 'approved', email_conversation_id: 'source-thread-2', waiver_request_conversation_id: 'request-thread-1' },
  ]);
  assert.equal(ambiguous.calls.filter((call) => /^UPDATE/.test(call.sql)).length, 0);
  assert.equal(ambiguous.audits.length, 0);
});

test('waiver auto-link rolls back when its enlisted audit fails', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (/SELECT id, linked_lien_waiver_id, classification,\s+email_subject,\s+vendor_code\s+FROM documents/.test(sql)) {
        return {
          rows: [{
            id: 'waiver-1',
            classification: 'lien-waiver',
            linked_lien_waiver_id: null,
            email_subject: null,
            vendor_code: null,
          }],
        };
      }
      if (/SELECT id, invoice_number, status, email_conversation_id, waiver_request_conversation_id/.test(sql)) {
        return { rows: [{
          id: 'invoice-1',
          status: 'pending',
          email_conversation_id: 'thread-1',
          waiver_request_conversation_id: null,
        }] };
      }
      if (/^UPDATE documents/.test(sql)) return { rows: [] };
      assert.fail(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  await withMockedModules({
    '../../../lib/auditEvents': {
      emitLegacyInvoiceAuditEvent: async () => { throw new Error('audit failed'); },
    },
    './supabase': { pool: { connect: async () => client } },
  }, async () => {
    const { autoLinkWaiver } = freshRequire('modules/invoices/services/waiverAutoLinkService.js');
    const result = await autoLinkWaiver({ id: 'waiver-1', email_conversation_id: 'thread-1' });
    assert.equal(result.linked, false);
    assert.match(result.reason, /audit failed/);
  });

  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.includes('ROLLBACK'), true);
});

test('unlinking a shelved waiver clears its shelf state so it returns to the active queue', async () => {
  const rows = [
    {
      id: 'invoice-1',
      classification: 'invoice',
      status: 'pending',
      linked_lien_waiver_id: 'waiver-1',
      merged_file_path: null,
    },
    {
      id: 'waiver-1',
      classification: 'lien-waiver',
      status: 'pending',
      linked_lien_waiver_id: 'invoice-1',
      filed: true,
      filed_at: '2026-08-14T12:00:00.000Z',
    },
  ];
  const calls = [];
  const audits = [];
  const structuredAudits = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT linked_lien_waiver_id FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [{ linked_lien_waiver_id: rows[0].linked_lien_waiver_id }] };
      }
      if (/SELECT \* FROM documents WHERE id IN/.test(sql)) {
        return { rows: rows.filter((candidate) => params.includes(candidate.id)).map((row) => ({ ...row })) };
      }
      if (/waiver_link_source = NULL/.test(sql)) {
        rows[0].linked_lien_waiver_id = null;
        return { rows: [] };
      }
      if (/filed = false/.test(sql)) {
        rows[1].linked_lien_waiver_id = null;
        rows[1].filed = false;
        rows[1].filed_at = null;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const req = {
    params: { id: 'invoice-1' },
    body: {},
    log: { info() {}, error() {} },
  };
  const res = makeRes();

  await withMockedModules({
    '../../../middleware/errorResponse': createErrorResponseMock(),
    '../../../lib/auditEvents': {
      emitLegacyInvoiceAuditEvent: async (...args) => audits.push(args),
      emitInvoiceAuditEvent: async (_req, _res, event) => structuredAudits.push(event),
    },
    './pdfMergeService': { deleteMergedPdf() {}, mergeWaiverPdfForInvoice: async () => null },
    './supabase': { pool },
    './transaction': { withTransaction: async (dbPool, work) => work(dbPool) },
    './waiverLinkedStatusService': { restoreLinkedWaiverPending: async () => ({ outcome: 'not_parked' }) },
  }, async () => {
    const { unlinkWaiver } = freshRequire('modules/invoices/services/lienWaiverLinkService.js');
    await unlinkWaiver(req, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(rows[1].linked_lien_waiver_id, null);
  assert.equal(rows[1].filed, false);
  assert.equal(rows[1].filed_at, null);
  assert.ok(calls.some((call) => /filed = false/.test(call.sql)));
  assert.equal(audits.length, 2);
  assert.ok(audits.every((entry) => entry[4] === pool));
  assert.equal(structuredAudits.length, 2);
  assert.equal(structuredAudits[1].beforeState.filed, true);
  assert.equal(structuredAudits[1].afterState.filed, false);
  assert.ok(structuredAudits.every((event) => event.client === pool));
});
