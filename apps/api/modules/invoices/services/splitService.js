'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pool } = require('./supabase');
const { extractPages } = require('./pdf-split');
const { FILES_DIR } = require('../../../config');
const { emitLegacyInvoiceAuditEvent } = require('../../../lib/auditEvents');
const logger = require('../../../lib/logger');
const { maybeCacheJunkFromDiscard } = require('./junkFilterService');

const SPLIT_WORKER_LOG = process.env.SPLIT_WORKER_LOG || '/var/log/toolbox/split-worker.log';
const STUCK_SPLIT_MINUTES = 10;

// Spawn the detached split-worker for the given child docs. Output goes to a
// log file — never 'ignore' (a silently dying worker previously left children
// stuck in split-processing with zero trace).
function spawnSplitWorker(childIds, { onExit } = {}) {
  const workerPath = path.join(__dirname, '..', 'scripts', 'split-worker.js');
  const logFd = fs.openSync(SPLIT_WORKER_LOG, 'a');
  fs.writeSync(logFd, `\n[${new Date().toISOString()}] spawning split-worker for: ${childIds.join(', ')}\n`);
  const child = spawn('node', [workerPath, ...childIds], {
    cwd: path.join(__dirname, '..', '..'),
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  if (onExit) child.on('exit', onExit);
  child.unref();
  fs.closeSync(logFd);
}

// Recovery sweep: re-run the worker for children stuck in split-processing
// (worker died before finishing — e.g. spawn-time DB pool saturation).
// Runs at server startup and on an interval. The nightly purge job remains
// the terminal backstop (flips >15-min stuck rows to error), so a child that
// keeps failing here doesn't retry forever.
const retryInFlight = new Set();
async function recoverStuckSplitChildren() {
  const { rows } = await pool.query(
    `SELECT id FROM documents
     WHERE status = 'split-processing'
       AND updated_at < NOW() - INTERVAL '${STUCK_SPLIT_MINUTES} minutes'
     ORDER BY updated_at ASC`
  );
  const ids = rows.map((r) => r.id).filter((id) => !retryInFlight.has(id));
  if (ids.length === 0) return { retried: [] };

  for (const id of ids) retryInFlight.add(id);
  logger.warn({
    operation: 'splits.recover_stuck',
    context: { childIds: ids },
  }, `Re-spawning split-worker for ${ids.length} stuck split-processing child(ren)`);
  spawnSplitWorker(ids, {
    onExit: () => { for (const id of ids) retryInFlight.delete(id); },
  });
  return { retried: ids };
}

function newDocumentId() {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function splitQueueOrderBy(sort, sortDir) {
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
  if (sort === 'pages') return `COALESCE((split_suggestion->>'pageCount')::int, 0) ${direction}, id ${direction}`;
  if (sort === 'vendor') return `email_from ${direction} NULLS LAST, id ${direction}`;
  return `queued_at ${direction}, id ${direction}`;
}

async function listSplitQueue({ sort, sortDir, limit, offset }) {
  const orderBy = splitQueueOrderBy(sort, sortDir);
  const [count, data] = await Promise.all([
    pool.query("SELECT COUNT(*) FROM documents WHERE status = 'needs-split'"),
    pool.query(`SELECT * FROM documents WHERE status = 'needs-split' ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset]),
  ]);
  return { total: parseInt(count.rows[0].count, 10), rows: data.rows };
}

async function getSplitDocument(id) {
  const result = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function getSplitSourceDocument(id) {
  const result = await pool.query('SELECT id, file_name, file_path, box_file_id FROM documents WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function getSplitChildStatus(id) {
  const result = await pool.query(
    `SELECT id, status, classification, split_from, invoice_number, vendor_code, matched_vendor_name, job_match_number, subcontract_number
     FROM documents WHERE id = $1`, [id]
  );
  return result.rows[0] || null;
}

async function saveSplitSuggestion(id, suggestion) {
  await pool.query('UPDATE documents SET split_suggestion = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(suggestion), id]);
  await emitLegacyInvoiceAuditEvent(id, 'split-analyzed', {
    suggestedGroupCount: suggestion.suggestedGroups?.length || 0,
    reason: suggestion.meta?.reason || 'unknown',
    timing: suggestion.timing,
  });
}

async function cancelSplit(id) {
  await pool.query("UPDATE documents SET status = 'pending', updated_at = NOW() WHERE id = $1", [id]);
  await emitLegacyInvoiceAuditEvent(id, 'split-cancelled', { note: 'User chose not to split — reverted to pending' });
}

async function rejectSplit(id, reason) {
  const { rows } = await pool.query(
    "UPDATE documents SET status = 'discarded', discard_source = 'manual', discarded_at = NOW(), rejection_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [reason, id]
  );
  // Junk-cache hook: same as the app discard flow — an 'other'-classified image
  // rejected here teaches the junk fingerprint cache. Best-effort.
  if (rows[0]) await maybeCacheJunkFromDiscard(rows[0]);
  await emitLegacyInvoiceAuditEvent(id, 'split-rejected', { reason });
}

function cleanUpChildFiles(childIds) {
  for (const id of childIds) {
    try {
      for (const file of fs.readdirSync(FILES_DIR).filter((name) => name.startsWith(id))) {
        fs.unlinkSync(path.join(FILES_DIR, file));
      }
    } catch {}
  }
}

async function confirmSplit({ parentId, groups, discardPages, sourcePath }) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : null;
  if (!client) throw new Error('Database transaction connection unavailable');
  const childIds = [];
  let backupChildId = null;
  let parent = null;
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [parentId]);
    if (!locked.rows.length) {
      await client.query('ROLLBACK');
      return { kind: 'missing' };
    }
    parent = locked.rows[0];
    if (parent.status !== 'needs-split') {
      await client.query('ROLLBACK');
      return { kind: 'wrong_status', status: parent.status };
    }
    for (const [index, group] of groups.entries()) {
      const id = newDocumentId();
      const fileName = `${id}-${(parent.file_name || 'split.pdf').replace(/\.pdf$/i, '')}-group${index + 1}.pdf`;
      const filePath = path.join(FILES_DIR, fileName);
      extractPages(sourcePath, group.pages, filePath);
      const stats = fs.statSync(filePath);
      await client.query(
        `INSERT INTO documents (id, classification, status, file_name, file_path, file_size_bytes, email_message_id, email_from, email_subject, email_received_at, email_body_preview, email_body, email_body_content_type, split_from, display_name, lien_waiver_required, queued_at, updated_at, created_at)
         VALUES ($1, $2, 'split-processing', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW())`,
        [id, group.docType || 'invoice', fileName, filePath, stats.size, parent.email_message_id, parent.email_from, parent.email_subject, parent.email_received_at, parent.email_body_preview, parent.email_body, parent.email_body_content_type, parentId, group.displayName || null, parent.lien_waiver_required]
      );
      childIds.push(id);
    }
    if (discardPages.length) {
      backupChildId = newDocumentId();
      const fileName = `${backupChildId}-${(parent.file_name || 'split.pdf').replace(/\.pdf$/i, '')}-backup.pdf`;
      const filePath = path.join(FILES_DIR, fileName);
      extractPages(sourcePath, discardPages, filePath);
      const stats = fs.statSync(filePath);
      const invoiceIndex = groups.findIndex((group) => (group.docType || 'invoice') === 'invoice');
      await client.query(
        `INSERT INTO documents (id, classification, status, file_name, file_path, file_size_bytes, email_message_id, email_from, email_subject, email_received_at, email_body_preview, email_body, email_body_content_type, split_from, linked_to, display_name, queued_at, updated_at, created_at)
         VALUES ($1, 'other', 'reviewed', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW(), NOW())`,
        [backupChildId, fileName, filePath, stats.size, parent.email_message_id, parent.email_from, parent.email_subject, parent.email_received_at, parent.email_body_preview, parent.email_body, parent.email_body_content_type, parentId, childIds[invoiceIndex >= 0 ? invoiceIndex : 0] || null, `Backup pages from ${parent.file_name || 'split.pdf'}`]
      );
    }
    await client.query("UPDATE documents SET status = 'split', updated_at = NOW() WHERE id = $1", [parentId]);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    cleanUpChildFiles([...childIds, ...(backupChildId ? [backupChildId] : [])]);
    throw error;
  } finally {
    client.release();
  }
  await emitLegacyInvoiceAuditEvent(parentId, 'split', { groupCount: groups.length, childIds, backupChildId, discardedPages: discardPages });
  return { kind: 'confirmed', parent, childIds, backupChildId };
}

module.exports = {
  cancelSplit,
  confirmSplit,
  recoverStuckSplitChildren,
  spawnSplitWorker,
  getSplitChildStatus,
  getSplitDocument,
  getSplitSourceDocument,
  listSplitQueue,
  rejectSplit,
  saveSplitSuggestion,
};
