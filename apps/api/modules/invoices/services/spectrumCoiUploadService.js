'use strict';

/**
 * Spectrum COI Upload Service
 *
 * Orchestrates uploading COI documents to Spectrum's Document Tracking system.
 * Uses the scripts/spectrum library for the actual PROIV terminal automation.
 *
 * Key constraints:
 *   - One Spectrum session at a time (PROIV serial number chain is stateful)
 *   - Auth takes ~25 seconds (Playwright SSO)
 *   - Session lifetime ~6 hours
 *   - 405 errors → re-auth automatically via SessionPool
 */

const path = require('path');
const pool = require('../../../lib/db');
const logger = require('../../../lib/logger');
const { emitInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { fail } = require('../../../middleware/errorResponse');
const { evaluateCoiCompliance } = require('./coiComplianceService');
const { readJSON } = require('./utils');
const { VENDORS_PATH } = require('../../../config');
const { friendlySpectrumUploadError, userFacingError } = require('./spectrumUploadErrors');

// Spectrum automation lives outside this repo on the production server.
const SPECTRUM_SCRIPTS = process.env.SPECTRUM_SCRIPTS_DIR || '/opt/toolbox/spectrum';

// Lazy-load to avoid pulling in Playwright at API startup
let _coiUpload = null;
function getCoiUpload() {
  if (!_coiUpload) {
    _coiUpload = require(path.join(SPECTRUM_SCRIPTS, 'lib', 'coi-upload'));
  }
  return _coiUpload;
}

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

const UPLOAD_FIELDS = `
  spectrum_upload_status,
  spectrum_upload_queued_at,
  spectrum_upload_started_at,
  spectrum_upload_completed_at,
  spectrum_upload_error,
  spectrum_upload_trans_id,
  spectrum_upload_tracking_code,
  spectrum_upload_vendor_code,
  spectrum_upload_attempts
`;

async function setUploadStatus(docId, status, extra = {}) {
  const sets = [`spectrum_upload_status = $2`, `updated_at = NOW()`];
  const params = [docId, status];
  let idx = 3;

  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${idx}`);
    params.push(val);
    idx++;
  }

  await pool.query(
    `UPDATE documents SET ${sets.join(', ')} WHERE id = $1`,
    params
  );
}

async function getUploadStatus(docId) {
  const result = await pool.query(
    `SELECT id, classification, file_path, file_name, vendor_code, coi_data, coi_manual_values, ${UPLOAD_FIELDS}
     FROM documents WHERE id = $1`,
    [docId]
  );
  return result.rows[0] || null;
}

function legacyConfigId(updatedAt) {
  const value = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt || 'unversioned');
  return `legacy-singleton:${value}`;
}

async function evaluateUploadCompliance(document) {
  const [overridesResult, configResult] = await Promise.all([
    pool.query(
      'SELECT * FROM coi_overrides WHERE document_id = $1 AND revoked_at IS NULL ORDER BY approved_at ASC, id ASC',
      [document.id]
    ),
    pool.query('SELECT id, config FROM coi_config_versions WHERE effective_from <= NOW() ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1'),
  ]);
  const configRow = configResult.rows[0];
  return evaluateCoiCompliance(document, {
    config: configRow?.config || {},
    configVersionId: configRow?.id || 'legacy-singleton:unversioned',
    overrides: overridesResult.rows,
  });
}

/**
 * Claim an eligible COI upload in the same write that moves its state to
 * queued. A prior read is only used to give callers a precise conflict; it is
 * never relied on to authorize this state transition.
 */
async function claimUpload(docId, vendorCode) {
  const result = await pool.query(
    `UPDATE documents
     SET spectrum_upload_status = 'queued',
         spectrum_upload_queued_at = NOW(),
         spectrum_upload_error = NULL,
         spectrum_upload_vendor_code = $2,
         spectrum_upload_attempts = COALESCE(spectrum_upload_attempts, 0) + 1,
         updated_at = NOW()
     WHERE id = $1
       AND classification = 'coi'
       AND file_path IS NOT NULL
       AND (spectrum_upload_status IS NULL OR spectrum_upload_status = 'failed')
     RETURNING id, classification, file_path, file_name, vendor_code, ${UPLOAD_FIELDS}`,
    [docId, vendorCode]
  );
  return result.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Main upload handler
// ---------------------------------------------------------------------------

/**
 * Handle POST /api/documents/:id/upload-to-spectrum
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function uploadToSpectrum(req, res) {
  const docId = req.params.id;

  // ── Look up the document ───────────────────────────────────
  // This provides useful 404/409 responses. The conditional claim below is
  // still authoritative because another request can change the row after this
  // read.
  const doc = await getUploadStatus(docId);
  if (!doc) {
    return fail(res, 404, 'Document not found');
  }

  // Must be a COI
  if (doc.classification !== 'coi') {
    return fail(res, 409, `Document classification is "${doc.classification}", expected "coi"`, {
      code: 'CLASSIFICATION_MISMATCH',
    });
  }

  // Must have a file on disk
  if (!doc.file_path) {
    return fail(res, 409, 'Document has no file on disk', { code: 'NO_FILE' });
  }

  // Prevent duplicate uploads — allow retry of failed uploads
  if (doc.spectrum_upload_status === 'queued' || doc.spectrum_upload_status === 'processing') {
    return fail(res, 409, `Upload already ${doc.spectrum_upload_status}`, {
      code: 'ALREADY_IN_PROGRESS',
      upload: {
        status: doc.spectrum_upload_status,
        queuedAt: doc.spectrum_upload_queued_at,
      },
    });
  }
  if (doc.spectrum_upload_status === 'success') {
    return fail(res, 409, 'Document already uploaded to Spectrum', {
      code: 'ALREADY_UPLOADED',
      upload: {
        status: 'success',
        transId: doc.spectrum_upload_trans_id,
        trackingCode: doc.spectrum_upload_tracking_code,
        completedAt: doc.spectrum_upload_completed_at,
      },
    });
  }

  // The caller never supplies COI authority. Resolve the live effective result
  // before claiming, auditing, file processing, or touching Spectrum.
  const compliance = await evaluateUploadCompliance(doc);
  if (compliance.blockers.length) {
    return fail(res, 422, 'COI compliance blocks Spectrum upload', {
      code: 'COI_COMPLIANCE_BLOCKED',
      blockers: compliance.blockers,
    });
  }
  const vendorCode = compliance.vendorCode.value;
  const expirationDate = compliance.expiration.value.expirationDate;

  // ── Atomically claim and mark as queued ─────────────────────
  const claimedDoc = await claimUpload(docId, vendorCode);
  if (!claimedDoc) {
    // A concurrent request or state change won after the preflight read.
    // Re-read so the caller receives the current, stable conflict semantics.
    const current = await getUploadStatus(docId);
    if (!current) return fail(res, 404, 'Document not found');
    if (current.classification !== 'coi') {
      return fail(res, 409, `Document classification is "${current.classification}", expected "coi"`, {
        code: 'CLASSIFICATION_MISMATCH',
      });
    }
    if (!current.file_path) {
      return fail(res, 409, 'Document has no file on disk', { code: 'NO_FILE' });
    }
    if (current.spectrum_upload_status === 'queued' || current.spectrum_upload_status === 'processing') {
      return fail(res, 409, `Upload already ${current.spectrum_upload_status}`, {
        code: 'ALREADY_IN_PROGRESS',
        upload: {
          status: current.spectrum_upload_status,
          queuedAt: current.spectrum_upload_queued_at,
        },
      });
    }
    if (current.spectrum_upload_status === 'success') {
      return fail(res, 409, 'Document already uploaded to Spectrum', {
        code: 'ALREADY_UPLOADED',
        upload: {
          status: 'success',
          transId: current.spectrum_upload_trans_id,
          trackingCode: current.spectrum_upload_tracking_code,
          completedAt: current.spectrum_upload_completed_at,
        },
      });
    }
    return fail(res, 409, 'Upload state changed before it could be queued', { code: 'UPLOAD_CLAIM_LOST' });
  }

  const attempts = claimedDoc.spectrum_upload_attempts;
  const isRetry = doc.spectrum_upload_status === 'failed';

  // Emit queued audit event
  await emitInvoiceAuditEvent(req, res, {
    type: isRetry ? 'document.spectrum_upload_retried' : 'document.spectrum_upload_queued',
    targetId: docId,
    targetType: 'document',
    label: claimedDoc.file_name || docId,
    summary: isRetry
      ? `COI upload retry queued for vendor ${vendorCode} (attempt ${attempts})`
      : `COI upload queued for vendor ${vendorCode}`,
    afterState: { vendorCode, expirationDate, attempts },
    severity: 'info',
  });

  // ── Return 202 immediately — processing happens async ──────
  const { getQueueDepth } = getCoiUpload();
  const queueDepth = getQueueDepth();

  res.status(202).json({
    status: 'queued',
    documentId: docId,
    vendorCode,
    expirationDate,
    attempt: attempts,
    queuePosition: queueDepth,
    message: `Upload queued${queueDepth > 1 ? ` (position ${queueDepth} in queue)` : ''}`,
  });

  // ── Process async (fire-and-forget from request handler) ───
  processUpload(req, res, docId, vendorCode, expirationDate, claimedDoc.file_path, attempts)
    .catch(err => {
      logger.error({
        operation: 'spectrum.coi_upload.unhandled',
        documentId: docId,
        err,
      }, 'Unhandled error in COI upload background task');
    });
}

/**
 * Background upload processing.
 * Updates document status as it progresses.
 */
async function processUpload(req, res, docId, vendorCode, expirationDate, filePath, attempts) {
  const { uploadCoi } = getCoiUpload();

  try {
    // Mark processing
    await setUploadStatus(docId, 'processing', {
      spectrum_upload_started_at: new Date().toISOString(),
    });

    logger.info({
      operation: 'spectrum.coi_upload.start',
      documentId: docId,
      vendorCode,
      expirationDate,
      attempt: attempts,
    }, 'Starting COI upload to Spectrum');

    // Execute the upload chain
    const result = await uploadCoi({
      vendorCode,
      expirationDate,
      filePath,
      verbose: process.env.SPECTRUM_VERBOSE === 'true',
    });

    // No transaction ID means Spectrum never confirmed the tracking item and
    // the PDF was not attached. Treat it as a retryable failure, never success.
    if (!result || !result.transId) {
      throw userFacingError(
        'Spectrum did not confirm the COI tracking item, so the PDF was not attached. '
        + 'Nothing was saved in Spectrum. Retry the upload.'
      );
    }

    // Mark success. Also finalize the document: it leaves the pending queue
    // as 'submitted', and the confirmed vendor replaces any stale fuzzy
    // suggestion from extraction.
    const vendors = readJSON(VENDORS_PATH, []);
    const vendorEntry = vendors.find(v =>
      ((v.Vendor_Code || v.vendor_code || v.code || '').trim().toUpperCase()) === vendorCode.toUpperCase()
    );
    const confirmedVendorName = (vendorEntry?.Name || vendorEntry?.name || '').trim() || null;
    await setUploadStatus(docId, 'success', {
      spectrum_upload_completed_at: new Date().toISOString(),
      spectrum_upload_trans_id: result.transId,
      spectrum_upload_tracking_code: result.trackingCode,
      status: 'submitted',
      vendor_code: vendorCode,
      ...(confirmedVendorName ? { matched_vendor_name: confirmedVendorName } : {}),
      vendor_match_confidence: 1,
      vendor_match_method: 'coi-upload-confirmed',
    });

    // Summarize the expired-COI action sweep (non-fatal step in the chain)
    const sweep = result.sweep || null;
    let sweepSummary = '';
    if (sweep) {
      if (sweep.error) {
        sweepSummary = ` Expired-COI action sweep FAILED: ${sweep.error.slice(0, 200)}`;
      } else if (sweep.swept.length === 0) {
        sweepSummary = ' No expired COI items had actions to clear.';
      } else {
        const parts = sweep.swept.map(s => s.item);
        const allVerified = (sweep.verified || []).every(v => v.ok);
        sweepSummary = ` Cleared actions on ${sweep.swept.length} expired COI item(s): ${parts.join(', ')}${allVerified ? ' (verified)' : ' (VERIFICATION INCOMPLETE — check Spectrum)'}`;
      }
    }

    // Emit success audit event
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.spectrum_upload_succeeded',
      targetId: docId,
      targetType: 'document',
      summary: result.message + sweepSummary,
      afterState: {
        vendorCode,
        expirationDate,
        transId: result.transId,
        trackingCode: result.trackingCode,
        attempts,
        expiredCoiSweep: sweep,
      },
      severity: 'info',
    });

    logger.info({
      operation: 'spectrum.coi_upload.success',
      documentId: docId,
      vendorCode,
      transId: result.transId,
      trackingCode: result.trackingCode,
      expiredCoiSweep: sweep,
    }, 'COI upload to Spectrum succeeded');

  } catch (err) {
    // Raw library text (paths, env var names, HTML) stays in logs and the
    // audit trail. Users only ever see the plain-English message.
    const errorMessage = err?.message || String(err);
    const userMessage = friendlySpectrumUploadError(err);

    // Mark failed
    await setUploadStatus(docId, 'failed', {
      spectrum_upload_error: userMessage.slice(0, 1000),
      spectrum_upload_completed_at: new Date().toISOString(),
    });

    // Emit failure audit event
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.spectrum_upload_failed',
      targetId: docId,
      targetType: 'document',
      summary: `COI upload failed: ${userMessage.slice(0, 200)}`,
      afterState: {
        vendorCode,
        expirationDate,
        error: errorMessage.slice(0, 500),
        userMessage,
        attempts,
      },
      severity: 'warning',
    });

    logger.error({
      operation: 'spectrum.coi_upload.failed',
      documentId: docId,
      vendorCode,
      attempt: attempts,
      err,
      userMessage,
    }, 'COI upload to Spectrum failed');
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdownSpectrumPool() {
  try {
    const { destroyPool } = getCoiUpload();
    await destroyPool();
  } catch {
    // best effort
  }
}

module.exports = {
  uploadToSpectrum,
  getUploadStatus,
  claimUpload,
  shutdownSpectrumPool,
  _processUpload: processUpload,
};
