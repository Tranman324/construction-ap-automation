'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  checkStateMatch,
  emitInvoiceAuditEvent,
  findUndoableAction,
  getRequestAuditActor,
  insertAuditEvent,
  markActionUndone,
} = require('../../../lib/auditEvents');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { canonicalizeErrorBody, errorBody } = require('../../../lib/response');
const { checkPermission } = require('../../../middleware/permissions');
const { getWaiverActionSerializationOptions, pool, audit, rowToDoc } = require('./supabase');
const { getStatementReconcileState } = require('./statementReconciliation');
const { deleteFiledSharePointCopy } = require('./sharepointUndoService');
const { DISCARD_PROTECTED_STATUSES, TRANSIENT_STATUSES } = require('./statusConstants');
const { withTransaction } = require('./transaction');
const { discardDocumentInTransaction } = require('./documentDiscardService');
const { FILTER_DISCARD_SOURCES, rescueOnRestore } = require('./junkFilterService');
const { resolveFilingValues } = require('./filingValueResolver');
const { sanitizeFilenameOverride } = require('./sharepointFilename');

const FILE_STATE_FIELDS = [
  'filed',
  'filed_at',
  'filed_destination',
  'filing_note',
  'hold_reason',
  'sp_file_url',
  'sharepoint_item_id',
  'sharepoint_filename',
];
const WAIVER_OVERRIDE_FIELDS = [
  'waiver_on_document',
  'waiver_on_document_at',
  'waiver_on_document_by',
];
const WAIVER_BYPASS_FIELDS = ['lien_waiver_required', 'waiver_bypassed', 'waiver_bypassed_at', 'waiver_bypassed_by'];
const RECONCILE_STATE_FIELDS = ['reconciled', 'reconciled_at'];
const STATEMENT_RECONCILE_STATE_FIELDS = [
  'reconciled',
  'reconciled_at',
  'filed',
  'filed_at',
];

function getActorName(req, res) {
  return getRequestAuditActor(req, res).name || 'system';
}

function isStatement(row) {
  return row?.classification === 'statement';
}

function getUnresolvedStatementLineIds(value) {
  return getStatementReconcileState({
    classification: 'statement',
    statement_lines: value,
  }).unresolvedLineIds;
}

function reconcileStateFields(row) {
  return isStatement(row) ? STATEMENT_RECONCILE_STATE_FIELDS : RECONCILE_STATE_FIELDS;
}

function pickState(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

function actionMetadata(event, type, undoEndpoint, reason) {
  return {
    actionId: event ? event.id : null,
    type,
    undoable: Boolean(event && undoEndpoint),
    ...(undoEndpoint ? { undoEndpoint } : {}),
    ...(reason ? { reason } : {}),
  };
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function waiverOverrideMetadata(row) {
  return {
    active: Boolean(row.waiver_on_document),
    at: toIsoString(row.waiver_on_document_at),
    by: row.waiver_on_document_by || null,
  };
}

function serializeWaiverActionInvoice(req, row) {
  return rowToDoc(row, getWaiverActionSerializationOptions(req));
}

function canonicalReconcileEnvelope(req, row, event, type, undoEndpoint, reason) {
  return {
    invoice: rowToDoc(row, {
      includeStatementReconcile: true,
      canReconcile: checkPermission(req, 'accounting.invoices.approve'),
    }),
    ...(event ? { action: actionMetadata(event, type, undoEndpoint, reason) } : {}),
  };
}

function respondWithAction(req, res, row, event, type, undoEndpoint, reason) {
  const includeStatementReconcile = type === 'reconcile' || type === 'unreconcile';
  if (includeStatementReconcile) {
    return res.json(canonicalReconcileEnvelope(req, row, event, type, undoEndpoint, reason));
  }
  return res.json({
    invoice: rowToDoc(row, {
      canReconcile: checkPermission(req, 'accounting.invoices.approve'),
    }),
    ...(event ? { action: actionMetadata(event, type, undoEndpoint, reason) } : {}),
  });
}

function sendStateChanged(res, actionId, stateCheck) {
  return res.status(409).json(errorBody(
    'Document was modified since your action. Undo is no longer safe.',
    'STATE_CHANGED_SINCE_ACTION',
    { actionId, staleFields: stateCheck.staleFields }
  ));
}


function transientStatusBody(status) {
  return {
    error: `Cannot file document while status is "${status}".`,
    code: 'TRANSIENT_STATUS',
  };
}

async function deleteUncommittedSharePointUpload({ itemId, documentId, req, reason }) {
  if (!itemId) return null;

  try {
    const { deleteDriveItem } = require('../../../lib/graph');
    const { PROJECTS_DRIVE_ID } = require('./sharepointFilingService');
    await deleteDriveItem(PROJECTS_DRIVE_ID, itemId);
    return { deleted: true, itemId };
  } catch (err) {
    const warning = err && err.message ? err.message : String(err);
    req.log.warn({
      operation: 'invoice.file.sharepoint_compensation',
      context: { invoiceId: documentId, itemId, reason },
      error: warning,
    }, 'SharePoint upload compensation failed after filing was short-circuited');
    return { deleted: false, itemId, warning };
  }
}

async function selectDocumentForUpdate(db, id) {
  return db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
}

function makeJsonResponse(body, statusCode = 200) {
  return { statusCode, body: canonicalizeErrorBody(body) };
}

function sendJsonOutcome(res, outcome) {
  const body = canonicalizeErrorBody(outcome.body);
  if (outcome.statusCode && outcome.statusCode !== 200) {
    return res.status(outcome.statusCode).json(body);
  }
  return res.json(body);
}

function normalizeClassificationInput(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function writeJsonFileAtomic(filePath, payload) {
  const fs = require('fs');
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, filePath);
}

async function reviewInvoice(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      if (row.status === 'reviewed') return makeJsonResponse({ invoice: rowToDoc(row) });

      const beforeState = pickState(row, ['status', 'reviewed_at']);
      await db.query(
        'UPDATE documents SET status = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2',
        ['reviewed', req.params.id]
      );

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        row,
        updatedRow: updated.rows[0],
        beforeState,
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, updatedRow, beforeState } = outcome;
    await audit(req.params.id, 'reviewed', { status: [row.status, 'reviewed'] });

    const afterState = pickState(updatedRow, ['status', 'reviewed_at']);
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.reviewed',
      invoiceId: req.params.id,
      row,
      changes: { status: [row.status, 'reviewed'] },
      beforeState,
      afterState,
      undoable: true,
      summary: 'Invoice reviewed',
      severity: 'info',
    });

    return respondWithAction(req, res, updatedRow, event, 'review', `/api/invoices/${req.params.id}/unreview`);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/review');
  }
}

async function unreviewInvoice(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      const action = await findUndoableAction(req.params.id, 'invoice.reviewed');
      if (!action) {
        if (row.status !== 'reviewed') return makeJsonResponse({ invoice: rowToDoc(row) });
        return makeJsonResponse({
          error: 'Undo action not found',
          code: 'ACTION_NOT_FOUND',
        }, 404);
      }

      const stateCheck = checkStateMatch(row, action.afterState);
      if (!stateCheck.match) {
        return makeJsonResponse(errorBody(
          'Document was modified since your action. Undo is no longer safe.',
          'STATE_CHANGED_SINCE_ACTION',
          { actionId: action.id, staleFields: stateCheck.staleFields }
        ), 409);
      }

      const beforeState = pickState(row, ['status', 'reviewed_at']);
      const restoredStatus = action.beforeState?.status || 'pending';
      await db.query(
        'UPDATE documents SET status = $1, reviewed_at = NULL, updated_at = NOW() WHERE id = $2',
        [restoredStatus, req.params.id]
      );

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        action,
        row,
        restoredStatus,
        beforeState,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { action, row, restoredStatus, beforeState, updatedRow } = outcome;
    await markActionUndone(action.id, getActorName(req, res));
    await audit(req.params.id, 'unreviewed', { status: [row.status, restoredStatus] });

    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.unreviewed',
      invoiceId: req.params.id,
      row,
      changes: { status: [row.status, restoredStatus] },
      beforeState,
      afterState: pickState(updatedRow, ['status', 'reviewed_at']),
      undoable: true,
      summary: 'Invoice review undone',
      severity: 'info',
    });

    return respondWithAction(req, res, updatedRow, event, 'unreview', `/api/invoices/${req.params.id}/review`);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/unreview');
  }
}

function alreadyFiledBody() {
  return {
    error: 'Document is already filed.',
    code: 'ALREADY_FILED',
  };
}

function fileGuardOutcome(body, statusCode, sharePoint) {
  return { body: canonicalizeErrorBody(body), statusCode, sharePoint };
}

async function uploadFileToSharePoint({
  req,
  row,
  uploadToSharePoint,
  destination,
  destinationAbsolute,
  filenameOverride,
}) {
  const result = {
    spFileUrl: null,
    spItemId: null,
    spFilename: null,
    spUploadError: null,
    spMetadataWarning: null,
  };
  if (!uploadToSharePoint || row.classification === 'statement') return result;

  const localFilePath = row.merged_file_path || row.file_path;
  // null means no explicit selection; an empty string selects Projects root.
  if (destinationAbsolute !== null && localFilePath) {
    try {
      const {
        PROJECTS_DRIVE_ID,
        uploadFileToDestination,
        stampListItemFields,
      } = require('./sharepointFilingService');
      const item = await uploadFileToDestination({
        driveId: PROJECTS_DRIVE_ID,
        parentPath: destinationAbsolute,
        localFilePath,
        document: row,
        filename: filenameOverride,
      });
      result.spFileUrl = item.webUrl;
      result.spItemId = item.id;
      result.spFilename = item.name;
      try {
        await stampListItemFields({ driveId: PROJECTS_DRIVE_ID, itemId: item.id, document: row });
      } catch (err) {
        result.spMetadataWarning = err.message;
        req.log.warn({
          operation: 'invoice.file.sharepoint_metadata_absolute',
          context: { invoiceId: req.params.id, itemId: item.id },
          error: err.message,
        }, 'SharePoint metadata stamping failed during filing');
      }
    } catch (err) {
      result.spUploadError = err.message;
      req.log.warn({
        operation: 'invoice.file.sharepoint_upload_absolute',
        context: { invoiceId: req.params.id, destinationAbsolute },
        error: err.message,
      }, 'SharePoint absolute-path upload failed during filing');
    }
    return result;
  }

  if (destinationAbsolute !== null) {
    result.spUploadError = 'Document file is missing on disk';
    return result;
  }

  const jobNumber = resolveFilingValues(row).job.value;
  if (!jobNumber || !localFilePath) {
    result.spUploadError = jobNumber ? 'Document file is missing on disk' : 'Document has no matched job number';
    return result;
  }

  try {
    const { uploadDocumentToJobFolder } = require('./sharepointFilingService');
    const uploaded = await uploadDocumentToJobFolder({
      jobNumber,
      destination: destination || '',
      localFilePath,
      document: row,
      fileName: filenameOverride,
    });
    result.spFileUrl = uploaded.webUrl;
    result.spItemId = uploaded.id;
    result.spFilename = uploaded.name;
    result.spMetadataWarning = uploaded.metadataWarning || null;
  } catch (err) {
    result.spUploadError = err.message;
    req.log.warn({
      operation: 'invoice.file.sharepoint_upload',
      context: { invoiceId: req.params.id, jobNumber, destination },
      error: err.message,
    }, 'SharePoint upload failed during filing');
  }
  return result;
}

async function fileDocument(req, res) {
  try {
    // Optional filing metadata from the doc panels (2026-07-01):
    //   destination: SharePoint subfolder path chosen in the DestinationPicker
    //   note:        free-form filing note
    //   holdReason:  lien-waiver hold justification
    //   uploadToSharePoint: upload the local file to an explicit drive-relative
    //                       destination (including root), or the matched job folder
    const body = req.body || {};
    const uploadToSharePoint = body.uploadToSharePoint === true;
    const destination = typeof body.destination === 'string' ? body.destination.slice(0, 500) : null;
    const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;
    const holdReason = typeof body.holdReason === 'string' ? body.holdReason.slice(0, 2000) : null;
    const filenameOverride = typeof body.filename === 'string' ? body.filename.slice(0, 128) : null;
    const destinationAbsolute = typeof body.destinationAbsolute === 'string'
      ? body.destinationAbsolute.slice(0, 500)
        .split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..').join('/')
      : null;
    const lockOutcome = await withTransaction(pool, async (db) => {
      const initialResult = await selectDocumentForUpdate(db, req.params.id);
      if (initialResult.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);
      const row = initialResult.rows[0];
      if (TRANSIENT_STATUSES.has(row.status)) return makeJsonResponse(transientStatusBody(row.status), 409);
      if (row.filed && (!uploadToSharePoint || row.sp_file_url)) {
        return uploadToSharePoint && row.sp_file_url
          ? fileGuardOutcome(alreadyFiledBody(), 409)
          : makeJsonResponse({ invoice: rowToDoc(row) });
      }


      const {
        spFileUrl,
        spItemId,
        spFilename,
        spUploadError,
        spMetadataWarning,
      } = await uploadFileToSharePoint({
        req,
        row,
        uploadToSharePoint,
        destination,
        destinationAbsolute,
        filenameOverride,
      });

      const lockResult = await selectDocumentForUpdate(db, req.params.id);
      if (lockResult.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);
      const lockedRow = lockResult.rows[0];
      if (TRANSIENT_STATUSES.has(lockedRow.status)) {
        return fileGuardOutcome(transientStatusBody(lockedRow.status), 409, {
          spFileUrl,
          spItemId,
          spFilename,
          spUploadError,
          spMetadataWarning,
        });
      }
      if (lockedRow.filed && (!uploadToSharePoint || lockedRow.sp_file_url)) {
        return fileGuardOutcome(alreadyFiledBody(), 409, {
          spFileUrl,
          spItemId,
          spFilename,
          spUploadError,
          spMetadataWarning,
        });
      }

      // A requested SharePoint upload is the filing operation, not a best-effort
      // add-on to shelving. Preserve the locked row on failure so a fresh client
      // can retry; do not emit a successful filing audit or an undo action.
      if (spUploadError !== null) {
        return makeJsonResponse({
          invoice: rowToDoc(lockedRow),
          sharePoint: { uploaded: false, error: spUploadError || 'SharePoint upload failed' },
        });
      }

      const beforeState = pickState(lockedRow, FILE_STATE_FIELDS);
      // Existing SharePoint names are historical records. Re-filing a shelved
      // row may upload a new item, but must not rewrite that persisted history.
      const persistedSharePointFilename = lockedRow.sharepoint_filename ?? spFilename;
      await db.query(
        `UPDATE documents
         SET filed = true, filed_at = NOW(), updated_at = NOW(),
             filed_destination = COALESCE($2, filed_destination),
             filing_note = COALESCE($3, filing_note),
             hold_reason = COALESCE($4, hold_reason),
             sp_file_url = COALESCE($5, sp_file_url),
             sharepoint_item_id = COALESCE($6, sharepoint_item_id),
             sharepoint_filename = COALESCE($7, sharepoint_filename)
         WHERE id = $1`,
        [req.params.id, destinationAbsolute ?? destination, note, holdReason, spFileUrl, spItemId, persistedSharePointFilename]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        beforeState,
        lockedRow,
        updatedRow: updated.rows[0],
        sharePoint: {
          spFileUrl,
          spItemId,
          spFilename,
          spUploadError,
          spMetadataWarning,
        },
      };
    });

    if (lockOutcome.body) {
      const sharePointCompensation = await deleteUncommittedSharePointUpload({
        itemId: lockOutcome.sharePoint?.spItemId,
        documentId: req.params.id,
        req,
        reason: lockOutcome.body.code || 'FILE_GUARD_SHORT_CIRCUIT',
      });
      const guardedOutcome = sharePointCompensation?.warning
        ? {
          ...lockOutcome,
          body: canonicalizeErrorBody({
            ...lockOutcome.body,
            sharePoint: {
              uploaded: true,
              itemId: sharePointCompensation.itemId,
              warning: `SharePoint upload could not be removed after filing was blocked: ${sharePointCompensation.warning}`,
            },
          }),
        }
        : lockOutcome;
      return sendJsonOutcome(res, guardedOutcome);
    }

    const { beforeState, lockedRow, updatedRow, sharePoint } = lockOutcome;
    const {
      spFileUrl,
      spItemId,
      spFilename,
      spUploadError,
      spMetadataWarning,
    } = sharePoint;
    const requestedFilename = filenameOverride?.trim() || '';
    const effectiveOverride = sanitizeFilenameOverride(requestedFilename);
    const overrideAudit = effectiveOverride
      ? {
        requestedFilename,
        ...(spFilename ? { sharePointFilename: spFilename } : {}),
      }
      : {};
    await audit(req.params.id, 'filed', {
      filed: [lockedRow.filed || false, true],
      ...(destination ? { destination } : {}),
      ...(holdReason ? { holdReason: true } : {}),
      ...(spFileUrl ? { sharePointUpload: true } : {}),
      ...overrideAudit,
    }, getActorName(req, res));
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.filed',
      invoiceId: req.params.id,
      row: lockedRow,
      changes: {
        filed: [lockedRow.filed || false, true],
        ...overrideAudit,
      },
      beforeState,
      afterState: pickState(updatedRow, FILE_STATE_FIELDS),
      undoable: true,
      summary: 'Invoice marked filed',
      severity: 'info',
    });

    return res.json({
      invoice: rowToDoc(updatedRow),
      ...(event ? { action: actionMetadata(event, 'file', `/api/invoices/${req.params.id}/actions/${event.id}/undo`) } : {}),
      ...(spFileUrl ? {
        sharePoint: {
          uploaded: true,
          webUrl: spFileUrl,
          itemId: spItemId,
          filename: spFilename,
          ...(spMetadataWarning ? { warning: spMetadataWarning } : {}),
        },
      } : {}),
      ...(spUploadError ? { sharePoint: { uploaded: false, error: spUploadError } } : {}),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/file');
  }
}

async function unfileDocument(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);

      const row = result.rows[0];
      if (!row.filed) return makeJsonResponse({ invoice: rowToDoc(row) });

      const action = await findUndoableAction(req.params.id, 'invoice.filed');
      const beforeState = pickState(row, FILE_STATE_FIELDS);
      if (action) {
        const stateCheck = checkStateMatch(row, pickState(action.afterState || {}, ['filed', 'filed_at']));
        if (!stateCheck.match) {
          return makeJsonResponse(errorBody(
            'Document was modified since your action. Undo is no longer safe.',
            'STATE_CHANGED_SINCE_ACTION',
            { actionId: action.id, staleFields: stateCheck.staleFields }
          ), 409);
        }
      }

      const sharePointDelete = await deleteFiledSharePointCopy({
        row,
        req,
        operation: 'invoice.unfile.sharepoint_delete',
      });
      await db.query(
        `UPDATE documents
         SET filed = false,
             filed_at = NULL,
             filed_destination = NULL,
             filing_note = NULL,
             hold_reason = NULL,
             sp_file_url = NULL,
             sharepoint_item_id = NULL,
             sharepoint_filename = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        action,
        beforeState,
        row,
        sharePointDelete,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { action, beforeState, row, sharePointDelete, updatedRow } = outcome;
    if (action) await markActionUndone(action.id, getActorName(req, res));
    await audit(req.params.id, 'unfiled', {
      filed: [true, false],
      ...(sharePointDelete ? { sharePointDelete } : {}),
    }, getActorName(req, res));
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.unfiled',
      invoiceId: req.params.id,
      row,
      changes: {
        filed: [true, false],
        mode: 'explicit_unfile',
        ...(sharePointDelete ? { sharePointDelete } : {}),
      },
      beforeState,
      afterState: pickState(updatedRow, FILE_STATE_FIELDS),
      undoable: true,
      summary: 'Invoice unfiled',
      severity: 'info',
    });

    return res.json({
      invoice: rowToDoc(updatedRow),
      action: actionMetadata(event, 'unfile', `/api/invoices/${req.params.id}/file`),
      ...(sharePointDelete ? { sharePoint: sharePointDelete } : {}),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/unfile');
  }
}

async function setWaiverOverride(req, res) {
  try {
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);

      const row = result.rows[0];
      if (row.waiver_on_document) {
        return makeJsonResponse({
          invoice: serializeWaiverActionInvoice(req, row),
          waiverOverride: waiverOverrideMetadata(row),
        });
      }

      const beforeState = pickState(row, WAIVER_OVERRIDE_FIELDS);
      await db.query(
        `UPDATE documents
         SET waiver_on_document = true,
             waiver_on_document_at = NOW(),
             waiver_on_document_by = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [actor, req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        row,
        beforeState,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, beforeState, updatedRow } = outcome;
    await audit(req.params.id, 'waiver-override-set', {
      waiverOnDocument: [Boolean(row.waiver_on_document), true],
      actor,
    }, actor);

    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'document.waiver_override_set',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: {
        waiverOnDocument: [Boolean(row.waiver_on_document), true],
        waiverOnDocumentBy: actor,
      },
      beforeState,
      afterState: pickState(updatedRow, WAIVER_OVERRIDE_FIELDS),
      undoable: true,
      summary: 'Waiver-on-document override set',
      severity: 'info',
    });

    return res.json({
      invoice: serializeWaiverActionInvoice(req, updatedRow),
      action: actionMetadata(event, 'waiver_override', `/api/invoices/${req.params.id}/waiver-override/revert`),
      waiverOverride: waiverOverrideMetadata(updatedRow),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/waiver-override');
  }
}

async function revertWaiverOverride(req, res) {
  try {
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);

      const row = result.rows[0];
      if (!row.waiver_on_document) {
        return makeJsonResponse({
          invoice: serializeWaiverActionInvoice(req, row),
          waiverOverride: waiverOverrideMetadata(row),
        });
      }

      const beforeState = pickState(row, WAIVER_OVERRIDE_FIELDS);
      await db.query(
        `UPDATE documents
         SET waiver_on_document = false,
             waiver_on_document_at = NULL,
             waiver_on_document_by = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        row,
        beforeState,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, beforeState, updatedRow } = outcome;
    await audit(req.params.id, 'waiver-override-reverted', {
      waiverOnDocument: [true, false],
      actor,
    }, actor);

    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'document.waiver_override_reverted',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: {
        waiverOnDocument: [true, false],
        waiverOnDocumentBy: actor,
      },
      beforeState,
      afterState: pickState(updatedRow, WAIVER_OVERRIDE_FIELDS),
      undoable: true,
      summary: 'Waiver-on-document override reverted',
      severity: 'info',
    });

    return res.json({
      invoice: serializeWaiverActionInvoice(req, updatedRow),
      action: actionMetadata(event, 'waiver_override_revert', `/api/invoices/${req.params.id}/waiver-override`),
      waiverOverride: waiverOverrideMetadata(updatedRow),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/waiver-override/revert');
  }
}

async function setLienWaiverBypass(req, res) {
  try {
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);

      const row = result.rows[0];
      if (row.lien_waiver_required !== true || row.waiver_bypassed === true) {
        return makeJsonResponse({ invoice: serializeWaiverActionInvoice(req, row) });
      }

      const beforeState = pickState(row, WAIVER_BYPASS_FIELDS);
      // Persistent bypass: lien_waiver_required stays a pure detection output
      // (trg_lien_waiver_detection recomputes it on any update touching its
      // inputs); the human decision lives in waiver_bypassed and survives
      // those recomputes. Effective requirement = required AND NOT bypassed.
      await db.query(
        `UPDATE documents
         SET waiver_bypassed = true,
             waiver_bypassed_at = NOW(),
             waiver_bypassed_by = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [actor, req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, beforeState, updatedRow: updated.rows[0] };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, beforeState, updatedRow } = outcome;
    await audit(req.params.id, 'waiver-bypass-set', {
      waiverBypassed: [false, true],
      actor,
    }, actor);

    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'document.waiver_bypass_set',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: { waiverBypassed: [false, true] },
      beforeState,
      afterState: pickState(updatedRow, WAIVER_BYPASS_FIELDS),
      undoable: true,
      summary: 'Lien waiver requirement bypassed',
      severity: 'info',
    });

    return res.json({
      invoice: serializeWaiverActionInvoice(req, updatedRow),
      action: actionMetadata(event, 'waiver_bypass', `/api/invoices/${req.params.id}/waiver-bypass/revert`),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/waiver-bypass');
  }
}

async function revertLienWaiverBypass(req, res) {
  try {
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Document not found' }, 404);

      const row = result.rows[0];
      if (row.waiver_bypassed !== true) {
        return makeJsonResponse({ invoice: serializeWaiverActionInvoice(req, row) });
      }

      const beforeState = pickState(row, WAIVER_BYPASS_FIELDS);
      await db.query(
        `UPDATE documents
         SET waiver_bypassed = false,
             waiver_bypassed_at = NULL,
             waiver_bypassed_by = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, beforeState, updatedRow: updated.rows[0] };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, beforeState, updatedRow } = outcome;
    await audit(req.params.id, 'waiver-bypass-reverted', {
      waiverBypassed: [true, false],
      actor,
    }, actor);

    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'document.waiver_bypass_reverted',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: { waiverBypassed: [true, false] },
      beforeState,
      afterState: pickState(updatedRow, WAIVER_BYPASS_FIELDS),
      undoable: true,
      summary: 'Lien waiver requirement restored',
      severity: 'info',
    });

    return res.json({
      invoice: serializeWaiverActionInvoice(req, updatedRow),
      action: actionMetadata(event, 'waiver_bypass_revert', `/api/invoices/${req.params.id}/waiver-bypass`),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/waiver-bypass/revert');
  }
}

async function rejectInvoice(req, res) {
  try {
    const reason = req.body?.reason || '';
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      if (['submitting', 'submitted'].includes(row.status)) {
        return makeJsonResponse({
          error: `Cannot reject invoice while status is "${row.status}".`,
          code: 'INVALID_STATUS_TRANSITION',
        }, 409);
      }

      const beforeState = pickState(row, ['status', 'rejection_reason']);
      const updateResult = await db.query(
        `UPDATE documents
         SET status = $1, rejection_reason = $2, updated_at = NOW()
         WHERE id = $3 AND status NOT IN ('submitting', 'submitted')`,
        ['rejected', reason, req.params.id]
      );
      if (updateResult.rowCount === 0) {
        return makeJsonResponse({
          error: 'Cannot reject invoice because its status changed.',
          code: 'INVALID_STATUS_TRANSITION',
        }, 409);
      }

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, beforeState, updatedRow: updated.rows[0] };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, beforeState, updatedRow } = outcome;
    await audit(req.params.id, 'rejected', { reason });
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.rejected',
      invoiceId: req.params.id,
      row,
      changes: { status: [row.status, 'rejected'], reason },
      beforeState,
      afterState: pickState(updatedRow, ['status', 'rejection_reason']),
      undoable: false,
      summary: 'Invoice rejected',
      severity: 'warning',
    });

    return res.json({
      invoice: rowToDoc(updatedRow),
      action: actionMetadata(
        event,
        'reject',
        null,
        'Rejected invoices require an explicit follow-up action.'
      ),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/reject');
  }
}

async function discardInvoice(req, res) {
  try {
    let reason = req.body?.reason || '';
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      // Duplicate-banner discard (DUPLICATE-WORKFLOW-SPEC 2.2): the client
      // signals context only; the server composes the canonical reason from
      // its OWN evaluation. Client-provided reason text is never trusted for
      // the auto-fill (an empty-reason discard cost a full investigation on
      // 8/24). Falls back to the client reason when no signal is found.
      if (req.body?.duplicateContext === true) {
        const ctxRow = (await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id])).rows[0];
        if (ctxRow) {
          const { evaluateDuplicateStatus, buildDuplicateDiscardReason } = require('./duplicateStatusService');
          const evaluation = await evaluateDuplicateStatus(ctxRow, { db });
          const composed = buildDuplicateDiscardReason(evaluation);
          if (composed) reason = composed;
        }
      }
      const discarded = await discardDocumentInTransaction({
        db,
        id: req.params.id,
        actor,
        reason,
        req,
        res,
        legacyChanges: { reason },
      });
      if (discarded.outcome === 'not_found') return makeJsonResponse({ error: 'Invoice not found' }, 404);
      if (discarded.outcome === 'protected') {
        return makeJsonResponse({
          error: `Cannot discard invoice while status is "${discarded.status}".`,
          code: discarded.status === 'submitted' ? 'INVALID_STATUS_TRANSITION' : 'TRANSIENT_STATUS',
        }, 409);
      }
      if (discarded.outcome === 'already_discarded' || discarded.outcome === 'raced') {
        return makeJsonResponse({
          error: 'Cannot discard invoice because its status changed.',
          code: 'INVALID_STATUS_TRANSITION',
        }, 409);
      }
      return discarded;
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    return respondWithAction(req, res, outcome.updatedRow, outcome.event, 'discard', `/api/invoices/${req.params.id}/undiscard`);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/discard');
  }
}

async function undiscardInvoice(req, res) {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    const action = await findUndoableAction(req.params.id, 'invoice.discarded');
    if (!action) {
      if (row.status !== 'discarded') return res.json({ invoice: rowToDoc(row) });
      // Filter-discarded rows (junk-hash / rule-filter / auto-ai) are created
      // pre-discarded by the pipeline, so they have no discard event to undo.
      // Restore = rescue: un-junk the content hash so a re-forwarded copy
      // reprocesses, clear the source pill, and send the doc back to pending.
      if (FILTER_DISCARD_SOURCES.has(row.discard_source)) {
        const beforeState = pickState(row, ['status', 'discarded_at', 'discarded_by', 'discard_source']);
        await pool.query(
          `UPDATE documents
           SET status = 'pending',
               discarded_at = NULL,
               discarded_by = NULL,
               discard_source = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [req.params.id]
        );
        await rescueOnRestore(row); // best-effort junk-hash removal
        await audit(req.params.id, 'undiscarded', { status: [row.status, 'pending'], rescue: row.discard_source });
        const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        const updatedRow = updated.rows[0];
        const event = await emitInvoiceAuditEvent(req, res, {
          type: 'invoice.undiscarded',
          invoiceId: req.params.id,
          row,
          changes: { status: [row.status, 'pending'], rescue: row.discard_source },
          beforeState,
          afterState: pickState(updatedRow, ['status', 'discarded_at', 'discarded_by', 'discard_source']),
          undoable: false,
          summary: `Filtered attachment restored (was ${row.discard_source})`,
          severity: 'info',
        });
        return respondWithAction(req, res, updatedRow, event, 'undiscard', `/api/invoices/${req.params.id}/discard`);
      }
      // The row is discarded but has no undoable event: it was discarded outside
      // the app (e.g. a raw-SQL dedup/ops sweep, a split rejection, or an
      // auto-discard rule) before a structured undo record was written. Explain
      // the cause instead of a bare not-found; the row is left untouched. New ops
      // discards go through scripts/ops-discard.js, which DOES emit the event.
      return fail(
        res,
        422,
        'This document was discarded outside the app and has no undo record, so it cannot be restored from here.',
        { code: 'DISCARD_NOT_UNDOABLE' }
      );
    }

    const stateCheck = checkStateMatch(row, action.afterState);
    if (!stateCheck.match) return sendStateChanged(res, action.id, stateCheck);

    const restoredStatus = action.beforeState?.status || 'pending';
    const restoresLinkedWaiverShelf = row.classification === 'lien-waiver'
      && Boolean(row.linked_lien_waiver_id)
      && action.beforeState?.filed === true;
    const stateFields = restoresLinkedWaiverShelf
      ? ['status', 'discarded_at', 'discarded_by', 'filed', 'filed_at']
      : ['status', 'discarded_at', 'discarded_by'];
    const beforeState = pickState(row, stateFields);
    const restoreResult = await pool.query(
      `UPDATE documents
       SET status = $1,
           discarded_at = NULL,
           discarded_by = NULL,
           discard_source = NULL,
           ${restoresLinkedWaiverShelf ? 'filed = true,\n           filed_at = $2,' : ''}
           updated_at = NOW()
       WHERE id = $${restoresLinkedWaiverShelf ? 3 : 2}
         ${restoresLinkedWaiverShelf ? "AND status = 'discarded' AND linked_lien_waiver_id = $4" : ''}`,
      restoresLinkedWaiverShelf
        ? [
          restoredStatus,
          action.beforeState.filed_at || new Date().toISOString(),
          req.params.id,
          row.linked_lien_waiver_id,
        ]
        : [restoredStatus, req.params.id]
    );
    if (restoresLinkedWaiverShelf && restoreResult.rowCount === 0) {
      return fail(res, 409, 'Lien waiver link changed before the discard could be undone.', {
        code: 'WAIVER_LINK_CHANGED',
      });
    }
    await rescueOnRestore(row); // no-op unless the discard came from a filter layer
    await markActionUndone(action.id, getActorName(req, res));
    await audit(req.params.id, 'undiscarded', { status: [row.status, restoredStatus] });

    const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    const updatedRow = updated.rows[0];
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.undiscarded',
      invoiceId: req.params.id,
      row,
      changes: { status: [row.status, restoredStatus] },
      beforeState,
      afterState: pickState(updatedRow, stateFields),
      undoable: true,
      summary: 'Invoice discard undone',
      severity: 'info',
    });

    return respondWithAction(req, res, updatedRow, event, 'undiscard', `/api/invoices/${req.params.id}/discard`);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/undiscard');
  }
}

async function reconcileInvoice(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      const statement = isStatement(row);
      if (row.reconciled && (!statement || row.filed)) {
        return makeJsonResponse(canonicalReconcileEnvelope(req, row));
      }

      const stateFields = reconcileStateFields(row);
      const beforeState = pickState(row, stateFields);
      if (statement) {
        const unresolvedLineIds = getUnresolvedStatementLineIds(row.statement_lines);
        if (unresolvedLineIds.length > 0) {
          return makeJsonResponse({
            error: 'Statement has unresolved lines',
            code: 'STATEMENT_LINES_UNRESOLVED',
            unresolvedLineIds,
          }, 409);
        }
        await db.query(
          `UPDATE documents
           SET reconciled = true,
               reconciled_at = COALESCE(reconciled_at, NOW()),
               filed = true,
               filed_at = COALESCE(filed_at, NOW()),
               updated_at = NOW()
           WHERE id = $1`,
          [req.params.id]
        );
      } else {
        await db.query(
          'UPDATE documents SET reconciled = true, reconciled_at = NOW(), updated_at = NOW() WHERE id = $1',
          [req.params.id]
        );
      }
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        beforeState,
        row,
        stateFields,
        statement,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { beforeState, row, stateFields, statement, updatedRow } = outcome;
    const changes = { reconciled: [row.reconciled || false, true] };
    if (statement) changes.filed = [row.filed || false, true];
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.reconciled',
      invoiceId: req.params.id,
      row,
      changes,
      beforeState,
      afterState: pickState(updatedRow, stateFields),
      undoable: true,
      summary: 'Invoice reconciled',
      severity: 'info',
    });

    return respondWithAction(req, res, updatedRow, event, 'reconcile', `/api/invoices/${req.params.id}/unreconcile`);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/reconcile');
  }
}

async function unreconcileInvoice(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      const statement = isStatement(row);
      if (!row.reconciled && (!statement || !row.filed)) {
        return makeJsonResponse(canonicalReconcileEnvelope(req, row));
      }

      const action = await findUndoableAction(req.params.id, 'invoice.reconciled');
      const stateFields = reconcileStateFields(row);
      const beforeState = pickState(row, stateFields);
      if (action) {
        const stateCheck = checkStateMatch(row, action.afterState);
        if (!stateCheck.match) {
          return makeJsonResponse(errorBody(
            'Document was modified since your action. Undo is no longer safe.',
            'STATE_CHANGED_SINCE_ACTION',
            { actionId: action.id, staleFields: stateCheck.staleFields }
          ), 409);
        }
      }

      const restoredState = {
        reconciled: action?.beforeState?.reconciled ?? false,
        reconciled_at: action?.beforeState?.reconciled_at ?? null,
        ...(statement ? {
          filed: action?.beforeState?.filed ?? false,
          filed_at: action?.beforeState?.filed_at ?? null,
        } : {}),
      };
      if (statement) {
        await db.query(
          `UPDATE documents
           SET reconciled = $1,
               reconciled_at = $2,
               filed = $3,
               filed_at = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [
            restoredState.reconciled,
            restoredState.reconciled_at,
            restoredState.filed,
            restoredState.filed_at,
            req.params.id,
          ]
        );
      } else {
        await db.query(
          'UPDATE documents SET reconciled = $1, reconciled_at = $2, updated_at = NOW() WHERE id = $3',
          [restoredState.reconciled, restoredState.reconciled_at, req.params.id]
        );
      }
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        action,
        beforeState,
        restoredState,
        row,
        stateFields,
        statement,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { action, beforeState, restoredState, row, stateFields, statement, updatedRow } = outcome;
    if (action) await markActionUndone(action.id, getActorName(req, res));
    const changes = { reconciled: [row.reconciled || false, restoredState.reconciled] };
    if (statement) {
      changes.filed = [row.filed || false, restoredState.filed];
    }
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.unreconciled',
      invoiceId: req.params.id,
      row,
      changes,
      beforeState,
      afterState: pickState(updatedRow, stateFields),
      undoable: true,
      summary: 'Invoice reconciliation undone',
      severity: 'info',
    });

    return respondWithAction(req, res, updatedRow, event, 'unreconcile', `/api/invoices/${req.params.id}/reconcile`);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/unreconcile');
  }
}

// Filename keywords too generic to ever cache as a classification signal.
const CLASSIFICATION_KEYWORD_BLOCKLIST = new Set([
  'invoice', 'document', 'scan', 'scanned', 'attachment', 'file', 'copy',
  'image', 'img', 'photo', 'pdf', 'untitled', 'new', 'final', 'signed',
]);

/**
 * Learn from a human reclassification: store a filename-pattern → classification
 * entry in classification-cache.json so the pipeline (which already reads this
 * cache before calling Haiku) classifies the next similar file correctly.
 * Digits/dates are stripped so "PA1 Signed 05.15.26.pdf" → "pa signed".
 */
function recordClassificationFeedback(fileName, classification, log) {
  try {
    if (!fileName || !classification) return;
    const keywords = String(fileName)
      .toLowerCase()
      .replace(/\.[^.]+$/, '')          // extension
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}[0-9a-f-]*/g, ' ') // uuids
      .replace(/\d+/g, ' ')             // digits/dates
      .replace(/[_\-.,()#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (keywords.length <= 3 || CLASSIFICATION_KEYWORD_BLOCKLIST.has(keywords)) return;

    const { DATA_DIR } = require('../../../config');
    const cachePath = path.join(DATA_DIR, 'classification-cache.json');
    const fs = require('fs');
    let cache = { senders: {}, patterns: {} };
    try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
    if (!cache.patterns) cache.patterns = {};
    cache.patterns[keywords] = {
      classification,
      source: 'reclassify-feedback',
      updatedAt: new Date().toISOString(),
    };
    writeJsonFileAtomic(cachePath, cache);
    if (log) log.info({ operation: 'invoice.reclassify.feedback', context: { keywords, classification } }, 'Classification feedback cached');
  } catch (err) {
    if (log) log.warn({ operation: 'invoice.reclassify.feedback', error: err.message }, 'Classification feedback write failed');
  }
}

async function reclassifyInvoice(req, res) {
  try {
    const { classification } = req.body || {};
    if (!classification) return fail(res, 400, 'classification is required');
    const normalizedClassification = normalizeClassificationInput(classification);
    if (!normalizedClassification) {
      return fail(res, 400, 'classification must be kebab-case');
    }
    const { getActiveClassificationNames } = require('../routes/settings');
    const activeNames = await getActiveClassificationNames();
    if (!activeNames.has(normalizedClassification)) {
      return res.status(400).json(errorBody(
        `Unknown or inactive classification: ${normalizedClassification}`,
        'INVALID_CLASSIFICATION'
      ));
    }

    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query(
        'SELECT classification, file_name, linked_lien_waiver_id FROM documents WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const oldClass = result.rows[0].classification;
      if (normalizedClassification !== oldClass && result.rows[0].linked_lien_waiver_id) {
        return makeJsonResponse({
          error: 'Unlink the lien waiver before changing this document classification.',
          code: 'WAIVER_LINKED_CLASSIFICATION_PROTECTED',
        }, 409);
      }
      await db.query(
        'UPDATE documents SET classification = $1, updated_at = $2 WHERE id = $3',
        [normalizedClassification, new Date().toISOString(), req.params.id]
      );
      const { resolveActor } = require('../../../lib/invoiceAuditActor');
      await insertAuditEvent({
        type: 'invoice.reclassified', actor: await resolveActor(req.user || {}, db),
        target: { type: 'invoice', id: req.params.id },
        changes: { classification: [oldClass, normalizedClassification] },
        summary: 'Document reclassified', module: 'invoices',
      }, db);
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        fileName: result.rows[0].file_name,
        oldClass,
        updatedRow: updated.rows[0],
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { fileName, oldClass, updatedRow } = outcome;
    await audit(req.params.id, 'reclassified', { classification: [oldClass, normalizedClassification] });

    // Feedback loop: teach the pipeline's classification cache from this correction.
    recordClassificationFeedback(fileName, normalizedClassification, req.log);

    // A doc corrected TO coi was extracted under the wrong prompt at ingest and
    // has no coi_data — rescan it so the compliance engine (computed on-read)
    // gets real data. re-extract.js picks the COI prompt from the stored
    // classification, which the transaction above already committed.
    if (normalizedClassification === 'coi' && normalizedClassification !== oldClass) {
      const child = spawn('node', [path.join(__dirname, '..', 'scripts', 're-extract.js'), req.params.id], {
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }

    res.json(rowToDoc(updatedRow));
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/reclassify');
  }
}

async function retryInvoice(req, res) {
  try {
    const result = await pool.query('SELECT classification FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');
    if (result.rows[0].classification !== 'error') return fail(res, 400, 'Only error items can be retried');

    await pool.query('UPDATE documents SET status = $1, updated_at = $2 WHERE id = $3', ['retry-pending', new Date().toISOString(), req.params.id]);
    await audit(req.params.id, 'retry');

    // cwd must be modules/invoices (script lives in its scripts/ dir); the old
    // '..','..' cwd resolved to modules/ and the spawn died silently.
    const child = spawn('node', [path.join(__dirname, '..', 'scripts', 'reprocess-errors.js'), '--id', req.params.id], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    res.json({ success: true, id: req.params.id, status: 'retry-pending' });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/retry');
  }
}

async function reprocessInvoice(req, res) {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    if (['submitted', 'submitting', 'split-processing'].includes(row.status)) {
      return fail(res, 400, `Documents with status ${row.status} cannot be reprocessed`);
    }
    if (!row.file_path || !fs.existsSync(row.file_path)) {
      return fail(res, 400, 'A stored file is required to reprocess this document');
    }

    const actor = getActorName(req, res);
    await audit(req.params.id, 'reprocess_requested', { status: row.status }, actor);
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.reprocess_requested',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: { status: row.status, reprocess: 'requested' },
      summary: `Reprocess requested for ${row.file_name || req.params.id}`,
      severity: 'info',
    });

    const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logFd = fs.openSync(path.join(logsDir, 'pipeline.log'), 'a');
    try {
      const child = spawn('node', [path.join(__dirname, '..', 'scripts', 'reprocess-errors.js'), '--id', req.params.id], {
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      child.unref();
    } finally {
      fs.closeSync(logFd);
    }

    return res.json({ success: true, id: req.params.id, status: row.status });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/reprocess');
  }
}

async function flagForSplit(req, res) {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    const docId = req.params.id;
    const nextPath = `/invoices/splits/${docId}`;

    // Idempotent: already needs-split → return 200 with nextPath
    if (row.status === 'needs-split') {
      return res.json({
        id: docId,
        status: 'needs-split',
        previousStatus: 'needs-split',
        nextPath,
        message: 'Document is already queued for split review.',
      });
    }

    // Locked statuses: cannot split
    const lockedStatuses = ['split-processing', 'split', 'submitted'];
    if (lockedStatuses.includes(row.status)) {
      return fail(res, 409, `Document is in '${row.status}' status and cannot be split.`);
    }

    // Only certain statuses can transition to needs-split
    const allowedStatuses = ['pending', 'approved', 'modified', 'reviewed'];
    if (!allowedStatuses.includes(row.status)) {
      return fail(res, 409, `Cannot flag document in status '${row.status}' for split. Allowed: ${allowedStatuses.join(', ')}.`);
    }

    // Must be a PDF with a file attachment
    if (!row.file_path || !row.file_name || !row.file_name.toLowerCase().endsWith('.pdf')) {
      return fail(res, 422, 'Only PDF documents with an attachment can be split.');
    }

    await pool.query(
      `UPDATE documents
       SET status = 'needs-split',
           updated_at = NOW()
       WHERE id = $1`,
      [docId]
    );

    // Audit: doc-level log
    await audit(docId, 'document.split_requested', {
      previousStatus: row.status,
      newStatus: 'needs-split',
      source: 'manual',
      trigger: 'user',
    });

    // Audit: platform-level audit_events
    const actor = req.user?.email || 'dashboard';
    try {
      await insertAuditEvent({
        type: 'document.split_requested',
        actor: { name: actor, role: 'user' },
        target: { type: 'document', id: docId, label: row.file_name },
        changes: { status: 'needs-split', source: 'manual' },
        beforeState: { status: row.status },
        afterState: { status: 'needs-split' },
        summary: `Manual split requested for ${row.file_name} (${row.status} → needs-split)`,
        module: 'invoices',
        severity: 'info',
      });
    } catch (auditErr) {
      // Non-fatal: don't block the split request if audit write fails
    }

    res.json({
      id: docId,
      status: 'needs-split',
      previousStatus: row.status,
      nextPath,
      message: 'Document queued for split review.',
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/flag-for-split');
  }
}

module.exports = {
  discardInvoice,
  fileDocument,
  flagForSplit,
  reclassifyInvoice,
  reconcileInvoice,
  rejectInvoice,
  revertLienWaiverBypass,
  revertWaiverOverride,
  reprocessInvoice,
  retryInvoice,
  reviewInvoice,
  setLienWaiverBypass,
  setWaiverOverride,
  toggleFiled: fileDocument,
  undiscardInvoice,
  unreconcileInvoice,
  unreviewInvoice,
};
