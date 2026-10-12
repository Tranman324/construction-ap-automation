'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
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

test('re-extract counts identify output and converts hostile database paths as argv', async () => {
  const calls = [];
  const mocks = [
    [(request) => request === 'child_process', childProcessStub(calls)],
    [(request) => request === '../../../lib/scriptDb', { createScriptClient: () => ({ query: async () => ({}), end: async () => {} }) }],
    [(request) => request === '../services/matcher', { matchInvoice() {} }],
    [(request) => request === '../services/pipeline', { buildCoiExtractionPrompt() {}, normalizeExtractedFieldsForClassification() {} }],
    [(request) => request === '../services/statementAttributes', { mergeReextractedStatementAttributes() {} }],
    [(request) => request === 'dotenv', { config() {} }],
  ];

  await withMocks(mocks, () => {
    const { modulePath, exports } = freshRequire('re-extract.js');
    try {
      const hostilePath = '/tmp/invoice $(touch X) `echo hi`;final.pdf';
      assert.equal(exports.getPdfPageCount(hostilePath), 2);
      exports.convertPdfPage(hostilePath, 2, '/tmp/output image.png');
      assert.deepEqual(calls, [
        { command: 'identify', args: [hostilePath], options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] } },
        {
          command: 'convert',
          args: ['-density', '200', `${hostilePath}[2]`, '-quality', '95', '/tmp/output image.png'],
          options: { timeout: 30000 },
        },
      ]);
    } finally { delete require.cache[modulePath]; }
  });
});

test('re-extract treats an unreadable junk PDF as one page without leaking stderr', async () => {
  const calls = [];
  const junkPdf = path.join(require('node:os').tmpdir(), `junk-${process.pid}.pdf`);
  fs.writeFileSync(junkPdf, 'not a PDF');
  const mocks = [
    [(request) => request === 'child_process', {
      ...childProcess,
      execFileSync(command, args, options) {
        calls.push({ command, args, options });
        throw new Error('identify failed');
      },
      execSync() { assert.fail('execSync must not be called'); },
    }],
    [(request) => request === '../../../lib/scriptDb', { createScriptClient: () => ({ query: async () => ({}), end: async () => {} }) }],
    [(request) => request === '../services/matcher', { matchInvoice() {} }],
    [(request) => request === '../services/pipeline', { buildCoiExtractionPrompt() {}, normalizeExtractedFieldsForClassification() {} }],
    [(request) => request === '../services/statementAttributes', { mergeReextractedStatementAttributes() {} }],
    [(request) => request === 'dotenv', { config() {} }],
  ];
  try {
    await withMocks(mocks, () => {
      const { modulePath, exports } = freshRequire('re-extract.js');
      try { assert.equal(exports.getPdfPageCount(junkPdf), 1); } finally { delete require.cache[modulePath]; }
    });
  } finally { fs.rmSync(junkPdf, { force: true }); }
  assert.deepEqual(calls, [{
    command: 'identify', args: [junkPdf],
    options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  }]);
});

test('process-latest converts a Graph attachment path without a shell', async () => {
  const calls = [];
  const mocks = [
    [(request) => request === 'child_process', childProcessStub(calls)],
    [(request) => request === 'dotenv', { config() {} }],
    [(request) => request === '../../../lib/graph', { graphFetch() {}, markUnread() {} }],
    [(request) => request === '../services/matcher', { matchVendor() {}, matchSubcontract() {}, parseJobReference() {} }],
    [(request) => request === '../../../config', { INCOMING_DIR: '/tmp/incoming', INVOICE_MAILBOX: 'test@example.invalid' }],
  ];

  await withMocks(mocks, () => {
    const { modulePath, exports } = freshRequire('process-latest.js');
    try {
      const hostilePath = "/tmp/incoming/a $(touch X) `echo hi`;file.pdf";
      exports.convertFirstPdfPage(hostilePath, '/tmp/page.png');
      assert.deepEqual(calls, [{
        command: 'convert',
        args: ['-density', '200', `${hostilePath}[0]`, '-quality', '95', '/tmp/page.png'],
        options: { timeout: 30000 },
      }]);
    } finally { delete require.cache[modulePath]; }
  });
});

test('purge passes the Box id as a discrete argument', async () => {
  const calls = [];
  const envPath = path.resolve(scriptRoot, '../../../.env');
  const fsStub = new Proxy(fs, {
    get(target, key) {
      if (key === 'readFileSync') return (file, ...args) => {
        if (file === envPath) throw new Error('test does not read environment files');
        return target.readFileSync(file, ...args);
      };
      return target[key];
    },
  });
  const mocks = [
    [(request) => request === 'child_process', childProcessStub(calls)],
    [(request) => request === 'fs', fsStub],
    [(request) => request === '../../../lib/scriptDb', { createScriptClient: () => ({ query: async () => ({}), end: async () => {} }) }],
    [(request) => request === '../../../config', { BOX_SCRIPT: '/mock/box.js' }],
  ];

  await withMocks(mocks, async () => {
    const { modulePath, exports } = freshRequire('purge.js');
    try {
      assert.equal(await exports.deleteFromBox('box-id; touch X'), true);
    } finally { delete require.cache[modulePath]; }
  });

  assert.deepEqual(calls, [{
    command: 'node', args: ['/mock/box.js', 'delete', 'box-id; touch X'],
    options: { encoding: 'utf8', stdio: 'pipe' },
  }]);
});
