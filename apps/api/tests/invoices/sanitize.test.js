'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  sanitizeFilename,
  sanitizePathFilename,
  sanitizePathForShell,
} = require('../../modules/invoices/services/sanitize');

test('sanitizeFilename strips shell metacharacters and control characters', () => {
  const sanitized = sanitizeFilename('invoice; rm -rf "$HOME"`whoami`\n.pdf');

  assert.equal(sanitized, 'invoice rm -rf HOMEwhoami.pdf');
  assert.doesNotMatch(sanitized, /[;"$`\n\r]/);
});

test('sanitizeFilename neutralizes traversal separators and hidden-file prefixes', () => {
  const cases = new Map([
    ['../secret.pdf', 'secret.pdf'],
    ['..\\secret.pdf', 'secret.pdf'],
    ['/absolute/.env', 'absolute.env'],
    ['...hidden', 'hidden'],
    ['invoice\0.pdf', 'invoice.pdf'],
  ]);

  for (const [input, expected] of cases) {
    const sanitized = sanitizeFilename(input);
    assert.equal(sanitized, expected);
    assert.equal(path.basename(sanitized), sanitized);
    assert.equal(sanitized.startsWith('.'), false);
    assert.doesNotMatch(sanitized, /\0|[/\\]/);
  }
});

test('sanitizeFilename is idempotent for already sanitized values', () => {
  const value = 'Invoice 123_ACME-CO(approved).pdf';

  assert.equal(sanitizeFilename(value), value);
  assert.equal(sanitizeFilename(sanitizeFilename(value)), value);
});

test('sanitizePathForShell escapes double-quote shell expansions and removes newlines', () => {
  const sanitized = sanitizePathForShell('/tmp/invoice "$HOME" `id` !bang\n.pdf');

  assert.equal(sanitized, '/tmp/invoice \\"\\$HOME\\" \\`id\\` \\!bang.pdf');
  assert.doesNotMatch(sanitized, /\n|\r/);
});

test('sanitizePathFilename sanitizes only the filename component', () => {
  const sanitized = sanitizePathFilename('/safe/root/invoice;`bad`.pdf');

  assert.equal(sanitized, '/safe/root/invoicebad.pdf');
});
