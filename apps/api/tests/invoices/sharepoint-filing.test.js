'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
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

function makeTempFile(name = 'source.pdf') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-sp-filing-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from('pdf'));
  return filePath;
}

function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-sp-data-'));
}

function baseDocument(overrides = {}) {
  return {
    id: 'doc-1',
    classification: 'invoice',
    filed: false,
    needs_review: true,
    file_path: '/tmp/source.pdf',
    file_name: 'Original Attachment.pdf',
    vendor_name: 'Halden Brooks Electrical Contractors',
    matched_vendor_name: null,
    invoice_number: '#2',
    invoice_date: new Date('2026-06-15T00:00:00Z'),
    amount: '124.50',
    email_from: 'vendor@example.com',
    job_number: null,
    job_match_number: '26-123',
    ...overrides,
  };
}

test('uploadDocumentToJobFolder uses generated filename, item id, and metadata fields', async () => {
  const localFilePath = makeTempFile('raw-invoice.pdf');
  const graphCalls = { upload: null, fields: null };
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      if (folderPath === '26-000') {
        return [{ id: 'job-folder', name: '26-123 - Sample Job', isFolder: true }];
      }
      if (folderPath === '26-000/26-123 - Sample Job') {
        return [{ id: 'billings', name: 'Billings', isFolder: true }];
      }
      if (folderPath === '26-000/26-123 - Sample Job/Billings') {
        return [];
      }
      return [];
    },
    uploadDriveFile: async (driveId, folderPath, fileName, content) => {
      graphCalls.upload = { driveId, folderPath, fileName, content };
      return { id: 'sp-item-1', name: fileName, webUrl: 'https://sharepoint/file' };
    },
    patchListItemFields: async (driveId, itemId, fields) => {
      graphCalls.fields = { driveId, itemId, fields };
      return {};
    },
  };

  await withMockedModules({
    '../../../lib/graph': graph,
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { uploadDocumentToJobFolder } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const result = await uploadDocumentToJobFolder({
      jobNumber: '26-123',
      destination: 'Billings',
      localFilePath,
      document: baseDocument(),
    });

    assert.equal(result.id, 'sp-item-1');
    assert.equal(result.name, 'INV Halden Brooks 06-15-26 #2.pdf');
    assert.equal(graphCalls.upload.fileName, 'INV Halden Brooks 06-15-26 #2.pdf');
    assert.equal(graphCalls.upload.folderPath, '26-000/26-123 - Sample Job/Billings');
    assert.equal(graphCalls.fields.itemId, 'sp-item-1');
    assert.deepEqual(graphCalls.fields.fields, {
      DocType: 'INV',
      JobNumber: '26-123',
      Vendor: 'Halden Brooks Electrical Contractors',
      DocDate: '2026-06-15',
      Amount: 124.5,
      SourceEmail: 'vendor@example.com',
      ToolboxId: 'doc-1',
    });
  });
});

test('uploadFileToDestination forwards a user filename override on the direct-destination path', async () => {
  const localFilePath = makeTempFile('raw-invoice.pdf');
  const uploadCalls = [];
  const graph = {
    listDriveChildren: async () => [],
    uploadDriveFile: async (driveId, parentPath, fileName, content) => {
      uploadCalls.push({ driveId, parentPath, fileName, content });
      return { id: 'sp-direct-override', name: fileName, webUrl: 'https://sharepoint/direct-override' };
    },
  };

  await withMockedModules({
    '../../../lib/graph': graph,
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { uploadFileToDestination } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const result = await uploadFileToDestination({
      driveId: 'drive-direct',
      parentPath: 'Projects/26-123/Billings',
      localFilePath,
      filename: 'Custom direct destination',
      document: baseDocument(),
    });

    assert.equal(result.name, 'Custom direct destination.pdf');
    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].fileName, 'Custom direct destination.pdf');
  });
});

test('override filenames never exceed 128 characters', async () => {
  await withMockedModules({
    '../../../lib/graph': {},
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { buildUploadFilename } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const document = baseDocument({ file_name: 'source.pdf' });
    const capped = buildUploadFilename({ document, localFilePath: '/tmp/source.pdf', filename: 'A'.repeat(128), existingNames: [] });
    assert.equal(capped.length, 128);
    assert.equal(capped.endsWith('.pdf'), true);
  });
});

test('override filenames retain only a terminal source extension', async () => {
  await withMockedModules({
    '../../../lib/graph': {},
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { buildUploadFilename } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const document = baseDocument({ file_name: 'source.pdf' });
    assert.equal(buildUploadFilename({ document, localFilePath: '/tmp/source.pdf', filename: 'CustomXpdf', existingNames: [] }), 'CustomXpdf.pdf');
    assert.equal(buildUploadFilename({ document, localFilePath: '/tmp/source.pdf', filename: 'Custom.pdf.pdf', existingNames: [] }), 'Custom.pdf.pdf');
  });
});

test('uploadDocumentToJobFolder returns metadata warning without failing upload', async () => {
  const localFilePath = makeTempFile('receipt.pdf');
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      if (folderPath === '26-000') return [{ name: '26-123 - Sample Job', isFolder: true }];
      if (folderPath === '26-000/26-123 - Sample Job') return [];
      return [];
    },
    uploadDriveFile: async (_driveId, _folderPath, fileName) => ({
      id: 'sp-item-2',
      name: fileName,
      webUrl: 'https://sharepoint/receipt',
    }),
    patchListItemFields: async () => {
      throw new Error('Graph 400 Bad Request');
    },
  };

  await withMockedModules({
    '../../../lib/graph': graph,
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { uploadDocumentToJobFolder } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const result = await uploadDocumentToJobFolder({
      jobNumber: '26-123',
      destination: '',
      localFilePath,
      document: baseDocument({ classification: 'receipt', vendor_name: 'Home Depot', invoice_number: null }),
    });

    assert.equal(result.id, 'sp-item-2');
    assert.equal(result.metadataWarning, 'Graph 400 Bad Request');
  });
});

test('COI filing uses the same manual resolved vendor and expiration in filename and metadata, then clears back to extracted values', async () => {
  await withMockedModules({ '../../../lib/graph': {}, '../../../lib/logger': { info() {}, warn() {} }, '../../../config': { DATA_DIR: makeTempDataDir() } }, async () => {
    const { buildUploadFilename, buildListItemFields } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const base = baseDocument({ classification: 'coi', vendor_name: 'Wrong display vendor', vendor_code: 'EXTRACTED', invoice_date: '2026-01-01', coi_data: { coverageLines: [{ expirationDate: '2026-10-01' }] } });
    const manual = { ...base, coi_manual_values: { vendorCode: { value: 'MANUAL' }, expirationDate: { value: '2026-12-31' } } };
    assert.match(buildUploadFilename({ document: manual, localFilePath: '/tmp/coi.pdf', existingNames: [] }), /MANUAL 12-31-26/);
    assert.deepEqual(buildListItemFields(manual).Vendor, 'MANUAL'); assert.equal(buildListItemFields(manual).DocDate, '2026-12-31');
    const cleared = { ...base, coi_manual_values: {} };
    assert.match(buildUploadFilename({ document: cleared, localFilePath: '/tmp/coi.pdf', existingNames: [] }), /EXTRACTED 10-01-26/);
    assert.equal(buildListItemFields(cleared).Vendor, 'EXTRACTED'); assert.equal(buildListItemFields(cleared).DocDate, '2026-10-01');
    const unknown = { ...base, vendor_code: null, coi_data: { coverageLines: [] }, coi_manual_values: {} };
    assert.equal(buildListItemFields(unknown).Vendor, null); assert.equal(buildListItemFields(unknown).DocDate, null);
  });
});

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runFileDocument({ row, body, uploadImpl, stampImpl, preflightRow = row, lockedRow = row, graph = {} }) {
  const uploadCalls = [];
  const warnings = [];
  const queries = [];
  let selectCount = 0;
  let lockCount = 0;
  let updatedRow = null;
  let updateParams = null;
  const legacyAuditCalls = [];
  const auditEventCalls = [];

  const pool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) {
        lockCount += 1;
        return { rows: [lockCount === 1 ? preflightRow : lockedRow] };
      }
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        selectCount += 1;
        return { rows: [updatedRow || row] };
      }
      if (/UPDATE documents\s+SET filed = true/.test(sql)) {
        updateParams = params;
        updatedRow = {
          ...row,
          filed: true,
          needs_review: false,
          filed_at: new Date('2026-07-02T12:00:00Z'),
          filed_destination: params[1] ?? row.filed_destination ?? null,
          filing_note: params[2] || row.filing_note || null,
          hold_reason: params[3] || row.hold_reason || null,
          sp_file_url: params[4] || row.sp_file_url || null,
          sharepoint_item_id: params[5] || row.sharepoint_item_id || null,
          sharepoint_filename: params[6] || row.sharepoint_filename || null,
        };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  // Exercise the real transaction wrapper, not its pool-only test fallback.
  pool.connect = async () => ({ query: pool.query, release() {} });

  const supabase = {
    pool,
    audit: async (...args) => { legacyAuditCalls.push(args); },
    rowToDoc: (doc) => ({
      id: doc.id,
      filed: Boolean(doc.filed),
      needsReview: Boolean(doc.needs_review),
      spFileUrl: doc.sp_file_url || null,
      sharePointItemId: doc.sharepoint_item_id || null,
      sharePointFilename: doc.sharepoint_filename || null,
    }),
  };

  const sharepointFilingService = {
    PROJECTS_DRIVE_ID: 'drive-id',
    uploadDocumentToJobFolder: async (args) => {
      uploadCalls.push(args);
      return uploadImpl(args);
    },
    uploadFileToDestination: async (args) => {
      uploadCalls.push(args);
      return uploadImpl(args);
    },
    stampListItemFields: stampImpl || (async () => {}),
  };

  const auditEvents = {
    checkStateMatch: () => ({ match: true, staleFields: [] }),
    emitInvoiceAuditEvent: async (_req, _res, event) => { auditEventCalls.push(event); return { id: 'event-1' }; },
    findUndoableAction: async () => null,
    getRequestAuditActor: () => ({ name: 'tester' }),
    insertAuditEvent: async () => null,
    markActionUndone: async () => null,
  };

  const req = {
    params: { id: row.id },
    body,
    log: {
      warn(context, message) {
        warnings.push({ context, message });
      },
    },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': supabase,
    './sharepointFilingService': sharepointFilingService,
    '../../../lib/graph': graph,
    '../../../lib/auditEvents': auditEvents,
    '../../../middleware/errorResponse': {
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const { fileDocument } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await fileDocument(req, res);
  });

  const persisted = await pool.query('SELECT * FROM documents WHERE id = $1', [row.id]);
  return { uploadCalls, warnings, queries, updateParams, res, legacyAuditCalls, auditEventCalls, persistedRow: structuredClone(persisted.rows[0]) };
}

test('fileDocument persists SharePoint item id and filename from upload result', async () => {
  const result = await runFileDocument({
    row: baseDocument(),
    body: { uploadToSharePoint: true, destination: 'Billings' },
    uploadImpl: async () => ({
      id: 'sp-item-3',
      name: 'INV Halden Brooks 06-15-26 #2.pdf',
      webUrl: 'https://sharepoint/uploaded',
    }),
  });

  assert.equal(result.updateParams[4], 'https://sharepoint/uploaded');
  assert.equal(result.updateParams[5], 'sp-item-3');
  assert.equal(result.updateParams[6], 'INV Halden Brooks 06-15-26 #2.pdf');
  assert.equal(result.res.body.invoice.needsReview, false);
  assert.equal(result.res.body.invoice.sharePointItemId, 'sp-item-3');
  assert.deepEqual(result.res.body.sharePoint, {
    uploaded: true,
    webUrl: 'https://sharepoint/uploaded',
    itemId: 'sp-item-3',
    filename: 'INV Halden Brooks 06-15-26 #2.pdf',
  });
});

test('fileDocument upload route uses the canonical resolved job when sources conflict', async () => {
  const result = await runFileDocument({
    row: baseDocument({
      job_number: '26-401',
      job_match_number: '26-402',
      filing_manual_values: { jobNumber: '26-409', vendor: 'Manual Vendor' },
      vendor_name: 'Extracted Vendor',
      matched_vendor_name: 'Matched Vendor',
    }),
    body: { uploadToSharePoint: true, destination: 'Billings' },
    uploadImpl: async (args) => ({ id: 'sp-resolved', name: args.document.file_name, webUrl: 'https://sharepoint/resolved' }),
  });

  assert.equal(result.uploadCalls.length, 1);
  assert.equal(result.uploadCalls[0].jobNumber, '26-409');
  assert.equal(result.uploadCalls[0].document.filing_manual_values.vendor, 'Manual Vendor');
});

test('fileDocument blocks transient statuses before SharePoint upload', async () => {
  const result = await runFileDocument({
    row: baseDocument({ status: 'split-processing' }),
    body: { uploadToSharePoint: true, destination: 'Billings' },
    uploadImpl: async () => {
      assert.fail('SharePoint upload should not run for transient documents');
    },
  });

  assert.equal(result.res.statusCode, 409);
  assert.deepEqual(result.res.body, {
    error: 'Cannot file document while status is "split-processing".',
    code: 'TRANSIENT_STATUS',
  });
  assert.equal(result.uploadCalls.length, 0);
  assert.equal(result.updateParams, null);
});

test('fileDocument deletes a just-uploaded SharePoint copy when the locked recheck blocks filing', async () => {
  const deleted = [];
  const result = await runFileDocument({
    row: baseDocument({ status: 'pending' }),
    lockedRow: baseDocument({ status: 'submitting' }),
    body: { uploadToSharePoint: true, destination: 'Billings' },
    uploadImpl: async () => ({
      id: 'sp-racing-upload',
      name: 'INV Halden Brooks 06-15-26 #2.pdf',
      webUrl: 'https://sharepoint/racing-upload',
    }),
    graph: {
      deleteDriveItem: async (driveId, itemId) => deleted.push({ driveId, itemId }),
    },
  });

  assert.equal(result.uploadCalls.length, 1);
  assert.deepEqual(deleted, [{ driveId: 'drive-id', itemId: 'sp-racing-upload' }]);
  assert.equal(result.updateParams, null);
  assert.equal(result.res.statusCode, 409);
  assertCanonicalErrorBody(result.res.body);
  assert.equal(result.res.body.code, 'TRANSIENT_STATUS');
});

test('fileDocument preserves the guarded response and surfaces a warning when SharePoint compensation fails', async () => {
  const result = await runFileDocument({
    row: baseDocument({ status: 'pending' }),
    lockedRow: baseDocument({ status: 'submitting' }),
    body: { uploadToSharePoint: true, destination: 'Billings' },
    uploadImpl: async () => ({
      id: 'sp-orphaned-upload',
      name: 'INV Halden Brooks 06-15-26 #2.pdf',
      webUrl: 'https://sharepoint/orphaned-upload',
    }),
    graph: {
      deleteDriveItem: async () => { throw new Error('Graph delete 500'); },
    },
  });

  assert.equal(result.updateParams, null);
  assert.equal(result.res.statusCode, 409);
  assertCanonicalErrorBody(result.res.body);
  assert.equal(result.res.body.code, 'TRANSIENT_STATUS');
  assert.deepEqual(result.res.body.details.sharePoint, {
    uploaded: true,
    itemId: 'sp-orphaned-upload',
    warning: 'SharePoint upload could not be removed after filing was blocked: Graph delete 500',
  });
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].context.operation, 'invoice.file.sharepoint_compensation');
});

test('fileDocument holds one connected-client lock through upload and returns 409 to an already-filed concurrent loser', async () => {
  const row = baseDocument({ status: 'pending' });
  const events = [];
  let lockOwner = null;
  let releaseWaiter = null;
  let uploadStarted;
  let resolveUpload;
  let secondLockWaited;
  const uploadStartedPromise = new Promise((resolve) => { uploadStarted = resolve; });
  const secondLockWaitedPromise = new Promise((resolve) => { secondLockWaited = resolve; });
  const uploadResultPromise = new Promise((resolve) => { resolveUpload = resolve; });

  function makeClient(name) {
    return {
      async query(sql, params = []) {
        if (sql === 'BEGIN') {
          events.push(`${name}:BEGIN`);
          return { rows: [] };
        }
        if (sql === 'COMMIT') {
          events.push(`${name}:COMMIT`);
          if (lockOwner === name) {
            lockOwner = null;
            releaseWaiter?.();
          }
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') return { rows: [] };
        if (/FOR UPDATE/.test(sql)) {
          if (lockOwner && lockOwner !== name) {
            secondLockWaited();
            await new Promise((resolve) => { releaseWaiter = resolve; });
          }
          lockOwner = name;
          events.push(`${name}:LOCK`);
          return { rows: [{ ...row }] };
        }
        if (/UPDATE documents\s+SET filed = true/.test(sql)) {
          row.filed = true;
          row.sp_file_url = params[4];
          row.sharepoint_item_id = params[5];
          row.sharepoint_filename = params[6];
          return { rows: [] };
        }
        if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [{ ...row }] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release() {},
    };
  }

  let clientCount = 0;
  const pool = { connect: async () => makeClient(`tx-${++clientCount}`) };
  const supabase = {
    pool,
    audit: async () => {},
    rowToDoc: (doc) => ({ id: doc.id, filed: Boolean(doc.filed) }),
  };
  const reqA = { params: { id: row.id }, body: { uploadToSharePoint: true }, log: { warn() {} } };
  const reqB = { params: { id: row.id }, body: { uploadToSharePoint: true }, log: { warn() {} } };
  const resA = makeRes();
  const resB = makeRes();

  await withMockedModules({
    './supabase': supabase,
    './sharepointFilingService': {
      PROJECTS_DRIVE_ID: 'drive-id',
      uploadDocumentToJobFolder: async () => {
        events.push('upload:start');
        uploadStarted();
        return uploadResultPromise;
      },
    },
    '../../../lib/auditEvents': {
      checkStateMatch: () => ({ match: true, staleFields: [] }),
      emitInvoiceAuditEvent: async () => ({ id: 'event-1' }),
      findUndoableAction: async () => null,
      getRequestAuditActor: () => ({ name: 'tester' }),
      insertAuditEvent: async () => null,
      markActionUndone: async () => null,
    },
    '../../../middleware/errorResponse': { safeError: (response, err) => response.status(500).json({ error: err.message }) },
  }, async () => {
    const { fileDocument } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    const first = fileDocument(reqA, resA);
    await uploadStartedPromise;
    const second = fileDocument(reqB, resB);
    await secondLockWaitedPromise;
    assert.deepEqual(events, ['tx-1:BEGIN', 'tx-1:LOCK', 'upload:start', 'tx-2:BEGIN']);

    resolveUpload({ id: 'sp-winner', name: 'winner.pdf', webUrl: 'https://sharepoint/winner' });
    await Promise.all([first, second]);
  });

  assert.equal(resA.body.invoice.id, row.id);
  assert.equal(resB.statusCode, 409);
  assert.equal(resB.body.code, 'ALREADY_FILED');
  assert.deepEqual(events, [
    'tx-1:BEGIN',
    'tx-1:LOCK',
    'upload:start',
    'tx-2:BEGIN',
    'tx-1:LOCK',
    'tx-1:COMMIT',
    'tx-2:LOCK',
    'tx-2:COMMIT',
  ]);
});

test('fileDocument can add SharePoint metadata to an already-shelved document', async () => {
  const result = await runFileDocument({
    row: baseDocument({ filed: true, needs_review: false, filed_at: new Date('2026-07-01T12:00:00Z') }),
    body: { uploadToSharePoint: true, destination: 'Closeout' },
    uploadImpl: async () => ({
      id: 'sp-item-shelved',
      name: 'INV Halden Brooks 06-15-26 #2.pdf',
      webUrl: 'https://sharepoint/shelved-project-file',
    }),
  });

  assert.equal(result.uploadCalls.length, 1);
  assert.equal(result.res.body.invoice.filed, true);
  assert.equal(result.res.body.invoice.needsReview, false);
  assert.equal(result.res.body.invoice.spFileUrl, 'https://sharepoint/shelved-project-file');
  assert.equal(result.res.body.invoice.sharePointItemId, 'sp-item-shelved');
});

test('fileDocument preserves a historical filename when re-filing an already-shelved document', async () => {
  const result = await runFileDocument({
    row: baseDocument({
      filed: true,
      needs_review: false,
      filed_at: new Date('2026-07-01T12:00:00Z'),
      sp_file_url: null,
      sharepoint_filename: 'Historical Name.pdf',
    }),
    body: { uploadToSharePoint: true, destination: 'Closeout' },
    uploadImpl: async () => ({
      id: 'sp-item-refile',
      name: 'INV Halden Brooks 06-15-26 #2 (2).pdf',
      webUrl: 'https://sharepoint/refile',
    }),
  });

  assert.equal(result.updateParams[6], 'Historical Name.pdf');
  assert.equal(result.res.body.invoice.sharePointFilename, 'Historical Name.pdf');
  assert.equal(result.res.body.sharePoint.filename, 'INV Halden Brooks 06-15-26 #2 (2).pdf');
});

test('fileDocument forwards a user filename override to the SharePoint upload boundary', async () => {
  const result = await runFileDocument({
    row: baseDocument(),
    body: { uploadToSharePoint: true, destination: 'Billings', filename: 'INV Halden Brooks 06-15-26 #2.pdf' },
    uploadImpl: async (args) => {
      return {
        id: 'sp-item-4',
        name: 'INV Halden Brooks 06-15-26 #2.pdf',
        webUrl: 'https://sharepoint/custom',
      };
    },
  });

  assert.equal(result.uploadCalls[0].fileName, 'INV Halden Brooks 06-15-26 #2.pdf');
  assert.equal(result.updateParams[6], 'INV Halden Brooks 06-15-26 #2.pdf');
});

test('fileDocument accepts a user filename override without a stale-preview conflict', async () => {
  const result = await runFileDocument({
    row: baseDocument(),
    body: { uploadToSharePoint: true, destination: 'Billings', filename: 'Custom Upload.pdf' },
    uploadImpl: async (args) => ({
      id: 'sp-item-custom',
      name: args.fileName,
      webUrl: 'https://sharepoint/custom-upload',
    }),
  });

  assert.equal(result.res.statusCode, null);
  assert.equal(result.res.body.invoice.filed, true);
  assert.equal(result.uploadCalls[0].fileName, 'Custom Upload.pdf');
  assert.equal(result.updateParams[6], 'Custom Upload.pdf');
  assert.equal(result.queries.filter(({ sql }) => /UPDATE documents/.test(sql)).length, 1);
});

test('fileDocument audits raw and landed override names, omitting sanitized-empty input', async () => {
  const filed = await runFileDocument({
    row: baseDocument(),
    body: { uploadToSharePoint: true, filename: '  Custom:/ Name.pdf  ' },
    uploadImpl: async () => ({ id: 'sp-audit', name: 'Custom Name.pdf', webUrl: 'https://sharepoint/audit' }),
  });
  assert.deepEqual(filed.legacyAuditCalls[0][2].requestedFilename, 'Custom:/ Name.pdf');
  assert.equal(filed.legacyAuditCalls[0][2].sharePointFilename, 'Custom Name.pdf');
  assert.deepEqual(filed.auditEventCalls[0].changes.requestedFilename, 'Custom:/ Name.pdf');
  assert.equal(filed.auditEventCalls[0].changes.sharePointFilename, 'Custom Name.pdf');

  const empty = await runFileDocument({
    row: baseDocument(),
    body: { uploadToSharePoint: true, filename: ' /:*?"<>|\\ ' },
    uploadImpl: async () => ({ id: 'sp-empty', name: 'INV Halden Brooks 06-15-26 #2.pdf', webUrl: 'https://sharepoint/empty' }),
  });
  assert.equal(Object.hasOwn(empty.legacyAuditCalls[0][2], 'requestedFilename'), false);
  assert.equal(Object.hasOwn(empty.auditEventCalls[0].changes, 'requestedFilename'), false);
});

test('uploadDocumentToJobFolder retries a live collision with a fresh suffix and returns the uploaded name', async () => {
  const localFilePath = makeTempFile('raw-invoice.pdf');
  const uploadNames = [];
  let listingCount = 0;
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      if (folderPath === '26-000') return [{ id: 'job-folder', name: '26-123 - Sample Job', isFolder: true }];
      if (folderPath === '26-000/26-123 - Sample Job') return [{ id: 'billings', name: 'Billings', isFolder: true }];
      if (folderPath === '26-000/26-123 - Sample Job/Billings') {
        listingCount += 1;
        return listingCount === 1
          ? []
          : [{ id: 'existing', name: 'INV Halden Brooks 06-15-26 #2.pdf', isFolder: false }];
      }
      return [];
    },
    uploadDriveFile: async (_driveId, _folderPath, fileName) => {
      uploadNames.push(fileName);
      if (uploadNames.length === 1) {
        const error = new Error('Graph upload 409 conflict');
        error.status = 409;
        throw error;
      }
      return { id: 'sp-collision-2', name: fileName, webUrl: 'https://sharepoint/collision-2' };
    },
    patchListItemFields: async () => ({}),
  };

  await withMockedModules({
    '../../../lib/graph': graph,
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { uploadDocumentToJobFolder } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const result = await uploadDocumentToJobFolder({
      jobNumber: '26-123',
      destination: 'Billings',
      localFilePath,
      document: baseDocument(),
    });

    assert.deepEqual(uploadNames, [
      'INV Halden Brooks 06-15-26 #2.pdf',
      'INV Halden Brooks 06-15-26 #2 (2).pdf',
    ]);
    assert.equal(result.name, 'INV Halden Brooks 06-15-26 #2 (2).pdf');
  });
});

test('fileDocument surfaces metadata warning without blocking local filing', async () => {
  const result = await runFileDocument({
    row: baseDocument(),
    body: { uploadToSharePoint: true },
    uploadImpl: async () => ({
      id: 'sp-item-5',
      name: 'INV Halden Brooks 06-15-26 #2.pdf',
      webUrl: 'https://sharepoint/warn',
      metadataWarning: 'Graph 400 Bad Request',
    }),
  });

  assert.equal(result.res.body.invoice.filed, true);
  assert.equal(result.res.body.sharePoint.warning, 'Graph 400 Bad Request');
});

test('fileDocument honors explicit Projects root over a matched job and stale destination', async () => {
  const result = await runFileDocument({
    row: baseDocument({ classification: 'other', filed_destination: 'Old/Folder' }),
    body: { uploadToSharePoint: true, destinationAbsolute: '', destination: 'Old/Folder', filename: 'Root.pdf' },
    uploadImpl: async () => ({ id: 'sp-root', name: 'Root.pdf', webUrl: 'https://sharepoint/root-file' }),
  });
  assert.equal(result.uploadCalls.length, 1);
  assert.equal(result.uploadCalls[0].parentPath, '', 'root must use the direct-destination upload');
  assert.equal(Object.hasOwn(result.uploadCalls[0], 'jobNumber'), false);
  assert.equal(result.uploadCalls[0].filename, 'Root.pdf');
  assert.equal(result.updateParams[1], '', 'SQL must replace the old destination with root, not fall back');
  assert.equal(result.persistedRow.filed_destination, '');
  assert.equal(result.res.body.sharePoint.uploaded, true);
  assert.equal(result.res.body.invoice.filed, true);
  assert.equal(result.auditEventCalls[0].beforeState.filed_destination, 'Old/Folder');
  assert.equal(result.auditEventCalls[0].afterState.filed_destination, '');
});

test('rowToDoc preserves an explicitly filed Projects-root destination', () => {
  const { rowToDoc } = freshRequire('modules/invoices/services/supabase.js');
  const row = baseDocument({ classification: 'other', filed: true, filed_destination: '', sp_file_url: 'https://sharepoint/root-file' });
  assert.equal(rowToDoc(row).filedDestination, '');
  assert.equal(rowToDoc({ ...row, filed_destination: null }).filedDestination, null);
  assert.equal(rowToDoc({ ...row, filed_destination: 'Shared/Contracts' }).filedDestination, 'Shared/Contracts');
});

test('fileDocument retries a Projects-root upload without a job and tolerates metadata failure', async () => {
  const body = { uploadToSharePoint: true, destinationAbsolute: '', destination: 'Old/Folder', filename: 'Root.pdf' };
  const before = baseDocument({ classification: 'other', job_match_number: null, filed_destination: 'Old/Folder' });
  const failed = await runFileDocument({
    row: before, body,
    uploadImpl: async () => { throw new Error('Graph root upload 500'); },
  });
  assert.equal(failed.uploadCalls[0].parentPath, '');
  assert.deepEqual(failed.persistedRow, before);
  assert.equal(failed.res.body.sharePoint.uploaded, false);
  assert.equal(failed.auditEventCalls.length, 0);
  const retried = await runFileDocument({
    row: failed.persistedRow, body,
    uploadImpl: async () => ({ id: 'sp-root-retry', name: 'Root.pdf', webUrl: 'https://sharepoint/root-retry' }),
    stampImpl: async () => { throw new Error('Root metadata warning'); },
  });
  assert.equal(retried.uploadCalls[0].parentPath, '');
  assert.equal(Object.hasOwn(retried.uploadCalls[0], 'jobNumber'), false);
  assert.equal(retried.persistedRow.filed_destination, '');
  assert.equal(retried.persistedRow.filed, true);
  assert.equal(retried.res.body.sharePoint.uploaded, true);
  assert.equal(retried.res.body.sharePoint.warning, 'Root metadata warning');
  assert.equal(retried.res.body.action.undoable, true);
  assert.equal(retried.auditEventCalls.length, 1);
  assert.equal(retried.legacyAuditCalls.length, 1);
});

test('fileDocument keeps job-default and nested direct destinations distinct from explicit root', async (t) => {
  for (const scenario of [
    { name: 'omitted absolute path uses matched job', body: {}, job: true, destination: 'Billings' },
    { name: 'null absolute path uses matched job', body: { destinationAbsolute: null }, job: true, destination: 'Billings' },
    { name: 'explicit nested destination needs no job', body: { destinationAbsolute: ' /Shared//./Contracts/../ ' }, job: false, destination: 'Shared/Contracts' },
  ]) {
    await t.test(scenario.name, async () => {
      const result = await runFileDocument({
        row: baseDocument({ classification: 'other', job_match_number: scenario.job ? '26-123' : null }),
        body: { uploadToSharePoint: true, destination: 'Billings', ...scenario.body },
        uploadImpl: async () => ({ id: 'sp-selection', name: 'Document.pdf', webUrl: 'https://sharepoint/selection' }),
      });
      assert.equal(result.uploadCalls.length, 1);
      if (scenario.job) {
        assert.equal(result.uploadCalls[0].jobNumber, '26-123');
        assert.equal(result.uploadCalls[0].destination, scenario.destination);
      } else {
        assert.equal(result.uploadCalls[0].parentPath, scenario.destination);
        assert.equal(Object.hasOwn(result.uploadCalls[0], 'jobNumber'), false);
      }
      assert.equal(result.persistedRow.filed_destination, scenario.destination);
      assert.equal(result.res.body.sharePoint.uploaded, true);
    });
  }
});

test('uploadFileToDestination lists and uploads at Projects root with no job resolution', async () => {
  const calls = [];
  const graph = {
    listDriveChildren: async (driveId, parentPath) => { calls.push(['list', driveId, parentPath]); return []; },
    uploadDriveFile: async (driveId, parentPath, name, content) => {
      calls.push(['upload', driveId, parentPath, name, content.toString()]);
      return { id: 'sp-root-graph', name, webUrl: 'https://sharepoint/root-graph' };
    },
  };
  await withMockedModules({
    '../../../lib/graph': graph,
    '../../../lib/logger': { info() {}, warn() {} },
    '../../../config': { DATA_DIR: makeTempDataDir() },
  }, async () => {
    const { uploadFileToDestination } = freshRequire('modules/invoices/services/sharepointFilingService.js');
    const item = await uploadFileToDestination({
      driveId: 'synthetic-projects-drive', parentPath: '', content: Buffer.from('synthetic PDF'),
      localFilePath: '/tmp/source.pdf', document: baseDocument({ classification: 'other', job_match_number: null }), filename: 'Root.pdf',
    });
    assert.deepEqual(calls, [
      ['list', 'synthetic-projects-drive', ''],
      ['upload', 'synthetic-projects-drive', '', 'Root.pdf', 'synthetic PDF'],
    ]);
    assert.equal(item.id, 'sp-root-graph');
  });
});

test('fileDocument preserves local state when SharePoint upload fails', async (t) => {
  const cases = [
    { name: 'job folder upload rejection', error: 'Graph upload 500' },
    { name: 'direct destination without a job', row: { classification: 'other', job_match_number: null }, body: { destinationAbsolute: 'Shared/Contracts' }, error: 'Graph upload 500' },
    { name: 'missing source file', row: { file_path: null }, error: 'Document file is missing on disk', uploads: 0 },
    { name: 'missing source file for direct destination', row: { file_path: null }, body: { destinationAbsolute: 'Shared/Contracts' }, error: 'Document file is missing on disk', uploads: 0 },
    { name: 'missing job', row: { job_match_number: null }, error: 'Document has no matched job number', uploads: 0 },
    { name: 'Projects root without source or job', row: { classification: 'other', file_path: null, job_match_number: null }, body: { destinationAbsolute: '' }, error: 'Document file is missing on disk', uploads: 0 },
    { name: 'Projects root upload rejection', row: { classification: 'other', job_match_number: null }, body: { destinationAbsolute: '' }, error: 'Graph upload 500' },
    { name: 'already shelved record', row: { filed: true, filed_at: new Date('2026-07-01T12:00:00Z'), sharepoint_filename: 'Historical.pdf' }, error: 'Graph upload 500' },
    { name: 'empty upload error message', thrownError: '', error: 'SharePoint upload failed' },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const row = baseDocument({
        status: 'pending', filed_at: null, filed_destination: 'Original folder',
        filing_note: 'Original note', hold_reason: 'Original hold',
        updated_at: new Date('2026-07-01T00:00:00Z'),
        ...scenario.row,
      });
      const before = structuredClone(row);
      const result = await runFileDocument({
        row,
        body: { uploadToSharePoint: true, destination: 'Billings', note: 'New note', holdReason: 'New hold', ...scenario.body },
        uploadImpl: async () => { throw new Error(scenario.thrownError ?? 'Graph upload 500'); },
      });
      assert.equal(result.res.statusCode, null);
      assert.equal(result.res.body.invoice.filed, row.filed);
      assert.equal(result.res.body.invoice.needsReview, row.needs_review);
      assert.deepEqual(result.persistedRow, before, 'post-transaction read must match the complete original row');
      assert.equal(result.updateParams, null);
      assert.equal(result.queries.some(({ sql }) => /UPDATE documents/.test(sql)), false);
      assert.equal(result.queries[0].sql, 'BEGIN');
      assert.equal(result.queries.at(-2).sql, 'COMMIT');
      assert.equal(result.uploadCalls.length, scenario.uploads ?? 1);
      assert.deepEqual(result.res.body.sharePoint, { uploaded: false, error: scenario.error });
      assert.equal(Object.hasOwn(result.res.body, 'action'), false);
      assert.deepEqual(result.legacyAuditCalls, []);
      assert.deepEqual(result.auditEventCalls, []);
    });
  }
});

test('fileDocument retries after failed upload using only the persisted row', async () => {
  const body = { uploadToSharePoint: true, destinationAbsolute: 'Shared/Contracts', filename: 'Contract.pdf' };
  const failed = await runFileDocument({
    row: baseDocument({ classification: 'other', job_match_number: null }), body,
    uploadImpl: async () => { throw new Error('Graph upload 500'); },
  });
  assert.equal(failed.persistedRow.filed, false);
  assert.equal(failed.res.body.invoice.filed, false);

  // Rebuild the request from server storage, as after reload/remount. No
  // optimistic client override can make this test pass on the old service.
  const retried = await runFileDocument({
    row: failed.persistedRow, body,
    uploadImpl: async () => ({ id: 'sp-retry', name: 'Contract.pdf', webUrl: 'https://sharepoint/retry' }),
  });
  assert.equal(retried.persistedRow.filed, true);
  assert.equal(retried.persistedRow.sp_file_url, 'https://sharepoint/retry');
  assert.equal(retried.res.body.sharePoint.uploaded, true);
  assert.equal(retried.res.body.action.undoable, true);
  assert.equal(retried.legacyAuditCalls.length, 1);
  assert.equal(retried.legacyAuditCalls[0][1], 'filed');
  assert.equal(retried.legacyAuditCalls[0][3], 'tester');
  assert.equal(retried.auditEventCalls.length, 1);
  assert.deepEqual(retried.auditEventCalls[0].changes.filed, [false, true]);
  assert.equal(retried.auditEventCalls[0].beforeState.filed, false);
  assert.equal(retried.auditEventCalls[0].afterState.filed, true);
});

test('fileDocument still shelves locally without requesting SharePoint', async () => {
  const result = await runFileDocument({
    row: baseDocument({ classification: 'other', job_match_number: null, file_path: null }),
    body: { note: 'Shelve only' },
    uploadImpl: async () => { assert.fail('Shelving must not upload'); },
  });
  assert.equal(result.persistedRow.filed, true);
  assert.equal(result.persistedRow.filing_note, 'Shelve only');
  assert.equal(result.uploadCalls.length, 0);
  assert.equal(result.res.body.sharePoint, undefined);
  assert.equal(result.res.body.action.undoable, true);
  assert.equal(result.legacyAuditCalls.length, 1);
  assert.equal(result.auditEventCalls.length, 1);
});

test('fileDocument does not route statements through SharePoint upload path', async () => {
  const result = await runFileDocument({
    row: baseDocument({ classification: 'statement' }),
    body: { uploadToSharePoint: true, destination: 'Statements' },
    uploadImpl: async () => {
      throw new Error('Statement should not upload');
    },
  });

  assert.equal(result.uploadCalls.length, 0);
  assert.equal(result.res.body.invoice.filed, true);
  assert.equal(result.updateParams[4], null);
  assert.equal(result.updateParams[5], null);
  assert.equal(result.updateParams[6], null);
  assert.equal(result.res.body.sharePoint, undefined);
});
