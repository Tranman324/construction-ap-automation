'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const larkFixture = require('../fixtures/invoices/lark-statement-6846.extracted.json');
const {
  matchStatementLine,
  normalizeStatementLines,
} = require('../../modules/invoices/services/statementLines');
const {
  insertDocument,
  matchPerTypeDocumentData,
  normalizeExtractedFieldsForClassification,
} = require('../../modules/invoices/services/pipeline');
const { mergeReextractedStatementAttributes } = require('../../modules/invoices/services/statementAttributes');

const root = path.resolve(__dirname, '..', '..');

function resolved(relativePath) {
  return require.resolve(path.join(root, relativePath));
}

function snapshotCache(paths) {
  return new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
}

function restoreCache(snapshot) {
  for (const [modulePath, cached] of snapshot.entries()) {
    if (cached) {
      require.cache[modulePath] = cached;
    } else {
      delete require.cache[modulePath];
    }
  }
}

async function withModuleMocks(mocks, fn) {
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return original.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = original; }
}

function manualAttributes() {
  return {
    manual: { balance: { value: 44, setBy: 'reviewer' } },
    extracted: { statementPeriod: 'old period', balance: 10 },
  };
}

function assertLockedStatementWrite(calls, expectedPeriod) {
  const lockIndex = calls.findIndex((call) => /SELECT statement_attributes FROM documents WHERE id = \$1 FOR UPDATE/.test(call.sql));
  const updateIndex = calls.findIndex((call) => /UPDATE documents SET/.test(call.sql));
  assert.ok(lockIndex >= 0, 'writer must lock the current attributes');
  assert.ok(updateIndex > lockIndex, 'writer must lock immediately before its update');
  const update = calls[updateIndex];
  const statementIndex = update.sql.match(/statement_attributes = \$(\d+)/)[1] - 1;
  const written = JSON.parse(update.params[statementIndex]);
  assert.equal(written.manual.balance.value, 44, 'late manual value must survive');
  assert.equal(written.extracted.statementPeriod, expectedPeriod, 'extraction must refresh');
}

async function withPipelinePool(pool, fn) {
  const modulePaths = [
    resolved('lib/db.js'),
    resolved('modules/invoices/services/pipeline.js'),
  ];
  const cache = snapshotCache(modulePaths);
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  require.cache[resolved('lib/db.js')] = {
    id: resolved('lib/db.js'),
    filename: resolved('lib/db.js'),
    loaded: true,
    exports: pool,
  };

  try {
    return await fn(require('../../modules/invoices/services/pipeline'));
  } finally {
    restoreCache(cache);
  }
}

function loadRowToDocWithMockPool() {
  const modulePaths = [
    resolved('lib/db.js'),
    resolved('modules/invoices/services/supabase.js'),
  ];
  const cache = snapshotCache(modulePaths);
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  require.cache[resolved('lib/db.js')] = {
    id: resolved('lib/db.js'),
    filename: resolved('lib/db.js'),
    loaded: true,
    exports: { query() {} },
  };

  const { rowToDoc } = require('../../modules/invoices/services/supabase');
  return {
    rowToDoc,
    cleanup() {
      restoreCache(cache);
    },
  };
}

const baseLine = {
  id: '7338',
  invoiceNumber: '7338',
  date: '2026-02-09',
  amount: 1620,
  status: 'not_received',
  source: 'extracted',
};

function scopedRecord(overrides = {}) {
  return {
    invoiceNumber: baseLine.invoiceNumber,
    vendorCode: 'LARK01',
    amount: baseLine.amount,
    ...overrides,
  };
}

test('Lark fixture rolls sub-items into one statement line per parent invoice', () => {
  const normalized = normalizeExtractedFieldsForClassification('statement', larkFixture, {
    emailFrom: 'forwarder@northwindcg.example',
  });

  assert.equal(normalized.vendor, 'B. Lark Interiors, Inc.');
  assert.equal(normalized.balance, 50930);
  assert.equal(normalized.statementLines.length, 4);

  const invoiceNumbers = normalized.statementLines.map((line) => line.invoiceNumber);
  assert.deepEqual(invoiceNumbers, ['7338', '7530', '7552', '7558']);

  const line7552 = normalized.statementLines.find((line) => line.invoiceNumber === '7552');
  const line7558 = normalized.statementLines.find((line) => line.invoiceNumber === '7558');
  assert.equal(line7552.amount, 4050 + 13530 + 14010 + 1000);
  assert.equal(line7558.amount, 3330 + 6110 + 800);

  const statementTotal = normalized.statementLines.reduce((sum, line) => sum + line.amount, 0);
  assert.equal(statementTotal, larkFixture.balance);
  assert.equal(normalized.statementLines.every((line) => !('subItems' in line)), true);
  for (const line of normalized.statementLines) {
    assert.deepEqual(Object.keys(line), ['id', 'invoiceNumber', 'date', 'amount', 'status', 'source']);
    assert.equal(line.id, line.invoiceNumber);
    assert.equal(line.status, 'not_received');
    assert.equal(line.source, 'extracted');
  }
});

test('statement normalization preserves persisted resolution metadata', () => {
  const [line] = normalizeStatementLines({ statementLines: [{
    ...baseLine,
    resolvedAt: '2026-07-15T12:00:00.000Z',
    resolutionType: 'accept_line',
    resolvedBy: 'worker@example.com',
  }] });
  assert.equal(line.resolvedAt, '2026-07-15T12:00:00.000Z');
  assert.equal(line.resolutionType, 'accept_line');
  assert.equal(line.resolvedBy, 'worker@example.com');
});

test('serialized statements expose the reconciliation enforcement state', () => {
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();
  try {
    const invoice = rowToDoc({
      id: 'statement-clear-state',
      classification: 'statement',
      statement_lines: [
        { ...baseLine, id: 'matched', status: 'matched' },
        { ...baseLine, id: 'open', status: 'not_received' },
        {
          ...baseLine,
          id: 'accepted',
          status: 'not_received',
          resolvedAt: '2026-07-30T12:00:00.000Z',
          resolutionType: 'accept_line',
        },
      ],
    }, { includeStatementReconcile: true, canReconcile: true });

    assert.deepEqual(invoice.statementLines.map((line) => line.clear), [true, false, true]);
    assert.deepEqual(invoice.reconcile, {
      blockers: [{
        code: 'STATEMENT_LINE_UNRESOLVED',
        lineId: 'open',
        message: 'Statement line "open" is unresolved',
      }],
      counts: { total: 3, clear: 2, unresolved: 1 },
      canReconcile: false,
      permittedActions: [],
    });
  } finally {
    cleanup();
  }
});

test('default document serialization preserves the legacy statement shape', () => {
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();
  try {
    const invoice = rowToDoc({
      id: 'statement-legacy-shape',
      classification: 'statement',
      statement_lines: [{ ...baseLine, status: 'matched' }],
    });

    assert.equal(invoice.reconcile, undefined);
    assert.equal(invoice.statementLines[0].clear, undefined);
    assert.equal(invoice.extracted.statementLines[0].clear, undefined);
  } finally {
    cleanup();
  }
});

test('normalizeStatementLines accepts the authoritative Lark raw shape directly', () => {
  const lines = normalizeStatementLines(larkFixture);

  assert.deepEqual(lines.map((line) => line.invoiceNumber), ['7338', '7530', '7552', '7558']);
  assert.equal(lines.find((line) => line.invoiceNumber === '7552').amount, 32590);
  assert.equal(lines.find((line) => line.invoiceNumber === '7558').amount, 10240);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 50930);
});

test('normalizeStatementLines uses valid sub-item totals even when the total is not positive', () => {
  const [line] = normalizeStatementLines({
    lines: [{
      invoiceNumber: 'CR-1',
      amount: 100,
      subItems: [
        { amount: 50 },
        { amount: -50 },
      ],
    }],
  });

  assert.equal(line.amount, 0);
});

test('normalizeStatementLines preserves manual source values', () => {
  const [line] = normalizeStatementLines({
    statementLines: [{
      invoiceNumber: 'MAN-1',
      amount: 42,
      source: 'manual',
    }],
  });

  assert.equal(line.source, 'manual');
});

test('normalizeStatementLines constrains invalid source values to a valid default', () => {
  const [invalidLine, missingLine] = normalizeStatementLines({
    statementLines: [
      { invoiceNumber: 'BAD-1', amount: 42, source: 'email-forwarder' },
      { invoiceNumber: 'MISS-1', amount: 84 },
    ],
  });

  assert.equal(invalidLine.source, 'extracted');
  assert.equal(missingLine.source, 'extracted');

  const [manualDefaultLine] = normalizeStatementLines({
    statementLines: [{ invoiceNumber: 'MAN-DEFAULT-1', amount: 21, source: 'sidecar' }],
  }, { source: 'manual' });
  assert.equal(manualDefaultLine.source, 'manual');

  const [invalidDefaultLine] = normalizeStatementLines({
    statementLines: [{ invoiceNumber: 'INV-DEFAULT-1', amount: 10 }],
  }, { source: 'uploaded' });
  assert.equal(invalidDefaultLine.source, 'extracted');
});

test('matchStatementLine returns matched when Toolbox and Spectrum records match amount', async () => {
  const line = await matchStatementLine(baseLine, 'LARK01', {
    findToolboxInvoice: async () => scopedRecord(),
    findSpectrumInvoice: async () => scopedRecord({ source: 'VN_OPEN_ITEMS_MC' }),
  });

  assert.equal(line.status, 'matched');
});

test('matchStatementLine returns in_toolbox_not_spectrum when only Toolbox has the invoice', async () => {
  const line = await matchStatementLine(baseLine, 'LARK01', {
    findToolboxInvoice: async () => scopedRecord(),
    findSpectrumInvoice: async () => null,
  });

  assert.equal(line.status, 'in_toolbox_not_spectrum');
});

test('matchStatementLine returns not_received when neither lookup has the invoice', async () => {
  const line = await matchStatementLine(baseLine, 'LARK01', {
    findToolboxInvoice: async () => null,
    findSpectrumInvoice: async () => null,
  });

  assert.equal(line.status, 'not_received');
});

test('matchStatementLine returns amount_differs when a scoped invoice amount differs', async () => {
  const line = await matchStatementLine(baseLine, 'LARK01', {
    findToolboxInvoice: async () => scopedRecord(),
    findSpectrumInvoice: async () => scopedRecord({ amount: 1600 }),
  });

  assert.equal(line.status, 'amount_differs');
});

test('matchStatementLine does not match the same invoice number under another vendor', async () => {
  const lookupCalls = [];
  const line = await matchStatementLine(baseLine, 'LARK01', {
    findToolboxInvoice: async (input) => {
      lookupCalls.push(input);
      return scopedRecord({ vendorCode: 'OTHER01' });
    },
    findSpectrumInvoice: async () => scopedRecord({ vendorCode: 'OTHER01' }),
  });

  assert.equal(line.status, 'not_received');
  assert.deepEqual(lookupCalls[0], {
    invoiceNumber: '7338',
    vendorCode: 'LARK01',
    amount: 1620,
    line: baseLine,
  });
});

test('matchPerTypeDocumentData matches statement lines with the document vendor code', async () => {
  const extracted = normalizeExtractedFieldsForClassification('statement', larkFixture);
  const lookupInputs = [];
  const matching = await matchPerTypeDocumentData(
    'statement',
    extracted,
    {
      statementLineLookups: {
        findToolboxInvoice: async (input) => {
          lookupInputs.push(input);
          return scopedRecord({
            invoiceNumber: input.invoiceNumber,
            vendorCode: input.vendorCode,
            amount: input.amount,
          });
        },
        findSpectrumInvoice: async (input) => scopedRecord({
          invoiceNumber: input.invoiceNumber,
          vendorCode: input.vendorCode,
          amount: input.amount,
        }),
      },
    },
    {
      matchVendor: async () => ({
        vendorCode: 'LARK01',
        vendorName: 'B. Lark Interiors, Inc.',
        confidence: 1,
        method: 'fixture',
      }),
    }
  );

  assert.equal(matching.vendor.vendorCode, 'LARK01');
  assert.equal(matching.statementLines.length, 4);
  assert.equal(matching.statementLines.every((line) => line.status === 'matched'), true);
  assert.equal(lookupInputs.every((input) => input.vendorCode === 'LARK01'), true);
});

test('insertDocument persists statement_lines JSONB on the document row', async () => {
  const statementLines = normalizeStatementLines(larkFixture);
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: /INSERT INTO audit_events/.test(sql) ? [{ id: params[0] }] : [] };
    },
  };

  await withPipelinePool(pool, async (pipeline) => {
    await pipeline.insertDocument({
      id: 'doc-statement-1',
      classification: 'statement',
      confidence: 0.95,
      file: 'statement.pdf',
      email: {
        messageId: 'msg-1',
        from: 'forwarder@northwindcg.example',
        subject: 'FW: Monthly Statement',
        receivedAt: '2026-07-03T12:00:00Z',
      },
      extracted: {
        vendor: 'B. Lark Interiors, Inc.',
        balance: 50930,
        statementLines,
      },
      matching: {
        vendor: {
          vendorCode: 'LARK01',
          vendorName: 'B. Lark Interiors, Inc.',
          confidence: 1,
          method: 'fuzzy-high',
        },
        overallConfidence: 1,
      },
      queuedAt: '2026-07-03T12:00:00Z',
    });
  });

  const insertCall = calls.find(c => /INSERT INTO documents/.test(c.sql));
  assert.ok(insertCall, 'INSERT INTO documents query should exist');
  assert.match(insertCall.sql, /statement_lines/);
  assert.deepEqual(JSON.parse(insertCall.params[26]), statementLines);
  assert.equal(insertCall.params[27], 'LARK01');
  assert.equal(insertCall.params[37], 1);
});

test('rowToDoc exposes statementLines in camelCase response shape', () => {
  const statementLines = normalizeStatementLines(larkFixture);
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();

  try {
    const doc = rowToDoc({
      id: 'doc-row-1',
      classification: 'statement',
      status: 'pending',
      confidence: '0.95',
      file_name: 'statement.pdf',
      line_items: [],
      statement_lines: JSON.stringify(statementLines),
      needs_review: true,
    }, { includeStatementReconcile: true });

    const serializedLines = statementLines.map((line) => ({ ...line, clear: false }));
    assert.deepEqual(doc.statementLines, serializedLines);
    assert.deepEqual(doc.extracted.statementLines, serializedLines);
    assert.deepEqual(doc.reconcile, {
      blockers: statementLines.map((line) => ({
        code: 'STATEMENT_LINE_UNRESOLVED',
        lineId: line.id,
        message: `Statement line "${line.id}" is unresolved`,
      })),
      counts: { total: 4, clear: 0, unresolved: 4 },
      canReconcile: false,
      permittedActions: [],
    });
  } finally {
    cleanup();
  }
});

test('rowToDoc exposes Spectrum COI upload status in camelCase response shape', () => {
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();

  try {
    const doc = rowToDoc({
      id: 'doc-coi-1',
      classification: 'coi',
      status: 'pending',
      confidence: '0.95',
      file_name: 'coi.pdf',
      line_items: [],
      statement_lines: null,
      needs_review: true,
      spectrum_upload_status: 'failed',
      spectrum_upload_queued_at: new Date('2026-07-04T12:00:00.000Z'),
      spectrum_upload_started_at: new Date('2026-07-04T12:01:00.000Z'),
      spectrum_upload_completed_at: new Date('2026-07-04T12:02:00.000Z'),
      spectrum_upload_error: 'PROIV rejected tracking upload',
      spectrum_upload_trans_id: 'TX-123',
      spectrum_upload_tracking_code: 'COI 2029',
      spectrum_upload_vendor_code: 'HALD01',
      spectrum_upload_attempts: 2,
    });

    assert.equal(doc.spectrumUploadStatus, 'failed');
    assert.equal(doc.spectrumUploadQueuedAt, '2026-07-04T12:00:00.000Z');
    assert.equal(doc.spectrumUploadStartedAt, '2026-07-04T12:01:00.000Z');
    assert.equal(doc.spectrumUploadCompletedAt, '2026-07-04T12:02:00.000Z');
    assert.equal(doc.spectrumUploadError, 'PROIV rejected tracking upload');
    assert.equal(doc.spectrumUploadTransId, 'TX-123');
    assert.equal(doc.spectrumUploadTrackingCode, 'COI 2029');
    assert.equal(doc.spectrumUploadVendorCode, 'HALD01');
    assert.equal(doc.spectrumUploadAttempts, 2);
    assert.equal(doc.lastSpectrumError, 'PROIV rejected tracking upload');
  } finally {
    cleanup();
  }
});

test('statement attributes migration is additive, idempotent, and classified safe for rerun', () => {
  const filename = '2026-07-31_statement_attributes.sql';
  const sql = fs.readFileSync(path.join(root, 'migrations', filename), 'utf8');
  const { classifyMigrationSql } = require('../../lib/migrations');
  assert.match(sql, /^\s*BEGIN;\s/i); assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+statement_attributes\s+JSONB/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
});

test('statement ingestion persists extracted period and balance without documents.amount authority', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: /INSERT INTO audit_events/.test(sql) ? [{ id: params[0] }] : [] }; } };
  await insertDocument({ id: 'statement-ingestion', classification: 'statement', file: 'statement.pdf', extracted: { statementPeriod: 'July 2026', balance: 83.25, statementLines: [] }, statementAttributes: { manual: { balance: { value: 44, setBy: 'reviewer', setAt: '2026-07-30T00:00:00.000Z' } } }, email: {}, matching: {}, queuedAt: '2026-07-31T00:00:00.000Z' }, db);
  const insert = calls.find((call) => /INSERT INTO documents/.test(call.sql));
  assert.ok(insert); assert.match(insert.sql, /statement_attributes/);
  const columnNames = insert.sql.match(/INSERT INTO documents \(([\s\S]+?)\) VALUES/)[1].split(',').map((column) => column.trim());
  assert.deepEqual(JSON.parse(insert.params[columnNames.indexOf('statement_attributes')]), {
    manual: { balance: { value: 44, setBy: 'reviewer', setAt: '2026-07-30T00:00:00.000Z' } },
    extracted: { statementPeriod: 'July 2026', balance: 83.25 },
  });
  assert.equal(insert.params.includes(83.25), false);
});

test('statement serialization resolves manual, extracted, then computed values without writes', () => {
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();
  try {
    const row = { id: 'statement-source-precedence', classification: 'statement', amount: 9999, statement_attributes: { manual: { statementPeriod: { value: 'Manual period' }, balance: { value: 44 } }, extracted: { statementPeriod: 'Extracted period', balance: 55 }, computed: { statementPeriod: 'Computed period', balance: 66 } } };
    const first = rowToDoc(row); const second = rowToDoc(row);
    assert.equal(first.extracted.statementPeriod, 'Manual period'); assert.equal(first.extracted.balance, 44);
    assert.deepEqual(first.statementAttributes, { statementPeriod: { value: 'Manual period', source: 'manual' }, balance: { value: 44, source: 'manual' } });
    assert.deepEqual(second.extracted, first.extracted);
    assert.deepEqual(row.statement_attributes.manual, { statementPeriod: { value: 'Manual period' }, balance: { value: 44 } });
  } finally { cleanup(); }
});

test('legacy statement reads are deterministic and do not use documents.amount', () => {
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();
  try {
    const row = { id: 'legacy-statement', classification: 'statement', amount: 5000, statement_attributes: { extracted: { statementPeriod: 'August 2026', balance: null }, computed: { balance: 12.5 } } };
    const before = structuredClone(row);
    assert.deepEqual(rowToDoc(row).statementAttributes, { statementPeriod: { value: 'August 2026', source: 'extracted' }, balance: { value: 12.5, source: 'computed' } });
    assert.deepEqual(row, before);
  } finally { cleanup(); }
});

test('all statement reingestion writers refresh extracted slots and retain manual/computed slots', () => {
  const existing = {
    manual: { balance: { value: 44, setBy: 'reviewer' } },
    extracted: { statementPeriod: 'Old period', balance: 10 },
    computed: { balance: 12 },
  };
  const merged = mergeReextractedStatementAttributes(existing, { statementPeriod: 'New period', balance: 83.25 });
  assert.deepEqual(merged, {
    manual: { balance: { value: 44, setBy: 'reviewer' } },
    extracted: { statementPeriod: 'New period', balance: 83.25 },
    computed: { balance: 12 },
  });

  for (const relativePath of [
    'modules/invoices/scripts/re-extract.js',
    'modules/invoices/scripts/reprocess-errors.js',
    'modules/invoices/services/attachFileService.js',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /mergeReextractedStatementAttributes/);
    assert.match(source, /statement_attributes/);
  }
});

test('reprocess writer merges extracted statement data against the locked current row', async () => {
  const calls = [];
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/FOR UPDATE/.test(sql)) return { rows: [{ statement_attributes: manualAttributes() }] };
    return { rows: [] };
  } };
  const scriptDbPath = resolved('lib/scriptDb.js');
  const scriptPath = resolved('modules/invoices/scripts/reprocess-errors.js');
  const pipelinePath = resolved('modules/invoices/services/pipeline.js');
  const snapshot = snapshotCache([scriptDbPath, scriptPath, pipelinePath]);
  for (const modulePath of [scriptDbPath, scriptPath, pipelinePath]) delete require.cache[modulePath];
  require.cache[scriptDbPath] = { id: scriptDbPath, filename: scriptDbPath, loaded: true, exports: { createScriptClient: () => pool } };
  require.cache[pipelinePath] = { id: pipelinePath, filename: pipelinePath, loaded: true, exports: {
    parseEmailBodyForJobData: () => ({}), normalizeExtractedDates() {}, matchInvoiceData: async () => ({}), classifyAndExtract: async () => ({}),
  } };
  try {
    const { updateDoc } = require('../../modules/invoices/scripts/reprocess-errors');
    await updateDoc({ id: 'reprocess-race', statement_attributes: { extracted: { balance: 10 } } }, {
      classification: 'statement', extracted: { statementPeriod: 'fresh reprocess', balance: 80 }, pageClassifications: [],
    });
    assertLockedStatementWrite(calls, 'fresh reprocess');
  } finally { restoreCache(snapshot); }
});

test('attach-file writer binds the locked statement merge rather than its stale load', async () => {
  const calls = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statement-attach-'));
  const client = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/FOR UPDATE/.test(sql)) return { rows: [{ statement_attributes: manualAttributes() }] };
    return { rows: [] };
  }, release() {} };
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/FROM documents WHERE id/.test(sql)) return { rows: [{ id: 'attach-race', classification: 'error', status: 'pending', statement_attributes: { extracted: { balance: 10 } } }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  }, async connect() { return client; } };
  const servicePath = resolved('modules/invoices/services/attachFileService.js');
  const snapshot = snapshotCache([servicePath]);
  delete require.cache[servicePath];
  try {
    await withModuleMocks({
      './supabase': { pool, audit: async () => {} }, '../../../lib/graph': { graphFetch: async () => ({}) }, '../../../lib/logger': { info() {}, warn() {}, error() {} },
      './file-types': { detectFileType: () => ({ isPdf: true, isImage: false, ext: 'pdf' }), buildStoredFilename: () => 'attach-race.pdf' },
      '../../../config': { FILES_DIR: tempDir, INVOICE_MAILBOX: 'mailbox' },
      './pipeline': { classifyAndExtract: async () => ({ classification: 'statement', confidence: 1, extracted: { statementPeriod: 'fresh attach', balance: 81 } }), matchInvoiceData: async () => ({}), normalizeExtractedDates() {}, normalizeExtractedFieldsForClassification: (_type, value) => value, parseEmailBodyForJobData: () => ({}), isInvoiceLikeClassification: () => false, enforceActiveClassification: async (value) => value },
    }, async () => {
      const { attachFileAndReprocess } = require('../../modules/invoices/services/attachFileService');
      await attachFileAndReprocess('attach-race', { buffer: Buffer.from('%PDF'), originalname: 'statement.pdf', size: 4 }, { id: 'reviewer' });
    });
    assertLockedStatementWrite(calls, 'fresh attach');
  } finally { restoreCache(snapshot); fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('re-extract writer merges against the locked row after its long extraction path', async () => {
  const calls = [];
  const filePath = path.join(os.tmpdir(), `statement-reextract-${process.pid}.pdf`);
  fs.writeFileSync(filePath, '%PDF');
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/FROM documents WHERE id = \$1$/.test(sql.trim())) return { rows: [{ id: 'reextract-race', file_path: filePath, file_name: 'statement.pdf', classification: 'statement', statement_attributes: { extracted: { balance: 10 } } }] };
    if (/FOR UPDATE/.test(sql)) return { rows: [{ statement_attributes: manualAttributes() }] };
    return { rows: [] };
  } };
  const scriptDbPath = resolved('lib/scriptDb.js');
  const scriptPath = resolved('modules/invoices/scripts/re-extract.js');
  const snapshot = snapshotCache([scriptDbPath, scriptPath]);
  for (const modulePath of [scriptDbPath, scriptPath]) delete require.cache[modulePath];
  require.cache[scriptDbPath] = { id: scriptDbPath, filename: scriptDbPath, loaded: true, exports: { createScriptClient: () => pool } };
  const oldFetch = global.fetch; const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'fixture';
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify({ classification: 'statement', confidence: 1, extracted: { statementPeriod: 'fresh reextract', balance: 82 } }) }], usage: {} }) });
  try {
    await withModuleMocks({
      child_process: {
        execFileSync: (_command, args, options) => {
          if (options?.encoding === 'utf8') return 'page 1';
          const outputPath = args.at(-1);
          if (outputPath?.endsWith('.png')) fs.writeFileSync(outputPath, 'fixture-image');
          return Buffer.from('1');
        },
        execSync: () => assert.fail('re-extraction must not use execSync'),
      },
      '../services/matcher': { matchInvoice: async () => ({}), isSelfVendor: () => false },
      '../services/pipeline': { buildCoiExtractionPrompt: () => '', buildStatementExtractionPrompt: () => '', normalizeExtractedFieldsForClassification: (_type, value) => value, enforceActiveClassification: async (value) => value },
    }, async () => {
      const { reExtract } = require('../../modules/invoices/scripts/re-extract');
      await reExtract('reextract-race');
    });
    assertLockedStatementWrite(calls, 'fresh reextract');
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey; restoreCache(snapshot); fs.rmSync(filePath, { force: true }); }
});
