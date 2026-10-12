'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const apiRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

function readFromApi(relativePath) {
  return fs.readFileSync(path.join(apiRoot, relativePath), 'utf8');
}

function readFromRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Endpoint Standard cites the shipped endpoint enforcement boundaries', () => {
  const standard = readFromApi('docs/ENDPOINT-STANDARD.md');
  const finalizer = readFromApi('middleware/responseFinalizer.js');
  const server = readFromApi('server.js');
  const eslintConfig = readFromApi('eslint.config.js');
  const packageJson = JSON.parse(readFromApi('package.json'));
  const endpointCoverage = readFromApi('tests/security/endpoint-gates-and-validation.test.js');
  const auditCoverage = readFromApi('tests/audit-events.static.test.js');
  const paginationCoverage = readFromApi('tests/security/error-pagination.test.js');
  const sharePointCoverage = readFromApi('tests/invoices/sharepoint-filing.test.js');
  const prTemplate = readFromRepo('.github/PULL_REQUEST_TEMPLATE.md');
  const agents = readFromRepo('AGENTS.md');

  assert.match(standard, /\{ error, code\?, details\? \}/);
  assert.match(standard, /middleware\/responseFinalizer\.js/);
  assert.match(standard, /emission—not by a construction or call-shape scan/);
  assert.match(finalizer, /const RESPONSE_METHODS = \['json', 'send', 'end', 'write'\]/);
  assert.match(server, /app\.use\(responseFinalizer\)/);

  assert.match(standard, /apps\/api\/eslint\.config\.js/);
  assert.match(standard, /no-restricted-imports/);
  assert.match(standard, /no-restricted-modules/);
  assert.match(standard, /Dynamic imports and routes that reach a low-level service facade are review-only concerns/);
  assert.match(eslintConfig, /'no-restricted-imports'/);
  assert.match(eslintConfig, /'no-restricted-modules'/);
  assert.match(packageJson.scripts.test, /^npm run lint &&/);

  assert.match(standard, /POST \/api\/audit\/events.*SEC-01 exception/s);
  assert.match(standard, /replaces every supplied actor field with `req\.user`/);
  assert.match(endpointCoverage, /AUTH_ONLY_EXCEPTIONS/);
  assert.match(auditCoverage, /Deliberately no requirePermission here/);

  assert.match(standard, /lib\/pagination\.js/);
  assert.match(standard, /tests\/security\/error-pagination\.test\.js/);
  assert.match(paginationCoverage, /getPagination/);
  assert.match(standard, /tests\/invoices\/sharepoint-filing\.test\.js/);
  assert.match(sharePointCoverage, /preserves local state when SharePoint upload fails/);
  assert.match(standard, /upload failure leaves the locked document unchanged/);
  assert.match(standard, /emits no successful filing audit or undo action/);

  assert.match(standard, /apps\/api\/API\.md/);
  assert.match(standard, /apps\/web\/docs\/specs\/invoices\/CONTRACTS\.md/);
  assert.equal(fs.existsSync(path.join(apiRoot, 'API.md')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/web/docs/specs/invoices/CONTRACTS.md')), true);
  assert.match(prTemplate, /## Endpoint standard/);
  assert.match(prTemplate, /construction\/call-shape scanner/);
  assert.match(agents, /apps\/api\/docs\/ENDPOINT-STANDARD\.md/);
});
