'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { refCode, stampSubjectRefTag, extractSubjectRefTag, buildBodyToken, extractBodyToken } = require('../../modules/invoices/services/refTag');

describe('refCode', () => {
  it('extracts the 4-char suffix from a full document ID', () => {
    assert.equal(refCode('doc-1789775848361-mi6h'), 'mi6h');
  });

  it('extracts from a short ID', () => {
    assert.equal(refCode('doc-123-ab9z'), 'ab9z');
  });

  it('returns the full string when no 4-char suffix exists', () => {
    assert.equal(refCode('x'), 'x');
  });
});

describe('stampSubjectRefTag', () => {
  it('appends [Ref:suffix] using the 4-char code', () => {
    assert.equal(stampSubjectRefTag('RE: Test Invoice', 'doc-1789775848361-mi6h'), 'RE: Test Invoice [Ref:mi6h]');
  });

  it('is idempotent — does not double-stamp', () => {
    const once = stampSubjectRefTag('RE: Invoice', 'doc-123-ab9z');
    assert.equal(stampSubjectRefTag(once, 'doc-123-ab9z'), once);
  });

  it('does not stamp over an existing different ref tag', () => {
    const original = 'RE: Invoice [Ref:xyz9]';
    assert.equal(stampSubjectRefTag(original, 'doc-123-ab9z'), original);
  });
});

describe('extractSubjectRefTag', () => {
  it('extracts a 4-char code from a ref-tagged subject', () => {
    assert.equal(extractSubjectRefTag('RE: Test Invoice [Ref:mi6h]'), 'mi6h');
  });

  it('is case-insensitive', () => {
    assert.equal(extractSubjectRefTag('RE: Invoice [ref:AB9Z]'), 'AB9Z');
  });

  it('returns null when no ref tag is present', () => {
    assert.equal(extractSubjectRefTag('RE: Test Invoice'), null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(extractSubjectRefTag(null), null);
    assert.equal(extractSubjectRefTag(undefined), null);
  });

  it('handles ref tag with space after colon', () => {
    assert.equal(extractSubjectRefTag('RE: Invoice [Ref: mi6h]'), 'mi6h');
  });

  it('does not match codes shorter or longer than 4 chars', () => {
    assert.equal(extractSubjectRefTag('[Ref:abc]'), null);
    assert.equal(extractSubjectRefTag('[Ref:abcde]'), null);
  });
});

describe('buildBodyToken', () => {
  it('uses the 4-char code in the HTML comment', () => {
    const html = buildBodyToken('doc-1789775848361-mi6h');
    assert.ok(html.includes('<!-- toolbox-ref:mi6h -->'));
  });

  it('uses the 4-char code in the visible Ref: footer', () => {
    const html = buildBodyToken('doc-1789775848361-mi6h');
    assert.ok(html.includes('Ref: mi6h'));
  });

  it('does not include the full document ID', () => {
    const html = buildBodyToken('doc-1789775848361-mi6h');
    assert.ok(!html.includes('doc-1789775848361-mi6h'));
  });
});

describe('extractBodyToken', () => {
  it('extracts from an HTML comment', () => {
    const body = '<p>Thanks</p><!-- toolbox-ref:mi6h --><p>Footer</p>';
    assert.equal(extractBodyToken(body), 'mi6h');
  });

  it('extracts from a visible Ref: line when no comment exists', () => {
    const body = '<p>Thanks</p><p style="font-size:10px">Ref: mi6h</p>';
    assert.equal(extractBodyToken(body), 'mi6h');
  });

  it('prefers the HTML comment over the footer', () => {
    const body = '<!-- toolbox-ref:ab9z --><p>Ref: xy8w</p>';
    assert.equal(extractBodyToken(body), 'ab9z');
  });

  it('is case-insensitive', () => {
    assert.equal(extractBodyToken('<!-- TOOLBOX-REF:Mi6H -->'), 'Mi6H');
    assert.equal(extractBodyToken('REF: ab9z'), 'ab9z');
  });

  it('returns null for no token', () => {
    assert.equal(extractBodyToken('<p>Just a normal email</p>'), null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(extractBodyToken(null), null);
    assert.equal(extractBodyToken(undefined), null);
  });

  it('extracts from a quoted reply body', () => {
    const body = `<p>My reply text</p>
      <blockquote>
        <p>Original message</p>
        <!-- toolbox-ref:mi6h -->
        <p style="font-size:10px">Ref: mi6h</p>
      </blockquote>`;
    assert.equal(extractBodyToken(body), 'mi6h');
  });

  it('does not match codes shorter or longer than 4 chars', () => {
    assert.equal(extractBodyToken('<!-- toolbox-ref:abc -->'), null);
    assert.equal(extractBodyToken('<!-- toolbox-ref:abcde -->'), null);
  });
});
