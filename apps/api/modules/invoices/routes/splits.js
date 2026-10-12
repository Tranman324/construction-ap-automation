'use strict';
/**
 * /api/splits routes
 *
 * Human-in-the-loop multi-page PDF split review.
 *
 * Flow:
 *   1. Pipeline detects multi-page PDF with multiple invoice numbers → status='needs-split'
 *   2. GET  /api/splits/queue               — list pending split reviews
 *   3. GET  /api/splits/:id                 — load a single doc + cached suggestion
 *   4. GET  /api/splits/:id/pdf             — stream the original PDF for viewer
 *   5. GET  /api/splits/:id/page/:n/preview — PNG thumbnail of a page
 *   6. POST /api/splits/:id/analyze         — fresh Haiku analysis on every call
 *   7. POST /api/splits/:id/confirm         — user confirms layout → creates children
 *   8. POST /api/splits/:id/cancel          — revert to single-doc processing
 *   9. POST /api/splits/:id/reject          — discard entire PDF
 *  10. GET  /api/splits/child/:id/status    — poll a child doc's processing state
 *
 * See docs/specs/2026-04-08-multi-page-split-review.md for the full spec.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');


const {
  cancelSplit,
  confirmSplit,
  getSplitChildStatus,
  getSplitDocument,
  getSplitSourceDocument,
  listSplitQueue,
  rejectSplit,
  saveSplitSuggestion,
  spawnSplitWorker,
} = require('../services/splitService');
const {
  getPageCount,
  extractPages,
  renderPageThumbnail,
  renderAllPages,
  validateSplitLayout,
} = require('../services/pdf-split');
const { DATA_DIR } = require('../../../config');
const { getRequestLogger } = require('../../../lib/requestLog');
const { emitInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { splitConfirmSchema, splitQueueQuerySchema } = require('../../../lib/schemas');
const { validate } = require('../../../middleware/validate');
const { requirePermission } = require('../../../middleware/permissions');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { getActiveClassificationNames } = require('./settings');
const { sanitizeFilename } = require('../services/sanitize');

const THUMBNAIL_DIR = path.join(DATA_DIR, 'thumbnails');

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Shape a needs-split doc row for API response.
 */
function rowToSplitItem(r) {
  let splitSuggestion = null;
  if (r.split_suggestion) {
    try {
      splitSuggestion =
        typeof r.split_suggestion === 'string'
          ? JSON.parse(r.split_suggestion)
          : r.split_suggestion;
    } catch {
      splitSuggestion = null;
    }
  }

  return {
    id: r.id,
    status: r.status,
    fileName: r.file_name,
    pageCount: splitSuggestion?.pageCount || null,
    email: {
      messageId: r.email_message_id,
      from: r.email_from,
      subject: r.email_subject,
      receivedAt: r.email_received_at ? r.email_received_at.toISOString() : null,
    },
    splitSuggestion,
    queuedAt: r.queued_at ? r.queued_at.toISOString() : null,
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

function validateSplitDocTypes(groups, validDocTypes) {
  for (const [i, group] of groups.entries()) {
    if (group.docType && !validDocTypes.has(group.docType)) {
      return `Group ${i + 1} has invalid docType: ${group.docType}`;
    }
  }
  return null;
}

/**
 * Fetch the source PDF path for a document. Reads file_path first; falls back
 * to Box if local is gone. Returns null if nothing available.
 */
async function resolveSourcePdfPath(docRow, req) {
  if (docRow.file_path && fs.existsSync(docRow.file_path)) {
    return docRow.file_path;
  }

  if (docRow.box_file_id) {
    const BOX_SCRIPT = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'skills',
      'box',
      'box.js'
    );
    const tmpDir = path.join(DATA_DIR, 'tmp-split-sources');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(
      tmpDir,
      `${sanitizeFilename(String(docRow.id))}-${sanitizeFilename(docRow.file_name || 'source.pdf')}`
    );
    try {
      execFileSync('node', [BOX_SCRIPT, 'download', String(docRow.box_file_id), tmpPath], {
        timeout: 60000,
      });
      if (fs.existsSync(tmpPath)) return tmpPath;
    } catch (e) {
      getRequestLogger(req).warn({
        operation: 'splits.resolve_source_pdf',
        context: { docId: docRow.id },
        error: e && e.message ? e.message : String(e),
        err: e,
      }, 'Box download failed for split source');
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/splits/queue
// ────────────────────────────────────────────────────────────────────────
router.get('/queue', requirePermission('accounting.invoices.manage_splits'), validate(splitQueueQuerySchema, 'query'), async (req, res) => {
  try {
    const { sort = 'received', sortDir = 'desc' } = req.query;

    const { limit: limitNum, offset: offsetNum } = getPagination(req.query);

    const { rows, total } = await listSplitQueue({ sort, sortDir, limit: limitNum, offset: offsetNum });

    res.json({
      items: rows.map(rowToSplitItem),
      total,
      offset: offsetNum,
      limit: limitNum,
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/splits/queue');
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/splits/:id
// ────────────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  try {
    const row = await getSplitDocument(req.params.id);
    if (!row) {
      return fail(res, 404, 'Document not found');
    }
    if (row.status !== 'needs-split') {
      return fail(res, 409, `Document is not in needs-split status (current: ${row.status})`);
    }
    res.json(rowToSplitItem(row));
  } catch (err) {
    return safeError(res, err, 'GET /api/splits/:id');
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/splits/:id/pdf — stream original PDF
// ────────────────────────────────────────────────────────────────────────
router.get('/:id/pdf', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  try {
    const row = await getSplitSourceDocument(req.params.id);
    if (!row) {
      return fail(res, 404, 'Document not found');
    }
    const srcPath = await resolveSourcePdfPath(row, req);
    if (!srcPath) {
      return fail(res, 404, 'PDF file unavailable');
    }
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${row.file_name || 'source.pdf'}"`);
    fs.createReadStream(srcPath).pipe(res);
  } catch (err) {
    return safeError(res, err, 'GET /api/splits/:id/pdf');
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/splits/:id/page/:pageNumber/preview
// ────────────────────────────────────────────────────────────────────────
router.get('/:id/page/:pageNumber/preview', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  try {
    const pageNumber = parseInt(req.params.pageNumber, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return fail(res, 400, 'Invalid page number');
    }
    const widthRaw = parseInt(req.query.width, 10) || 300;
    // Clamp 100-1600 CSS pixels. Backend renders at 2x for HiDPI sharpness,
    // so the actual PNG will be up to 3200 device pixels wide.
    const width = Math.max(100, Math.min(1600, widthRaw));

    const row = await getSplitSourceDocument(req.params.id);
    if (!row) {
      return fail(res, 404, 'Document not found');
    }

    const srcPath = await resolveSourcePdfPath(row, req);
    if (!srcPath) {
      return fail(res, 404, 'PDF file unavailable');
    }

    const pageCount = getPageCount(srcPath);
    if (pageNumber > pageCount) {
      return fail(res, 400, `Page ${pageNumber} out of range (PDF has ${pageCount} pages)`);
    }

    const cachePath = path.join(
      THUMBNAIL_DIR,
      row.id,
      `page-${pageNumber}-w${width}.png`
    );

    try {
      renderPageThumbnail(srcPath, pageNumber, cachePath, width);
    } catch (e) {
      req.log.warn({
        operation: 'splits.render_thumbnail',
        context: { docId: row.id, pageNumber },
        error: e && e.message ? e.message : String(e),
        err: e,
      }, 'Thumbnail render failed');
      return safeError(res, e, 'GET /api/splits/:id/page/:pageNumber/preview');
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(cachePath).pipe(res);
  } catch (err) {
    return safeError(res, err, 'GET /api/splits/:id/page/:pageNumber/preview');
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/splits/:id/analyze — fresh Haiku analysis on every call
// ────────────────────────────────────────────────────────────────────────
// Called by the frontend on every split review page load. Renders all pages
// via pdftoppm (single subprocess — much faster than N ImageMagick calls),
// sends them to Haiku, updates split_suggestion, and returns it.
router.post('/:id/analyze', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  const os = require('os');

  try {
    const row = await getSplitDocument(req.params.id);
    if (!row) {
      return fail(res, 404, 'Document not found');
    }
    if (row.status !== 'needs-split') {
      return fail(res, 409, `Document is not in needs-split status (current: ${row.status})`);
    }

    const srcPath = await resolveSourcePdfPath(row, req);
    if (!srcPath) {
      return fail(res, 404, 'Source PDF unavailable');
    }

    const pageCount = getPageCount(srcPath);
    if (pageCount <= 1) {
      return fail(res, 400, 'PDF has only one page — nothing to analyze');
    }

    // Lazy-load detectSplitCandidacy from pipeline (avoids circular imports at startup)
    const { detectSplitCandidacy } = require('../services/pipeline');

    // Render all pages in one pdftoppm call (single subprocess, fast)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-analyze-'));
    const startTime = Date.now();
    try {
      const renderCount = Math.min(pageCount, 20);
      const renderedPaths = renderAllPages(srcPath, tmpDir, {
        dpi: 150,
        maxPages: renderCount,
        prefix: 'page',
      });
      const renderMs = Date.now() - startTime;

      const imageInputs = renderedPaths.map((p) => ({
        data: fs.readFileSync(p).toString('base64'),
        mediaType: 'image/png',
      }));

      const haikuStart = Date.now();
      const detection = await detectSplitCandidacy(imageInputs);
      const haikuMs = Date.now() - haikuStart;

      const newSuggestion = detection.needsSplit
        ? detection.suggestion
        : {
            pageCount,
            generatedAt: new Date().toISOString(),
            pages: [],
            suggestedGroups: [],
            meta: { reason: 'haiku-says-single-invoice' },
          };

      newSuggestion.timing = {
        renderMs,
        haikuMs,
        totalMs: Date.now() - startTime,
      };

      await saveSplitSuggestion(req.params.id, newSuggestion);

      res.json({
        id: req.params.id,
        splitSuggestion: newSuggestion,
        haikuSaysSingleInvoice: !detection.needsSplit,
      });
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  } catch (err) {
    return safeError(res, err, 'POST /api/splits/:id/analyze');
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/splits/:id/confirm
// ────────────────────────────────────────────────────────────────────────
router.post('/:id/confirm', requirePermission('accounting.invoices.manage_splits'), validate(splitConfirmSchema), async (req, res) => {
  const parentId = req.params.id;
  const { groups = [], discardPages = [] } = req.body || {};

  try {
    // Pre-flight: verify doc exists and is in needs-split status
    // (quick non-locking check — real lock happens inside the transaction)
    const preflight = await getSplitDocument(parentId);
    if (!preflight) {
      return fail(res, 404, 'Document not found');
    }
    if (preflight.status !== 'needs-split') {
      return fail(res, 409, `Document is not in needs-split status (current: ${preflight.status})`);
    }

    // Pre-flight: resolve source PDF BEFORE locking the row.
    // If the source is on Box and we need to download, that can take a few
    // seconds — we don't want to hold a row lock during the download.
    const srcPath = await resolveSourcePdfPath(preflight, req);
    if (!srcPath) {
      return fail(res, 404, 'Source PDF no longer available — file was purged from local storage and Box download failed. Contact admin.');
    }

    // Pre-flight: validate we can read the source file and get a page count
    let pageCount;
    try {
      if (!fs.existsSync(srcPath)) {
        return fail(res, 404, 'Source PDF file not found on disk');
      }
      pageCount = getPageCount(srcPath);
      if (!pageCount || pageCount < 1) {
        return fail(res, 500, 'Failed to determine PDF page count');
      }
    } catch (e) {
      return safeError(res, e, 'POST /api/splits/:id/confirm');
    }

    // Validate layout
    const validation = validateSplitLayout({ groups, discardPages }, pageCount);
    if (!validation.valid) {
      return fail(res, 400, validation.error);
    }

    // Validate doc types against active classification settings, including custom types.
    const docTypeError = validateSplitDocTypes(groups, await getActiveClassificationNames());
    if (docTypeError) return fail(res, 400, docTypeError);

    const transactionResult = await confirmSplit({ parentId, groups, discardPages, sourcePath: srcPath });
    if (transactionResult.kind === 'missing') return fail(res, 404, 'Document not found');
    if (transactionResult.kind === 'wrong_status') {
      return fail(res, 409, `Document is not in needs-split status (current: ${transactionResult.status}) — another request may have already confirmed this split`);
    }
    const { childIds, backupChildId, parent } = transactionResult;
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.split_confirmed',
      invoiceId: parentId,
      targetType: 'document',
      targetId: parentId,
      row: parent || preflight,
      changes: {
        groupCount: groups.length,
        childIds,
        backupChildId,
        discardedPages: discardPages,
      },
      beforeState: {
        status: 'needs-split',
      },
      afterState: {
        status: 'split',
        childIds,
        backupChildId,
      },
      undoable: false,
      summary: 'Split confirmed',
      severity: 'info',
    });

    // Kick off the async worker to classify + extract the children.
    // Worker output goes to a log file (never 'ignore' — a silently dying
    // worker previously left children stuck in split-processing forever).
    try {
      spawnSplitWorker(childIds);
    } catch (e) {
      req.log.error({
        operation: 'splits.spawn_worker',
        context: { childIds },
        error: e && e.message ? e.message : String(e),
        err: e,
      }, 'Failed to spawn split-worker');
      // Don't fail the request — user can retry via /retry endpoint later
    }

    res.status(202).json({
      parentId,
      childIds,
      backupChildId,
      discardedPages: discardPages,
      status: 'processing',
      message: `${childIds.length} child document${childIds.length === 1 ? '' : 's'} created${backupChildId ? ' + 1 backup doc' : ''}. They will appear in the review queue when processing completes.`,
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/splits/:id/confirm');
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/splits/:id/cancel — revert to single-doc processing
// ────────────────────────────────────────────────────────────────────────
router.post('/:id/cancel', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  try {
    const row = await getSplitDocument(req.params.id);
    if (!row) {
      return fail(res, 404, 'Document not found');
    }
    if (row.status !== 'needs-split') {
      return fail(res, 409, `Document is not in needs-split status (current: ${row.status})`);
    }

    await cancelSplit(req.params.id);

    res.json({ id: req.params.id, status: 'pending' });
  } catch (err) {
    return safeError(res, err, 'POST /api/splits/:id/cancel');
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/splits/:id/reject — discard entire PDF
// ────────────────────────────────────────────────────────────────────────
router.post('/:id/reject', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  try {
    const { reason = 'Rejected during split review' } = req.body || {};

    const row = await getSplitDocument(req.params.id);
    if (!row) {
      return fail(res, 404, 'Document not found');
    }
    if (row.status !== 'needs-split') {
      return fail(res, 409, `Document is not in needs-split status (current: ${row.status})`);
    }

    await rejectSplit(req.params.id, reason);

    res.json({ id: req.params.id, status: 'discarded' });
  } catch (err) {
    return safeError(res, err, 'POST /api/splits/:id/reject');
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/splits/child/:id/status — poll a child doc's processing state
// ────────────────────────────────────────────────────────────────────────
router.get('/child/:id/status', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  try {
    const r = await getSplitChildStatus(req.params.id);
    if (!r) {
      return fail(res, 404, 'Child document not found');
    }
    res.json({
      id: r.id,
      parentId: r.split_from,
      status: r.status,
      classification: r.classification,
      extractedInvoiceNumber: r.invoice_number,
      matchedVendor: r.vendor_code,
      matchedVendorName: r.matched_vendor_name,
      matchedJob: r.job_match_number,
      matchedSubcontract: r.subcontract_number,
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/splits/child/:id/status');
  }
});

module.exports = router;
module.exports.validateSplitDocTypes = validateSplitDocTypes;
