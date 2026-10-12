'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');
const express = require('express');

const root = path.resolve(__dirname, '..', '..');
process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const sanitizeFilename = require('../../modules/invoices/services/sanitize').sanitizeFilename;
const routePath = path.join(root, 'modules/invoices/routes/splits.js');
const fileServicePath = path.join(root, 'modules/invoices/services/invoiceFileService.js');

async function withModuleMocks(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const mock = mocks.find(([matches]) => matches(request, parent));
    return mock ? mock[1] : originalLoad.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = originalLoad; }
}

function freshRequire(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
}

const next = (_req, _res, done) => done();

test('splits Box fallback passes a hostile filename only as a sanitized execFile argument', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-box-test-'));
  const hostileName = 'invoice-$(touch X)-`touch Y`;final.pdf';
  const boxId = 'box-id; touch X';
  const execFileCalls = [];
  const execSyncCalls = [];
  const childProcessStub = {
    ...childProcess,
    execFileSync(command, args, options) {
      execFileCalls.push({ command, args, options });
      fs.writeFileSync(args[3], Buffer.from('split-box-pdf'));
    },
    execSync(...args) { execSyncCalls.push(args); },
  };
  const logger = { warn() {} };
  const service = {
    cancelSplit: async () => {}, confirmSplit: async () => {}, getSplitChildStatus: async () => null,
    getSplitDocument: async () => null, getSplitSourceDocument: async () => ({
      id: 'doc-1', file_path: null, file_name: hostileName, box_file_id: boxId,
    }), listSplitQueue: async () => ({ rows: [], total: 0 }), rejectSplit: async () => {},
    saveSplitSuggestion: async () => {}, spawnSplitWorker: () => {},
  };
  const passthrough = { requirePermission: () => next, validate: () => next };

  try {
    await withModuleMocks([
      [(request) => request === 'child_process', childProcessStub],
      [(request) => request === '../../../config', { DATA_DIR: dataDir }],
      [(request) => request === '../services/splitService', service],
      [(request) => request === '../services/pdf-split', {}],
      [(request) => request === '../../../lib/requestLog', { getRequestLogger: () => logger }],
      [(request) => request === '../../../lib/auditEvents', { emitInvoiceAuditEvent: async () => {} }],
      [(request) => request === '../../../lib/schemas', { splitConfirmSchema: {}, splitQueueQuerySchema: {} }],
      [(request) => request === '../../../middleware/validate', { validate: passthrough.validate }],
      [(request) => request === '../../../middleware/permissions', { requirePermission: passthrough.requirePermission }],
      [(request) => request === '../../../middleware/errorResponse', {
        fail: (res, code, error) => res.status(code).json({ error }),
        safeError: (res) => res.status(500).json({ error: 'unexpected' }),
      }],
      [(request) => request === '../../../lib/pagination', { getPagination: () => ({ limit: 10, offset: 0 }) }],
      [(request) => request === './settings', { getActiveClassificationNames: async () => new Set() }],
    ], async () => {
      const router = freshRequire(routePath);
      const app = express();
      app.use('/api/splits', router);
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/splits/doc-1/pdf`);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'split-box-pdf');
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  } finally {
    delete require.cache[routePath];
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(execFileCalls.length, 1);
  assert.equal(execFileCalls[0].command, 'node');
  assert.deepEqual(execFileCalls[0].args.slice(1, 3), [
    'download', String(boxId),
  ]);
  assert.equal(execFileCalls[0].args[0], path.join(path.dirname(routePath), '..', '..', '..', '..', 'skills', 'box', 'box.js'));
  assert.equal(execFileCalls[0].args[3], path.join(dataDir, 'tmp-split-sources', `doc-1-${sanitizeFilename(hostileName)}`));
  assert.deepEqual(execFileCalls[0].options, { timeout: 60000 });
  assert.equal(execSyncCalls.length, 0);
});

test('invoice file Box fallback uses execFileSync with a sanitized temp filename', async () => {
  const hostileName = 'invoice-$(touch X)-`touch Y`;final.pdf';
  const calls = [];
  const childProcessStub = {
    ...childProcess,
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      fs.writeFileSync(args[3], Buffer.from('invoice-box-pdf'));
    },
    execSync() { assert.fail('execSync must not be called'); },
  };
  const pool = { query: async () => ({ rows: [{ file_name: hostileName, file_path: null, box_file_id: 12345 }] }) };
  const mocks = [
    [(request) => request === 'child_process', childProcessStub],
    [(request) => request === './supabase', { pool }],
    [(request, parent) => request === './pdf' && parent.filename === fileServicePath, { ensurePdf: async () => null }],
    [(request, parent) => request === '/etc/toolbox/paths.js' && parent.filename === fileServicePath, { BOX_SCRIPT: '/mock/box.js' }],
  ];

  let received = Buffer.alloc(0);
  const response = new Writable({
    write(chunk, _encoding, done) { received = Buffer.concat([received, chunk]); done(); },
  });
  response.set = () => response;
  const finished = new Promise((resolve, reject) => response.once('finish', resolve).once('error', reject));

  try {
    await withModuleMocks(mocks, async () => {
      const { streamInvoiceFile } = freshRequire(fileServicePath);
      await streamInvoiceFile({ params: { id: 'invoice-1' }, log: { warn() {} } }, response);
    });
    await finished;
  } finally {
    delete require.cache[fileServicePath];
  }

  assert.equal(received.toString(), 'invoice-box-pdf');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'node');
  assert.deepEqual(calls[0].args, [
    '/mock/box.js', 'download', '12345',
    path.join('/tmp', `box-invoice-1-${sanitizeFilename(hostileName)}`),
  ]);
  assert.deepEqual(calls[0].options, { timeout: 30000 });
});
