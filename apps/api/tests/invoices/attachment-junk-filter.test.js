'use strict';

// Attachment junk filtering (2026-08-05): signature/logo pre-filters, the
// junk_attachments content-hash cache, the attachment_skip_log audit trail,
// and the auto-discard decision for high-confidence 'other' images.
// See docs/specs/invoices/ATTACHMENT-FILTERING.md.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  FILTER_DISCARD_SOURCES,
  checkImageDimensions,
  checkSignatureNamePattern,
  evaluateJunkHash,
  logSkip,
  maybeCacheJunkFromDiscard,
  rescueOnRestore,
  sha256File,
  shouldAutoDiscardOther,
  shouldCreateTrashRow,
} = require('../../modules/invoices/services/junkFilterService');

const serviceRoot = path.resolve(__dirname, '..', '..', 'modules', 'invoices', 'services');

function readService(name) {
  return fs.readFileSync(path.join(serviceRoot, name), 'utf8');
}

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
const PDF_MAGIC = Buffer.from('255044462d312e34', 'hex');

function tmpFile(name, contents) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'junk-test-')), name);
  fs.writeFileSync(p, contents);
  return p;
}

function recordingDb(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

function failingDb() {
  return { query: async () => { throw new Error('db down'); } };
}

// ── Signature-name pattern filter ────────────────────────────────────────────

test('checkSignatureNamePattern matches Office inline artifact names (image001.png)', () => {
  assert.match(checkSignatureNamePattern('image001.png', 39463), /^signature-name-pattern \(image001\.png, 39463 bytes\)$/);
  assert.ok(checkSignatureNamePattern('image0005.jpeg', 20000));
  assert.ok(checkSignatureNamePattern('image12.gif', 16000));
});

test('checkSignatureNamePattern matches signature/logo/footer/banner keywords case-insensitively', () => {
  assert.ok(checkSignatureNamePattern('EmailSignatureFooter2024.png', 199195));
  assert.ok(checkSignatureNamePattern('company-LOGO.jpg', 50000));
  assert.ok(checkSignatureNamePattern('C2_signature_v3.png', 25000));
  assert.ok(checkSignatureNamePattern('spring-Banner.gif', 120000));
});

test('checkSignatureNamePattern passes real receipt/scan names through', () => {
  assert.equal(checkSignatureNamePattern('IMG_1234.jpg', 45000), null);
  assert.equal(checkSignatureNamePattern('scan_receipt_homedepot.png', 90000), null);
  assert.equal(checkSignatureNamePattern('image.png', 30000), null); // no digits, no keyword
});

test('checkSignatureNamePattern gives files >= 250KB the benefit of the doubt', () => {
  assert.equal(checkSignatureNamePattern('image001.png', 250000), null);
  assert.equal(checkSignatureNamePattern('logo-page.png', 400000), null);
});

// ── Dimension heuristic ──────────────────────────────────────────────────────

test('checkImageDimensions flags footer banner shape (ratio > 3 and height < 400)', () => {
  const reason = checkImageDimensions('/tmp/x.png', () => ({ width: 1200, height: 180 }));
  assert.equal(reason, 'banner-dimensions (1200x180)');
});

test('checkImageDimensions flags tiny logos (both dimensions < 300)', () => {
  const reason = checkImageDimensions('/tmp/x.png', () => ({ width: 200, height: 250 }));
  assert.equal(reason, 'tiny-logo-dimensions (200x250)');
});

test('checkImageDimensions passes document-shaped images through', () => {
  assert.equal(checkImageDimensions('/tmp/x.png', () => ({ width: 1000, height: 1400 })), null);
  // Wide but tall enough — not a banner
  assert.equal(checkImageDimensions('/tmp/x.png', () => ({ width: 2000, height: 500 })), null);
});

test('checkImageDimensions fails open on identify errors and bad output', () => {
  assert.equal(checkImageDimensions('/tmp/x.png', () => { throw new Error('identify exploded'); }), null);
  assert.equal(checkImageDimensions('/tmp/x.png', () => ({ width: NaN, height: NaN })), null);
  assert.equal(checkImageDimensions('/tmp/x.png', () => ({ width: 0, height: 0 })), null);
});

// ── Junk-hash skip path ──────────────────────────────────────────────────────

test('evaluateJunkHash returns a junk-hash-match reason and increments the hit counter on a hit', async () => {
  const filePath = tmpFile('footer.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(64)]));
  const db = recordingDb([{ file_name: 'footer.png', reason: 'seeded', source: 'seed' }]);
  const result = await evaluateJunkHash(filePath, db);
  assert.equal(result.sha256, sha256File(filePath));
  assert.match(result.reason, /^junk-hash-match \(seed: seeded\)$/);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /UPDATE junk_attachments/);
  assert.match(db.calls[0].sql, /hit_count/);
  assert.deepEqual(db.calls[0].params, [result.sha256]);
});

test('evaluateJunkHash misses cleanly for unknown hashes', async () => {
  const filePath = tmpFile('receipt.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(64, 1)]));
  const result = await evaluateJunkHash(filePath, recordingDb([]));
  assert.equal(result.reason, null);
  assert.ok(result.sha256);
});

test('evaluateJunkHash fails open when the DB or file is unavailable', async () => {
  const filePath = tmpFile('receipt.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(64, 2)]));
  const dbFail = await evaluateJunkHash(filePath, failingDb());
  assert.equal(dbFail.reason, null);
  assert.ok(dbFail.sha256);

  const fileFail = await evaluateJunkHash('/nonexistent/nope.png', recordingDb([]));
  assert.deepEqual(fileFail, { sha256: null, reason: null, hitCount: null });
});

// ── Auto-discard decision ────────────────────────────────────────────────────

test('shouldAutoDiscardOther requires other + confidence >= 0.85 + image', () => {
  assert.equal(shouldAutoDiscardOther({ classification: 'other', confidence: 0.9, isImage: true }), true);
  assert.equal(shouldAutoDiscardOther({ classification: 'other', confidence: 0.85, isImage: true }), true);
  assert.equal(shouldAutoDiscardOther({ classification: 'other', confidence: 0.84, isImage: true }), false);
  assert.equal(shouldAutoDiscardOther({ classification: 'other', confidence: 0.95, isImage: false }), false); // PDFs stay pending
  assert.equal(shouldAutoDiscardOther({ classification: 'invoice', confidence: 0.95, isImage: true }), false);
  assert.equal(shouldAutoDiscardOther({ classification: 'other', confidence: null, isImage: true }), false);
});

// ── Discard hook ─────────────────────────────────────────────────────────────

test('maybeCacheJunkFromDiscard caches the hash for a discarded other-classified image', async () => {
  const filePath = tmpFile('image001.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(128, 3)]));
  const db = recordingDb([]);
  const row = { id: 'doc-1', classification: 'other', file_path: filePath, file_name: 'image001.png', file_size_bytes: 136 };
  assert.equal(await maybeCacheJunkFromDiscard(row, { db }), true);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO junk_attachments/);
  assert.equal(db.calls[0].params[0], sha256File(filePath));
  assert.equal(db.calls[0].params[4], 'manual-discard');
});

test('maybeCacheJunkFromDiscard ignores non-other classifications (duplicate discards are not junk)', async () => {
  const filePath = tmpFile('invoice.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(128, 4)]));
  const db = recordingDb([]);
  for (const classification of ['invoice', 'pay-application', 'statement', 'receipt']) {
    assert.equal(await maybeCacheJunkFromDiscard({ id: 'doc-2', classification, file_path: filePath, file_name: 'invoice.png' }, { db }), false);
  }
  assert.equal(db.calls.length, 0);
});

test('maybeCacheJunkFromDiscard ignores PDFs even when classified other', async () => {
  const filePath = tmpFile('doc.pdf', Buffer.concat([PDF_MAGIC, Buffer.alloc(128)]));
  const db = recordingDb([]);
  assert.equal(await maybeCacheJunkFromDiscard({ id: 'doc-3', classification: 'other', file_path: filePath, file_name: 'doc.pdf' }, { db }), false);
  assert.equal(db.calls.length, 0);
});

test('maybeCacheJunkFromDiscard never throws (missing file, missing row, dead DB)', async () => {
  assert.equal(await maybeCacheJunkFromDiscard(null, { db: recordingDb([]) }), false);
  assert.equal(await maybeCacheJunkFromDiscard({ id: 'doc-4', classification: 'other', file_path: null }, { db: recordingDb([]) }), false);
  assert.equal(await maybeCacheJunkFromDiscard(
    { id: 'doc-5', classification: 'other', file_path: '/nonexistent/gone.png', file_name: 'gone.png' },
    { db: recordingDb([]) }
  ), false);
  const filePath = tmpFile('sig.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(64, 5)]));
  assert.equal(await maybeCacheJunkFromDiscard(
    { id: 'doc-6', classification: 'other', file_path: filePath, file_name: 'sig.png' },
    { db: failingDb() }
  ), false);
});

// ── Skip log ─────────────────────────────────────────────────────────────────

test('logSkip writes a row and never throws on DB failure', async () => {
  const db = recordingDb([]);
  await logSkip({
    fileName: 'image001.png',
    fileSizeBytes: 39463,
    sha256: 'abc',
    reason: 'signature-name-pattern (image001.png, 39463 bytes)',
    emailFrom: 'a@b.example',
    emailSubject: 'FW: Invoice',
    emailMessageId: 'msg-1',
  }, db);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO attachment_skip_log/);
  assert.deepEqual(db.calls[0].params, [
    'image001.png', 39463, 'abc',
    'signature-name-pattern (image001.png, 39463 bytes)',
    'a@b.example', 'FW: Invoice', 'msg-1',
  ]);

  await assert.doesNotReject(logSkip({ fileName: 'x.png', reason: 'r' }, failingDb()));
});

// ── Trash-tab exposure: first hit creates a pre-discarded row ────────────────

test('evaluateJunkHash surfaces the post-increment hit count for first-hit detection', async () => {
  const filePath = tmpFile('footer2.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(64, 6)]));
  const db = recordingDb([{ file_name: 'footer2.png', reason: 'seeded', source: 'seed', hit_count: 1 }]);
  const result = await evaluateJunkHash(filePath, db);
  assert.equal(result.hitCount, 1);
  assert.match(db.calls[0].sql, /RETURNING file_name, reason, source, hit_count/);
});

test('shouldCreateTrashRow allows only the first sighting of a hash', async () => {
  // First junk-hash hit, no existing discarded doc with this hash → create.
  assert.equal(await shouldCreateTrashRow({ sha256: 'abc', hitCount: 1 }, recordingDb([])), true);
  // Rule-filter path (no cache entry, hitCount null) → create on first sight.
  assert.equal(await shouldCreateTrashRow({ sha256: 'abc' }, recordingDb([])), true);
  // Repeat cache hit → log-only.
  assert.equal(await shouldCreateTrashRow({ sha256: 'abc', hitCount: 2 }, recordingDb([])), false);
  // A discarded doc row with this hash already exists → log-only.
  assert.equal(await shouldCreateTrashRow({ sha256: 'abc', hitCount: 1 }, recordingDb([{ 1: 1 }])), false);
  // No hash → never create.
  assert.equal(await shouldCreateTrashRow({ sha256: null }, recordingDb([])), false);
  // Dedupe-check DB failure fails toward "exists" (no duplicate trash spam).
  assert.equal(await shouldCreateTrashRow({ sha256: 'abc', hitCount: 1 }, failingDb()), false);
});

test('the trash-row dedupe check queries discarded documents by content hash', async () => {
  const db = recordingDb([]);
  await shouldCreateTrashRow({ sha256: 'abc', hitCount: 1 }, db);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM documents WHERE sha256 = \$1 AND status = 'discarded'/);
  assert.deepEqual(db.calls[0].params, ['abc']);
});

test('pipeline wires filter skips into pre-discarded trash rows with the right sources', () => {
  const source = readService('pipeline.js');
  // Junk-hash and rule-filter paths gate on shouldCreateTrashRow and tag their source.
  assert.match(source, /shouldCreateTrashRow\(\{ sha256: fileSha256, hitCount: junkCheck\.hitCount \}\)[\s\S]{0,600}discardSource: 'junk-hash'/);
  assert.match(source, /shouldCreateTrashRow\(\{ sha256: fileSha256 \}\)[\s\S]{0,600}discardSource: 'rule-filter'/);
  // Layer-4 auto-discard tags 'auto-ai' and carries the hash for restore/rescue.
  assert.match(source, /queueEntry\.discardSource = 'auto-ai';\s*\n\s*queueEntry\.sha256 = fileSha256/);
  // insertDocument persists the provenance columns.
  assert.match(source, /discard_source, sha256, discarded_at, discarded_by/);
  // The inline-download skip in downloadAttachments stays log-only (no trash rows there).
  const inlineSkip = source.slice(source.indexOf('inline-image ('), source.indexOf('inline-image (') + 800);
  assert.doesNotMatch(inlineSkip, /insertFilteredTrashDocument/);
});

// ── discard_source taxonomy on the human discard paths ───────────────────────

test('human discard paths stamp discard_source = manual', () => {
  assert.match(readService('documentDiscardService.js'), /discard_source = 'manual'/);
  assert.match(readService('bulkActionService.js'), /discard_source = 'manual'/);
});

// ── Restore = rescue ─────────────────────────────────────────────────────────

test('rescueOnRestore un-junks the hash for filter AND manual discards', async () => {
  assert.deepEqual([...FILTER_DISCARD_SOURCES].sort(), ['auto-ai', 'junk-hash', 'rule-filter']);

  // Manual / legacy discards: applies=false (no special restore flow) but the
  // hash is STILL removed — a manually-discarded 'other' image may have been
  // junk-cached, and restoring it means "this is not junk".
  for (const discard_source of ['manual', null, undefined]) {
    const db = recordingDb([{ 1: 1 }]);
    const result = await rescueOnRestore({ id: 'doc-m', discard_source, sha256: 'abc' }, { db });
    assert.deepEqual(result, { applies: false, junkRemoved: true });
    assert.match(db.calls[0].sql, /DELETE FROM junk_attachments WHERE sha256 = \$1/);
  }

  // Filter-discarded doc with a stored hash → DELETE FROM junk_attachments.
  for (const discard_source of ['junk-hash', 'rule-filter', 'auto-ai']) {
    const db = recordingDb([{ 1: 1 }]);
    const result = await rescueOnRestore({ id: 'doc-f', discard_source, sha256: 'abc' }, { db });
    assert.deepEqual(result, { applies: true, junkRemoved: true });
    assert.match(db.calls[0].sql, /DELETE FROM junk_attachments WHERE sha256 = \$1/);
    assert.deepEqual(db.calls[0].params, ['abc']);
  }
});

test('rescueOnRestore falls back to hashing the stored file and never throws', async () => {
  const filePath = tmpFile('cached.png', Buffer.concat([PNG_MAGIC, Buffer.alloc(64, 7)]));
  const db = recordingDb([{ 1: 1 }]);
  const result = await rescueOnRestore({ id: 'doc-7', discard_source: 'auto-ai', sha256: null, file_path: filePath }, { db });
  assert.deepEqual(result, { applies: true, junkRemoved: true });
  assert.deepEqual(db.calls[0].params, [sha256File(filePath)]);

  // No hash source at all → applies but nothing removed.
  assert.deepEqual(
    await rescueOnRestore({ id: 'doc-8', discard_source: 'junk-hash', sha256: null, file_path: null }, { db: recordingDb([]) }),
    { applies: true, junkRemoved: false }
  );
  // Dead DB → best-effort, no throw.
  assert.deepEqual(
    await rescueOnRestore({ id: 'doc-9', discard_source: 'junk-hash', sha256: 'abc' }, { db: failingDb() }),
    { applies: true, junkRemoved: false }
  );
});

test('the undiscard path restores filter-discarded docs, clears discard_source, and rescues', () => {
  const source = readService('invoiceStatusService.js');
  // Filter-discarded rows (no undo record) get a real restore instead of a 422.
  assert.match(source, /FILTER_DISCARD_SOURCES\.has\(row\.discard_source\)/);
  // Both restore paths clear the pill and invoke the rescue hook.
  assert.match(source, /discard_source = NULL,\s*\n\s*updated_at = NOW\(\)[\s\S]{0,400}rescueOnRestore\(row\)/);
  const nullClears = source.match(/discard_source = NULL/g) || [];
  assert.equal(nullClears.length, 2);
});

// ── API exposure ─────────────────────────────────────────────────────────────

test('document serializer and list columns expose discardSource for the trash pill', () => {
  assert.match(readService('supabase.js'), /discardSource: r\.discard_source \|\| null/);
  assert.match(readService('invoiceCollectionService.js'), /discarded_at, discarded_by, discard_source,/);
});
