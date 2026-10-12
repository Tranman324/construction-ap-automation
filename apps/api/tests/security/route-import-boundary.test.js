'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const fixtures = path.join(root, 'tests', 'fixtures', 'route-import-boundary');

function lintStdin(fixture, routeFilename) {
  return spawnSync(
    process.execPath,
    [eslintBin, '--stdin', '--stdin-filename', routeFilename],
    {
      cwd: root,
      encoding: 'utf8',
      input: fs.readFileSync(path.join(fixtures, fixture), 'utf8'),
    }
  );
}

test('route import boundary rejects direct CommonJS database imports', () => {
  const result = lintStdin('direct-db-require.js', 'routes/__lint-fixtures__/direct-db-require.js');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /no-restricted-modules/);
});

test('route import boundary rejects normalized-path spelling variants', () => {
  const result = lintStdin('path-spelling-db-require.js', 'routes/__lint-fixtures__/path-spelling-db-require.js');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /no-restricted-modules/);
});

test('route import boundary rejects ES module database imports', () => {
  const result = lintStdin('direct-db-import.js', 'routes/__lint-fixtures__/direct-db-import.js');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /no-restricted-imports/);
});

test('lint script checks the production server and route boundary', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const result = spawnSync(process.execPath, [eslintBin, 'server.js', 'routes/**/*.js', 'modules/**/routes.js', 'modules/**/routes/**/*.js'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.match(packageJson.scripts.test, /^npm run lint &&/);
  assert.match(packageJson.scripts.lint, /^eslint /);
  assert.equal(result.status, 0, result.stdout || result.stderr);
});
