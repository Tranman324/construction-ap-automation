'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scriptRoot = path.resolve(__dirname, '../../modules/invoices/scripts');

async function withMocks(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const mock = mocks.find(([matches]) => matches(request, parent));
    return mock ? mock[1] : originalLoad.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = originalLoad; }
}

function childProcessStub(calls, onExecFile) {
  return {
    ...childProcess,
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      if (onExecFile) return onExecFile(command, args, options);
      return options?.encoding === 'utf8' ? 'page 1\npage 2\n' : Buffer.alloc(0);
    },
    execSync() { assert.fail('execSync must not be called'); },
  };
}

function freshRequire(name) {
  const modulePath = path.join(scriptRoot, name);
  delete require.cache[modulePath];
  return { modulePath, exports: require(modulePath) };
}

test('re-extract auto-detection passes the stored file path to identify as argv', async () => {
  const calls = [];
  const hostilePath = path.join(os.tmpdir(), `auto $(touch X) \`echo hi\`;invoice-${process.pid}.pdf`);
  fs.writeFileSync(hostilePath, '%PDF');
  const pool = {
    async query() {
      return { rows: [{ id: 'auto-detect', file_path: hostilePath, split_from: 'parent', invoice_number: '1', amount: 1 }] };
    },
    async end() {},
  };
  const mocks = [
    [(request) => request === 'child_process', childProcessStub(calls)],
    [(request) => request === '../../../lib/scriptDb', { createScriptClient: () => pool }],
    [(request) => request === '../services/matcher', { matchInvoice() {} }],
    [(request) => request === '../services/pipeline', { buildCoiExtractionPrompt() {}, normalizeExtractedFieldsForClassification() {} }],
    [(request) => request === '../services/statementAttributes', { mergeReextractedStatementAttributes() {} }],
    [(request) => request === 'dotenv', { config() {} }],
  ];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [process.execPath, 're-extract.js'];
  console.log = () => {};
  try {
    await withMocks(mocks, async () => {
      const { modulePath, exports } = freshRequire('re-extract.js');
      try { await exports.main(); } finally { delete require.cache[modulePath]; }
    });
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    fs.rmSync(hostilePath, { force: true });
  }
  assert.deepEqual(calls, [{
    command: 'identify', args: [hostilePath],
    options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  }]);
});

test('process-latest run passes a hostile Graph attachment path to convert as argv', async () => {
  const calls = [];
  const incomingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-latest-'));
  const hostileName = 'invoice $(touch X) `echo hi`;final.pdf';
  let fetchUrl;
  const oldFetch = global.fetch;
  const oldArgv = process.argv;
  const oldKey = process.env.ANTHROPIC_API_KEY;
  const oldLog = console.log;
  const oldError = console.error;
  process.env.ANTHROPIC_API_KEY = 'fixture';
  process.argv = [process.execPath, 'process-latest.js', '1'];
  console.log = () => {};
  console.error = () => {};
  global.fetch = async (url) => {
    fetchUrl = url;
    return { ok: true, json: async () => ({ content: [{ text: '{"classification":"other","vendorName":"Fixture"}' }] }) };
  };
  const childProcessMock = childProcessStub(calls, (_command, args) => {
    fs.writeFileSync(args.at(-1), 'fixture-image');
  });
  const graphMock = {
    async graphFetch(urlPath) {
      if (urlPath.endsWith('/attachments')) {
        return { value: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: hostileName, contentBytes: Buffer.from('%PDF').toString('base64') }] };
      }
      return { value: [{ id: 'message-1', subject: 'fixture', from: { emailAddress: { address: 'sender@example.invalid' } }, receivedDateTime: '2026-01-01', hasAttachments: true }] };
    },
    async markUnread() {},
  };
  const mocks = [
    [(request) => request === 'child_process', childProcessMock],
    [(request) => request === 'dotenv', { config() {} }],
    [(request) => request === '../../../lib/graph', graphMock],
    [(request) => request === '../services/matcher', { matchVendor() {}, matchSubcontract() {}, parseJobReference() {} }],
    [(request) => request === '../../../config', { INCOMING_DIR: incomingDir, INVOICE_MAILBOX: 'test@example.invalid' }],
  ];
  try {
    await withMocks(mocks, async () => {
      const { modulePath, exports } = freshRequire('process-latest.js');
      try { await exports.run(); } finally { delete require.cache[modulePath]; }
    });
  } finally {
    global.fetch = oldFetch;
    process.argv = oldArgv;
    console.log = oldLog;
    console.error = oldError;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
    fs.rmSync(incomingDir, { recursive: true, force: true });
  }
  const expectedInput = path.join(incomingDir, 'message_1', hostileName);
  assert.equal(fetchUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'convert');
  assert.deepEqual(calls[0].args.slice(0, 5), ['-density', '200', `${expectedInput}[0]`, '-quality', '95']);
  assert.match(calls[0].args[5], /^\/tmp\/proc_\d+\.png$/);
  assert.deepEqual(calls[0].options, { timeout: 30000 });
});

test('box archive retention passes a hostile stored Box id as argv', async () => {
  const calls = [];
  const updates = [];
  const hostileBoxId = 'box-id; touch X `echo hi`';
  const pool = {
    async query(sql, params) {
      if (/SELECT id, box_file_id/.test(sql)) {
        return { rows: [{ id: 'retention-fixture', box_file_id: hostileBoxId, box_file_name: 'fixture.pdf' }] };
      }
      updates.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
    async end() {},
  };
  const mocks = [
    [(request) => request === 'child_process', childProcessStub(calls)],
    [(request) => request === '../../../lib/scriptDb', { createScriptClient: () => pool }],
    [(request) => request === '/etc/toolbox/paths.js', { BOX_SCRIPT: '/mock/box.js' }],
  ];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    await withMocks(mocks, async () => {
      const { modulePath, exports } = freshRequire('box-archive.js');
      try { await exports.retentionCleanup(); } finally { delete require.cache[modulePath]; }
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.deepEqual(calls, [{
    command: 'node', args: ['/mock/box.js', 'delete', hostileBoxId],
    options: { encoding: 'utf8', timeout: 30000 },
  }]);
  assert.equal(updates.length, 1);
});
