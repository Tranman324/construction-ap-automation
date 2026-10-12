'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const servicePath = path.resolve(__dirname, '../../modules/invoices/services/attachFileService.js');
const { sanitizeFilename } = require('../../modules/invoices/services/sanitize');

async function withModuleMocks(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const mock = mocks.find(([matches]) => matches(request, parent));
    return mock ? mock[1] : originalLoad.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = originalLoad; }
}

test('manual upload stores the strict sanitized filename and retains the 200-character cap', async () => {
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-upload-test-'));
  const hostileName = 'invoice-$(touch X)-`touch Y`;' + `${'safe'.repeat(70)}.pdf`;
  const doc = {
    id: 'upload-1', classification: 'other', status: 'pending', file_name: null, file_path: null,
    email_message_id: null, email_subject: null, email_body: null, email_from: null,
    email_received_at: null, statement_attributes: null,
  };
  const writes = [];
  const pool = {
    query: async () => ({ rows: [doc] }),
    connect: async () => ({
      query: async (sql, params = []) => {
        writes.push({ sql, params });
        return { rows: [] };
      },
      release() {},
    }),
  };
  const pipeline = {
    classifyAndExtract: async () => ({ classification: 'other', confidence: 0.99, extracted: null }),
    matchInvoiceData: async () => null,
    normalizeExtractedDates() {},
    normalizeExtractedFieldsForClassification: (_classification, fields) => fields,
    parseEmailBodyForJobData: () => ({}),
    isInvoiceLikeClassification: () => false,
    enforceActiveClassification: async (classification) => classification,
  };
  const quietLogger = { info() {}, warn() {} };
  const mocks = [
    [(request, parent) => request === './supabase' && parent.filename === servicePath, { pool }],
    [(request, parent) => request === './graph' && parent.filename === servicePath, { graphFetch: async () => {} }],
    [(request, parent) => request === './logger' && parent.filename === servicePath, quietLogger],
    [(request, parent) => request === './file-types' && parent.filename === servicePath, {
      buildStoredFilename: (id, name) => `${id}-${name}`,
      detectFileType: () => ({ isPdf: true, isImage: false, ext: '.pdf' }),
    }],
    [(request, parent) => request === './docConvert' && parent.filename === servicePath, { convertToPdf() {}, isWordDoc: () => false }],
    [(request, parent) => request === './statementAttributes' && parent.filename === servicePath, { mergeReextractedStatementAttributes: (_a, b) => b }],
    [(request, parent) => request === './sanitize' && parent.filename === servicePath, { sanitizeFilename }],
    [(request, parent) => request === '../../../config' && parent.filename === servicePath, { FILES_DIR: filesDir, INVOICE_MAILBOX: 'test@example.invalid' }],
    [(request, parent) => request === './pipeline' && parent.filename === servicePath, pipeline],
    [(request, parent) => request === './invoiceEditService' && parent.filename === servicePath, { FIELD_MAP: {} }],
  ];

  try {
    await withModuleMocks(mocks, async () => {
      delete require.cache[servicePath];
      const { attachFileAndReprocess } = require(servicePath);
      await attachFileAndReprocess('upload-1', {
        buffer: Buffer.from('%PDF'), originalname: hostileName, size: 4, mimetype: 'application/pdf',
      }, { id: 'test-user' });
    });
  } finally {
    delete require.cache[servicePath];
    fs.rmSync(filesDir, { recursive: true, force: true });
  }

  const update = writes.find(({ sql }) => /^UPDATE documents SET/.test(sql));
  assert.ok(update, 'manual upload should persist the document update');
  const fileNameIndex = Number(update.sql.match(/file_name = \$(\d+)/)[1]) - 1;
  const storedName = update.params[fileNameIndex];
  const expectedStem = sanitizeFilename(hostileName.slice(0, -path.extname(hostileName).length));
  assert.equal(storedName, `${expectedStem.slice(0, 200 - path.extname(hostileName).length)}${path.extname(hostileName)}`);
  assert.doesNotMatch(storedName, /[$`;]/);
  assert.ok(storedName.length <= 200);
});

test('manual upload retains a valid extension for names with no Latin stem', async () => {
  async function upload(originalname, documentId) {
    const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unicode-upload-test-'));
    const storedInputs = [];
    const wordInputs = [];
    const doc = {
      id: documentId, classification: 'other', status: 'pending', file_name: null, file_path: null,
      email_message_id: null, email_subject: null, email_body: null, email_from: null,
      email_received_at: null, statement_attributes: null,
    };
    const pool = {
      query: async () => ({ rows: [doc] }),
      connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    };
    const pipeline = {
      classifyAndExtract: async () => ({ classification: 'other', confidence: 0.99, extracted: null }),
      matchInvoiceData: async () => null,
      normalizeExtractedDates() {},
      normalizeExtractedFieldsForClassification: (_classification, fields) => fields,
      parseEmailBodyForJobData: () => ({}),
      isInvoiceLikeClassification: () => false,
      enforceActiveClassification: async (classification) => classification,
    };
    const mocks = [
      [(request, parent) => request === './supabase' && parent.filename === servicePath, { pool }],
      [(request, parent) => request === './logger' && parent.filename === servicePath, { info() {}, warn() {} }],
      [(request, parent) => request === './file-types' && parent.filename === servicePath, {
        buildStoredFilename: (_id, name) => { storedInputs.push(name); return `${documentId}-${name}`; },
        detectFileType: () => ({ isPdf: true, isImage: false, ext: '.pdf' }),
      }],
      [(request, parent) => request === './docConvert' && parent.filename === servicePath, {
        convertToPdf(filePath) {
          wordInputs.push(filePath);
          const convertedPath = path.join(filesDir, `${documentId}-converted.pdf`);
          fs.writeFileSync(convertedPath, '%PDF converted');
          return convertedPath;
        },
        isWordDoc: () => false,
      }],
      [(request, parent) => request === './statementAttributes' && parent.filename === servicePath, { mergeReextractedStatementAttributes: (_a, b) => b }],
      [(request, parent) => request === './sanitize' && parent.filename === servicePath, { sanitizeFilename }],
      [(request, parent) => request === '../../../config' && parent.filename === servicePath, { FILES_DIR: filesDir, INVOICE_MAILBOX: 'test@example.invalid' }],
      [(request, parent) => request === './pipeline' && parent.filename === servicePath, pipeline],
      [(request, parent) => request === './invoiceEditService' && parent.filename === servicePath, { FIELD_MAP: {} }],
    ];
    try {
      await withModuleMocks(mocks, async () => {
        delete require.cache[servicePath];
        const { attachFileAndReprocess } = require(servicePath);
        await attachFileAndReprocess(documentId, {
          buffer: Buffer.from('%PDF'), originalname, size: 4, mimetype: 'application/pdf',
        }, { id: 'test-user' });
      });
    } finally {
      delete require.cache[servicePath];
      fs.rmSync(filesDir, { recursive: true, force: true });
    }
    return { storedInputs, wordInputs };
  }

  const word = await upload('Счёт.docx', 'unicode-word');
  assert.equal(word.storedInputs[0], 'upload.docx');
  assert.equal(word.wordInputs.length, 1, 'the sanitized .docx name must take the Word conversion path');

  const pdf = await upload('发票.pdf', 'unicode-pdf');
  assert.equal(pdf.storedInputs[0], 'upload.pdf');
  assert.equal(pdf.wordInputs.length, 0);
});
