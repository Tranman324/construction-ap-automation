'use strict';
/**
 * Attachment junk filtering — content-hash cache, signature/logo pre-filters,
 * and the persistent skip log.
 *
 * Email signature images (image001.png, footers, logos, banners) leak past the
 * blunt 15KB size floor, burn Haiku vision calls, and land in the review queue
 * as classification='other'. This service implements four defense layers:
 *
 *   1. junk_attachments — sha256 fingerprints of known-junk files. Populated
 *      by manual discards of 'other' images, auto-discards, and the one-off
 *      seed script. Checked in the pipeline BEFORE any classification work.
 *   2. Smarter pre-filters — signature filename patterns and ImageMagick
 *      dimension heuristics (banner shape / tiny logo), applied to all images
 *      regardless of inline flag.
 *   3. attachment_skip_log — every skip (all layers) writes an audit row so
 *      nothing silently vanishes; rescue endpoints live in routes/pipeline.js.
 *   4. Auto-discard — high-confidence 'other' images are still inserted as
 *      documents but arrive pre-discarded, and their hash is junk-cached.
 *
 * All DB writes here are best-effort: filtering/logging must NEVER fail the
 * pipeline or a discard transaction. Callers pass no client — this module
 * deliberately uses the global pool so a failed insert cannot abort an open
 * ingestion or discard transaction.
 *
 * See docs/specs/invoices/ATTACHMENT-FILTERING.md.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pool = require('../../../lib/db');
const logger = require('../../../lib/logger');
const { detectFileType } = require('./file-types');
const { sanitizePathForShell } = require('./sanitize');

const junkLogger = logger.child({ component: 'junk-filter' });

// Filenames matching these are Office/email signature artifacts, not documents.
// Real receipts arrive as IMG_1234.jpg / scans / PDFs; they don't use these names.
const SIGNATURE_BASENAME_RE = /^image0*\d+\.(png|jpe?g|gif)$/i;
const SIGNATURE_KEYWORDS = ['signature', 'logo', 'footer', 'banner'];
const SIGNATURE_NAME_MAX_BYTES = 250000; // 250KB — above this, benefit of the doubt

// Dimension heuristics (footer banner shape / tiny logo)
const BANNER_MIN_ASPECT_RATIO = 3;   // width/height
const BANNER_MAX_HEIGHT = 400;
const TINY_LOGO_MAX_DIMENSION = 300; // both width and height under this → logo
const SMALL_IMAGE_MIN_BYTES = 15000;

// Layer 4: 'other'-classified images at/above this confidence auto-discard.
const AUTO_DISCARD_OTHER_CONFIDENCE = 0.85;

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function sha256Buffer(buf) {
  try {
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

// ── Layer 2: pre-filters (pure/injectable — unit tested) ─────────────────────

/**
 * Signature-name pattern check. Returns a machine-readable skip reason string
 * or null. Only meaningful for image files — caller gates on isImage.
 */
function checkSignatureNamePattern(fileName, sizeBytes) {
  if (!fileName) return null;
  if (typeof sizeBytes === 'number' && sizeBytes >= SIGNATURE_NAME_MAX_BYTES) return null;
  const base = path.basename(fileName);
  const lower = base.toLowerCase();
  const matches = SIGNATURE_BASENAME_RE.test(base)
    || SIGNATURE_KEYWORDS.some(k => lower.includes(k));
  if (!matches) return null;
  return `signature-name-pattern (${base}, ${sizeBytes} bytes)`;
}

function defaultIdentify(filePath) {
  const safePath = sanitizePathForShell(filePath);
  const out = execSync(`identify -format "%w %h" "${safePath}"[0] 2>/dev/null`, { timeout: 10000 })
    .toString().trim();
  const [w, h] = out.split(/\s+/).map(n => parseInt(n, 10));
  return { width: w, height: h };
}

/**
 * Dimension heuristic via ImageMagick identify. Returns a machine-readable
 * skip reason or null. Fail-open: any identify failure returns null so the
 * file falls through to normal classification. `identifyFn` is injectable
 * for tests.
 */
function checkImageDimensions(filePath, identifyFn = defaultIdentify) {
  try {
    const { width, height } = identifyFn(filePath);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if ((width / height) > BANNER_MIN_ASPECT_RATIO && height < BANNER_MAX_HEIGHT) {
      return `banner-dimensions (${width}x${height})`;
    }
    if (width < TINY_LOGO_MAX_DIMENSION && height < TINY_LOGO_MAX_DIMENSION) {
      return `tiny-logo-dimensions (${width}x${height})`;
    }
    return null;
  } catch {
    return null; // fail-open
  }
}

/** Cheap image checks shared by intake routing and direct classification. */
function preFilterRealFile(filePath, fileName = path.basename(filePath || '')) {
  try {
    const fileType = detectFileType(filePath, fileName);
    const stats = fs.statSync(filePath);
    if (fileType.isImage && ['.jpg', '.jpeg', '.png', '.gif'].includes(fileType.ext) && stats.size < SMALL_IMAGE_MIN_BYTES) {
      return `Too small (${stats.size} bytes) — likely email signature image`;
    }
    if (!fileType.isImage) return null;
    return checkSignatureNamePattern(fileName, stats.size) || checkImageDimensions(filePath);
  } catch {
    return null;
  }
}

// ── Layer 1: junk fingerprint cache ──────────────────────────────────────────

/**
 * Hash a file and look it up in junk_attachments. On a hit, increments
 * hit_count / last_hit_at and returns { sha256, reason, hitCount } where
 * hitCount is the POST-increment count (1 = first ever hit). On a miss
 * returns { sha256, reason: null }. Best-effort: DB errors behave like a miss.
 */
async function evaluateJunkHash(filePath, db = pool) {
  const sha256 = sha256File(filePath);
  if (!sha256) return { sha256: null, reason: null, hitCount: null };
  try {
    const { rows } = await db.query(
      `UPDATE junk_attachments
       SET hit_count = COALESCE(hit_count, 0) + 1, last_hit_at = NOW()
       WHERE sha256 = $1
       RETURNING file_name, reason, source, hit_count`,
      [sha256]
    );
    if (rows.length === 0) return { sha256, reason: null, hitCount: null };
    const hit = rows[0];
    return {
      sha256,
      reason: `junk-hash-match (${hit.source}: ${hit.reason || hit.file_name || sha256.slice(0, 12)})`,
      hitCount: hit.hit_count != null ? Number(hit.hit_count) : null,
    };
  } catch (e) {
    junkLogger.warn({ err: e }, 'junk hash lookup failed (fail-open)');
    return { sha256, reason: null, hitCount: null };
  }
}

/** Insert a junk fingerprint (idempotent). Best-effort. */
async function insertJunkHash({ sha256, fileName, fileSizeBytes, reason, source }, db = pool) {
  if (!sha256) return false;
  try {
    await db.query(
      `INSERT INTO junk_attachments (sha256, file_name, file_size_bytes, reason, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sha256) DO NOTHING`,
      [sha256, fileName || null, fileSizeBytes ?? null, reason || null, source || null]
    );
    return true;
  } catch (e) {
    junkLogger.warn({ err: e, sha256 }, 'junk hash insert failed (non-fatal)');
    return false;
  }
}

async function removeJunkHash(sha256, db = pool) {
  const result = await db.query('DELETE FROM junk_attachments WHERE sha256 = $1', [sha256]);
  return result.rowCount > 0;
}

// ── Trash-tab exposure (documents.discard_source) ────────────────────────────

// discard_source values written by the filtering layers. Frontend renders a
// source pill; NULL/legacy rows are treated as 'manual'.
const FILTER_DISCARD_SOURCES = new Set(['rule-filter', 'junk-hash', 'auto-ai']);

/** True when a discarded document row with this content hash already exists. */
async function hasDiscardedDocWithHash(sha256, db = pool) {
  if (!sha256) return false;
  try {
    const { rows } = await db.query(
      "SELECT 1 FROM documents WHERE sha256 = $1 AND status = 'discarded' LIMIT 1",
      [sha256]
    );
    return rows.length > 0;
  } catch (e) {
    // Fail toward "already exists" — better to miss one Trash row than to
    // spam a new pre-discarded row on every repeat of the same footer.
    junkLogger.warn({ err: e, sha256 }, 'trash-row dedupe check failed (treating as existing)');
    return true;
  }
}

/**
 * Should this filtered attachment get a pre-discarded Trash row?
 * First sight only: no row without a hash; none when the junk cache has
 * already fired for this hash before (post-increment hitCount > 1); none when
 * a discarded document row with the same hash already exists.
 */
async function shouldCreateTrashRow({ sha256, hitCount = null }, db = pool) {
  if (!sha256) return false;
  if (typeof hitCount === 'number' && hitCount > 1) return false;
  return !(await hasDiscardedDocWithHash(sha256, db));
}

/**
 * Restore hook (Trash tab "restore" action = rescue). For docs discarded by a
 * filtering layer, remove the content hash from junk_attachments so a
 * re-forwarded copy reprocesses normally. Best-effort, pool-based — must
 * never fail the restore. Returns { applies, junkRemoved }.
 */
async function rescueOnRestore(row, { db = pool } = {}) {
  // Filter-sourced discards get the full rescue flow; manual discards may
  // still have junk-cached their hash (maybeCacheJunkFromDiscard), so always
  // attempt hash removal — restoring means "this is not junk".
  const applies = Boolean(row && FILTER_DISCARD_SOURCES.has(row.discard_source));
  try {
    if (!row) return { applies, junkRemoved: false };
    const sha256 = row.sha256 || (row.file_path ? sha256File(row.file_path) : null);
    if (!sha256) return { applies, junkRemoved: false };
    const junkRemoved = await removeJunkHash(sha256, db);
    if (junkRemoved) {
      junkLogger.info({ documentId: row.id, sha256 }, 'junk hash removed on restore (rescue)');
    }
    return { applies, junkRemoved };
  } catch (e) {
    junkLogger.warn({ err: e, documentId: row?.id }, 'restore rescue hook failed (non-fatal)');
    return { applies, junkRemoved: false };
  }
}

// ── Layer 3: persistent skip log ─────────────────────────────────────────────

// Skip-log rows are an audit trail, not history of record — prune after 90 days.
const SKIP_LOG_RETENTION_DAYS = 90;

/** Delete skip-log rows past retention. Best-effort — never throws. */
async function purgeOldSkips(db = pool) {
  try {
    const result = await db.query(
      `DELETE FROM attachment_skip_log WHERE skipped_at < NOW() - make_interval(days => $1)`,
      [SKIP_LOG_RETENTION_DAYS]
    );
    if (result.rowCount > 0) {
      junkLogger.info({ purged: result.rowCount }, 'skip-log retention purge');
    }
    return result.rowCount;
  } catch (e) {
    junkLogger.warn({ err: e }, 'skip-log retention purge failed (non-fatal)');
    return 0;
  }
}

/** Record a skipped attachment. Best-effort — never throws. */
async function logSkip({ fileName, fileSizeBytes, sha256, reason, emailFrom, emailSubject, emailMessageId }, db = pool) {
  try {
    await db.query(
      `INSERT INTO attachment_skip_log
         (file_name, file_size_bytes, sha256, reason, email_from, email_subject, email_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fileName || null, fileSizeBytes ?? null, sha256 || null, reason || null,
        emailFrom || null, emailSubject || null, emailMessageId || null]
    );
  } catch (e) {
    junkLogger.warn({ err: e, fileName }, 'skip log write failed (non-fatal)');
  }
}

async function listSkips({ limit, offset }, db = pool) {
  const { rows } = await db.query(
    `SELECT s.id, s.file_name, s.file_size_bytes, s.sha256, s.reason,
            s.email_from, s.email_subject, s.email_message_id, s.skipped_at,
            (j.sha256 IS NOT NULL) AS junk_cached
     FROM attachment_skip_log s
     LEFT JOIN junk_attachments j ON j.sha256 = s.sha256
     ORDER BY s.skipped_at DESC, s.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

/**
 * Rescue a skipped attachment: remove its hash from junk_attachments (if
 * present) so a re-forwarded email reprocesses normally, and return the skip
 * row so a caller can reprocess it.
 */
async function rescueSkip(id, db = pool) {
  const { rows } = await db.query('SELECT * FROM attachment_skip_log WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const skip = rows[0];
  let junkRemoved = false;
  if (skip.sha256) {
    junkRemoved = await removeJunkHash(skip.sha256, db);
  }
  return { skip, junkRemoved };
}

// ── Layer 4: auto-discard + discard hook ─────────────────────────────────────

/** Pure decision: should a classified 'other' doc be inserted pre-discarded? */
function shouldAutoDiscardOther({ classification, confidence, isImage }) {
  return classification === 'other'
    && typeof confidence === 'number'
    && confidence >= AUTO_DISCARD_OTHER_CONFIDENCE
    && isImage === true;
}

/**
 * Discard-flow hook: when a user discards an 'other'-classified IMAGE, cache
 * its content hash so future copies are skipped pre-classification. PDFs and
 * discarded invoices/pay-apps/statements are deliberately NOT cached —
 * discards there usually mean "duplicate", not "junk".
 *
 * Best-effort and pool-based on purpose: callers invoke this from inside
 * discard transactions, and a failed insert must not abort them.
 */
async function maybeCacheJunkFromDiscard(row, { db = pool, detect = detectFileType } = {}) {
  try {
    if (!row || row.classification !== 'other' || !row.file_path) return false;
    const fileType = detect(row.file_path, row.file_name);
    if (!fileType.isImage) return false;
    const sha256 = sha256File(row.file_path);
    if (!sha256) return false;
    const inserted = await insertJunkHash({
      sha256,
      fileName: row.file_name,
      fileSizeBytes: row.file_size_bytes,
      reason: `manual discard of ${row.id}`,
      source: 'manual-discard',
    }, db);
    if (inserted) junkLogger.info({ documentId: row.id, sha256 }, 'junk hash cached from manual discard');
    return inserted;
  } catch (e) {
    junkLogger.warn({ err: e, documentId: row?.id }, 'discard junk-cache hook failed (non-fatal)');
    return false;
  }
}

module.exports = {
  AUTO_DISCARD_OTHER_CONFIDENCE,
  FILTER_DISCARD_SOURCES,
  SIGNATURE_NAME_MAX_BYTES,
  checkImageDimensions,
  checkSignatureNamePattern,
  evaluateJunkHash,
  hasDiscardedDocWithHash,
  insertJunkHash,
  listSkips,
  logSkip,
  purgeOldSkips,
  maybeCacheJunkFromDiscard,
  preFilterRealFile,
  removeJunkHash,
  rescueOnRestore,
  rescueSkip,
  shouldCreateTrashRow,
  sha256Buffer,
  sha256File,
  shouldAutoDiscardOther,
};
