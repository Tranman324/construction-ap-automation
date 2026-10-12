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

function childProcessStub(calls) {
  return {
    ...childProcess,
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      if (command === 'node' && args[0] === '/mock/spectrum-sql.js') return '[]\n(0 rows)';
      return options?.encoding === 'utf8' ? 'uploaded' : Buffer.alloc(0);
    },
    execSync() { assert.fail('execSync must not be called'); },
  };
}

function freshRequire(fileName) {
  const modulePath = path.join(scriptRoot, fileName);
  delete require.cache[modulePath];
  return { modulePath, exports: require(modulePath) };
}

test('purge Discord notification passes hostile message text as one argument', async () => {
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
  const hostileMessage = 'fixture $(touch /tmp/pwn) `id`';
  await withMocks(mocks, async () => {
    const { modulePath, exports } = freshRequire('purge.js');
    try { await exports.notifyDiscord(hostileMessage); } finally { delete require.cache[modulePath]; }
  });
  assert.deepEqual(calls, [{
    command: 'agent-runtime',
    args: ['message', 'send', '--channel', 'discord', '--target', '100000000000000001', '--message', hostileMessage],
    options: { encoding: 'utf8' },
  }]);
});

test('audit-spectrum passes SQL, Discord text, and Box paths as discrete arguments', async () => {
  const calls = [];
  const oldArgv = process.argv;
  const oldLog = console.log;
  process.argv = [process.execPath, 'audit-spectrum.js'];
  console.log = () => {};
  const mocks = [
    [(request) => request === 'child_process', childProcessStub(calls)],
    [(request) => request === '../../../lib/scriptDb', { createScriptClient: () => ({ query: async () => ({}), end: async () => {} }) }],
    [(request) => request === '/etc/toolbox/paths.js', {
      BOX_SCRIPT: '/mock/box.js', SPECTRUM_SQL: '/mock/spectrum-sql.js',
    }],
  ];
  try {
    await withMocks(mocks, async () => {
      const { modulePath, exports } = freshRequire('audit-spectrum.js');
      try {
        assert.deepEqual(exports.sqlQuery('SELECT 1\nWHERE value = "$(touch /tmp/pwn)"'), []);
        exports.postDiscord('fixture $(touch /tmp/pwn) `id`');
        exports.uploadToBox('/tmp/audit $(touch /tmp/pwn).csv');
      } finally { delete require.cache[modulePath]; }
    });
  } finally {
    process.argv = oldArgv;
    console.log = oldLog;
  }

  assert.deepEqual(calls, [
    {
      command: 'node',
      args: ['/mock/spectrum-sql.js', 'query', 'SELECT 1 WHERE value = "$(touch /tmp/pwn)"'],
      options: { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 60000 },
    },
    {
      command: 'agent-runtime',
      args: ['message', 'send', '--channel', 'discord', '-t', '100000000000000001', '--message', '✅ Invoice Audit Complete\n\nfixture $(touch /tmp/pwn) `id`'],
      options: { stdio: 'inherit', timeout: 30000 },
    },
    {
      command: 'node',
      args: ['/mock/box.js', 'upload', '/tmp/audit $(touch /tmp/pwn).csv', '100000000003'],
      options: { encoding: 'utf8', timeout: 60000 },
    },
  ]);
});
