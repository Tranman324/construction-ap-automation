'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const fixtures = path.join(root, 'tests', 'fixtures', 'script-db-boundary');

function lintAs(fixture, asFilename) {
  return spawnSync(
    process.execPath,
    [eslintBin, '--stdin', '--stdin-filename', asFilename],
    {
      cwd: root,
      encoding: 'utf8',
      input: fs.readFileSync(path.join(fixtures, fixture), 'utf8'),
    }
  );
}

// Both globs: apps/api/scripts/** and apps/api/modules/**/scripts/**.
const SCRIPT_GLOB_PATHS = [
  'scripts/__lint-fixtures__/probe.js',
  'modules/invoices/scripts/__lint-fixtures__/probe.js',
];

for (const asPath of SCRIPT_GLOB_PATHS) {
  test(`script boundary rejects direct lib/db require under ${asPath.split('/')[0]} glob`, () => {
    const result = lintAs('direct-db-require.js', asPath);
    assert.notEqual(result.status, 0, result.stdout || result.stderr);
    assert.match(result.stdout, /no-restricted-modules/);
  });

  test(`script boundary rejects normalized path-spelling lib/db require under ${asPath.split('/')[0]} glob`, () => {
    const result = lintAs('path-spelling-db-require.js', asPath);
    assert.notEqual(result.status, 0, result.stdout || result.stderr);
    assert.match(result.stdout, /no-restricted-modules/);
  });

  test(`script boundary rejects services/supabase require under ${asPath.split('/')[0]} glob`, () => {
    const result = lintAs('supabase-require.js', asPath);
    assert.notEqual(result.status, 0, result.stdout || result.stderr);
    assert.match(result.stdout, /no-restricted-modules/);
  });

  test(`script boundary rejects ES module lib/db import under ${asPath.split('/')[0]} glob`, () => {
    const result = lintAs('direct-db-import.js', asPath);
    assert.notEqual(result.status, 0, result.stdout || result.stderr);
    assert.match(result.stdout, /no-restricted-imports/);
  });
}

test('a script using lib/scriptDb passes the boundary', () => {
  const result = lintAs('scriptdb-ok.js', 'modules/invoices/scripts/__lint-fixtures__/scriptdb-ok.js');
  assert.equal(result.status, 0, result.stdout || result.stderr);
});

test('script boundary has no matcher exception for direct shared-pool imports', () => {
  const result = lintAs('direct-db-require.js', 'modules/invoices/scripts/matcher.js');
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /no-restricted-modules/);
});

test('lint script covers server, routes, and the scripts globs', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.test, /^npm run lint &&/);
  assert.match(packageJson.scripts.lint, /scripts\/\*\*\/\*\.js/);
  assert.match(packageJson.scripts.lint, /modules\/\*\*\/scripts\/\*\*\/\*\.js/);
});
