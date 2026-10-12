'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const serviceDir = path.join(root, 'modules', 'invoices', 'services');
const scriptDir = path.join(root, 'modules', 'invoices', 'scripts');
const relocatedNames = ['matcher.js', 'pipeline.js', 'rematch.js'];
const stalePathPattern = /modules\/invoices\/scripts\/(?:matcher|pipeline|rematch)(?:\.js)?|(?:^|[^\w])(?:\.\.\/)?scripts\/(?:matcher|pipeline|rematch)(?:\.js)?/;
const staleSiblingImportPattern = /require\(['"]\.\/(?:matcher|pipeline|rematch)['"]\)/;
const staleJoinedPathPattern = /['"]scripts['"]\s*,\s*['"](?:matcher|pipeline|rematch)(?:\.js)?['"]/;
const staleTreePlacementPattern = /(?:^|\n)├── scripts\/\n(?:│   [^\n]*\n)*?│   [├└]── (?:matcher|pipeline|rematch)\.js/m;
const staleCatalogPlacementPattern = /##[^\n]*modules\/invoices\/scripts\/[^\n]*\n(?:(?!## ).*\n)*?\| `(?:matcher|pipeline|rematch)\.js`/m;

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(requestName, parent, isMain) {
    if (Object.hasOwn(mocks, requestName)) return mocks[requestName];
    return originalLoad.call(this, requestName, parent, isMain);
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

function findStaleReferences(entries) {
  return entries.filter(({ file, source }) => (
    stalePathPattern.test(source)
    || staleJoinedPathPattern.test(source)
    || staleTreePlacementPattern.test(source)
    || staleCatalogPlacementPattern.test(source)
    || (file.startsWith('modules/invoices/scripts/') && staleSiblingImportPattern.test(source))
  ));
}

function walkJavaScript(directory) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...walkJavaScript(absolutePath));
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      entries.push({ file: path.relative(root, absolutePath), source: fs.readFileSync(absolutePath, 'utf8') });
    }
  }
  return entries;
}

test('relocated rematch uses the shared request-path pool when imported in-process', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const logger = { debug() {}, error() {}, info() {}, warn() {} };

  await withMockedModules({
    '../../../lib/db': pool,
    '../../../lib/logger': logger,
    './matcher': { matchInvoice: async () => { throw new Error('empty sweep must not match'); } },
  }, async () => {
    const { rematchPending } = freshRequire('modules/invoices/services/rematch.js');
    const result = await rematchPending({ dryRun: true, sinceDays: 7 });

    assert.deepEqual(result, { total: 0, improved: 0, unchanged: 0, errors: 0, details: [] });
    assert.equal(queries.length, 1);
    // 'needs_review' as a STATUS value is retired (BE-A): review state lives in
    // flagged_at/flagged_by/flag_reason; no row ever carried the status.
    assert.match(queries[0].sql, /status = 'pending'/);
    assert.doesNotMatch(queries[0].sql, /needs_review/);
    assert.match(queries[0].sql, /created_at > NOW\(\) - INTERVAL '1 day' \* \$1/);
    assert.deepEqual(queries[0].params, [7]);
  });
});

test('the relocated rematch sweep CLI remains standalone-invocable at the new cron path', () => {
  const preload = path.join(root, 'tests', 'fixtures', 'dual-use-relocation', 'preload-rematch-sweep.js');
  const cli = path.join(serviceDir, 'rematch.js');
  const result = spawnSync(
    process.execPath,
    ['--require', preload, cli, 'sweep'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /FAKE_SHARED_POOL_QUERY/);
  assert.deepEqual(JSON.parse(result.stdout), {
    total: 0,
    improved: 0,
    unchanged: 0,
    errors: 0,
    details: [],
  });
});

test('pipeline run names the relocated service entry point without a runtime route harness', () => {
  const source = fs.readFileSync(path.join(root, 'modules', 'invoices', 'routes', 'pipeline.js'), 'utf8');

  assert.match(
    source,
    /spawn\('node', \[path\.join\(__dirname, '\.\.', 'services', 'pipeline\.js'\), 'run'\]/
  );
  assert.equal(fs.existsSync(path.join(serviceDir, 'pipeline.js')), true);
});

test('no old module copy or stale production importer/spawn path survives', () => {
  for (const name of relocatedNames) {
    assert.equal(fs.existsSync(path.join(scriptDir, name)), false, `${name} old copy`);
    assert.equal(fs.existsSync(path.join(serviceDir, name)), true, `${name} relocated copy`);
  }

  const activeEntries = [
    ...walkJavaScript(path.join(root, 'modules')),
    { file: 'eslint.config.js', source: fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8') },
    { file: 'SETUP.md', source: fs.readFileSync(path.join(root, 'SETUP.md'), 'utf8') },
    { file: 'ARCHITECTURE.md', source: fs.readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8') },
  ];
  assert.deepEqual(findStaleReferences(activeEntries), []);
});

test('stale-path inventory catches real importer and spawn sabotage', () => {
  const importerFile = 'modules/invoices/services/approvalStateService.js';
  const importerSource = fs.readFileSync(path.join(root, importerFile), 'utf8');
  const cleanImporter = "require('./matcher')";
  const staleImporter = "require('../scripts/matcher')";
  const sabotagedImporter = importerSource.includes(cleanImporter)
    ? importerSource.replace(cleanImporter, staleImporter)
    : importerSource;
  assert.equal(sabotagedImporter.includes(staleImporter), true, 'importer source must be stale after sabotage');

  const spawnFile = 'modules/invoices/routes/pipeline.js';
  const spawnSource = fs.readFileSync(path.join(root, spawnFile), 'utf8');
  const cleanSpawn = "'services', 'pipeline.js'";
  const staleSpawn = "'scripts', 'pipeline.js'";
  const sabotagedSpawn = spawnSource.includes(cleanSpawn)
    ? spawnSource.replace(cleanSpawn, staleSpawn)
    : spawnSource;
  assert.match(
    sabotagedSpawn,
    /(?:['"]scripts['"]\s*,\s*['"]pipeline\.js['"]|scripts\/pipeline\.js)/,
    'spawn source must be stale after sabotage'
  );

  const sabotage = [
    { file: importerFile, source: sabotagedImporter },
    { file: spawnFile, source: sabotagedSpawn },
  ];

  assert.deepEqual(findStaleReferences(sabotage).map(({ file }) => file), [importerFile, spawnFile]);
});
