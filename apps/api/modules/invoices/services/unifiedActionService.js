'use strict';

const {
  AUDIT_EVENT_COLUMNS,
  checkStateMatch,
  emitInvoiceAuditEvent,
  findAuditEvent,
  getRequestAuditActor,
  markActionUndone,
  rowToAuditEvent,
} = require('../../../lib/auditEvents');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { pool, rowToDoc } = require('./supabase');
const { deleteFiledSharePointCopy } = require('./sharepointUndoService');

const FILE_AND_RELEASE_FIELDS = ['filed', 'filed_at', 'waiver_released', 'waiver_released_at'];
const FILE_UNDO_WINDOW_SECONDS = 300;
const FILE_UNDO_WINDOW_MS = FILE_UNDO_WINDOW_SECONDS * 1000;
const FILE_ACTION_TYPE = 'invoice.filed';

const NON_UNDOABLE_ACTIONS = {
  upload_to_spectrum: {
    eventType: 'coi.uploaded_to_spectrum',
    reason: 'Document uploaded to Spectrum. This action cannot be reversed.',
  },
  create_vendor_upload: {
    eventType: 'w9.vendor_created',
    reason: 'Vendor creation and upload cannot be safely reversed in Spectrum.',
  },
  submit_to_spectrum: {
    eventType: 'invoice.submitted',
    reason: 'Document submitted to Spectrum. This action cannot be reversed.',
  },
  file_to_job_cost: {
    eventType: 'invoice.file_to_job_cost',
    reason: 'Job cost filing cannot be reversed after Spectrum submission.',
  },
};

const UNDOABLE_COLUMNS = new Set([
  'amount',
  'approved_at',
  'approved_by',
  'classification',
  'cost_type',
  'description',
  'discarded_at',
  'discarded_by',
  'display_name',
  'due_date',
  // BE-G: undo must restore the origin snapshot with the values, else a stale
  // origin survives the restore (e.g. false violet after undoing an edit).
  'field_origins',
  'filed',
  'filed_at',
  'filed_destination',
  'filing_note',
  'gl_account',
  'gl_date',
  'hold_reason',
  'invoice_date',
  'invoice_number',
  'job_match_number',
  'lien_waiver_required',
  'lien_waiver_status',
  'phase_code',
  'project_name',
  'reconciled',
  'reconciled_at',
  'reviewed_at',
  'routing_code',
  'status',
  'subcontract_number',
  'sp_file_url',
  'sharepoint_item_id',
  'sharepoint_filename',
  'vendor_code',
  'vendor_name',
  'waiver_on_document',
  'waiver_on_document_at',
  'waiver_on_document_by',
  'waiver_released',
  'waiver_released_at',
  'was_modified',
]);

function getActorName(req, res) {
  return getRequestAuditActor(req, res).name || 'system';
}

function pickState(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

function actionMetadata(event, type, undoEndpoint, reason) {
  return {
    actionId: event.id,
    type,
    undoable: Boolean(undoEndpoint),
    ...(undoEndpoint ? { undoEndpoint } : {}),
    ...(reason ? { reason } : {}),
  };
}

function sendStateChanged(res, actionId, stateCheck) {
  return fail(res, 409, 'Document was modified since your action. Undo is no longer safe.', {
    code: 'STATE_CHANGED_SINCE_ACTION',
    actionId,
    staleFields: stateCheck.staleFields,
  });
}

function getFileUndoExpiry(action) {
  const actionTime = action?.timestamp ? new Date(action.timestamp).getTime() : NaN;
  if (Number.isNaN(actionTime)) return null;
  return new Date(actionTime + FILE_UNDO_WINDOW_MS);
}

function sendUndoWindowExpired(res, action) {
  const expiresAt = getFileUndoExpiry(action);
  return fail(res, 410, 'File undo window expired. Footer undo is available for five minutes after filing.', {
    code: 'UNDO_WINDOW_EXPIRED',
    actionId: action.id,
    undoWindowSeconds: FILE_UNDO_WINDOW_SECONDS,
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  });
}

function isFileUndoExpired(action) {
  if (action.type !== FILE_ACTION_TYPE) return false;
  const expiresAt = getFileUndoExpiry(action);
  if (!expiresAt) return false;
  return Date.now() > expiresAt.getTime();
}

function buildUndoUpdate(beforeState) {
  const values = [];
  const sets = [];

  for (const [field, value] of Object.entries(beforeState || {})) {
    if (!UNDOABLE_COLUMNS.has(field)) continue;
    values.push(value);
    sets.push(`${field} = $${values.length}`);
  }

  values.push(new Date().toISOString());
  sets.push(`updated_at = $${values.length}`);
  return { sets, values };
}

async function executeAction(req, res) {
  try {
    const action = req.body?.action;
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    if (action === 'file_and_release') {
      const beforeState = pickState(row, FILE_AND_RELEASE_FIELDS);
      await pool.query(
        `UPDATE documents
         SET filed = true,
             filed_at = COALESCE(filed_at, NOW()),
             waiver_released = true,
             waiver_released_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );

      const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      const updatedRow = updated.rows[0];
      const event = await emitInvoiceAuditEvent(req, res, {
        type: 'waiver.filed_and_released',
        invoiceId: req.params.id,
        row,
        changes: { action: 'file_and_release' },
        beforeState,
        afterState: pickState(updatedRow, FILE_AND_RELEASE_FIELDS),
        undoable: true,
        summary: 'Lien waiver filed and released',
        severity: 'info',
      });

      return res.json({
        invoice: rowToDoc(updatedRow),
        action: actionMetadata(
          event,
          'file_and_release',
          `/api/invoices/${req.params.id}/actions/${event.id}/undo`
        ),
      });
    }

    const externalAction = NON_UNDOABLE_ACTIONS[action];
    if (!externalAction) {
      return fail(res, 400, 'Unsupported action');
    }

    const event = await emitInvoiceAuditEvent(req, res, {
      type: externalAction.eventType,
      invoiceId: req.params.id,
      row,
      changes: { action, payload: req.body?.payload || {} },
      beforeState: {},
      afterState: {},
      undoable: false,
      summary: externalAction.reason,
      severity: 'warning',
    });

    return res.json({
      invoice: rowToDoc(row),
      action: actionMetadata(event, action, null, externalAction.reason),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/actions');
  }
}

async function undoAction(req, res) {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    const action = await findAuditEvent(req.params.id, req.params.actionId);
    if (!action) {
      return fail(res, 404, 'Undo action not found', { code: 'ACTION_NOT_FOUND' });
    }
    if (action.undoneAt) {
      return fail(res, 409, 'Action already undone', { code: 'ALREADY_UNDONE', actionId: action.id });
    }
    if (!action.undoable) {
      return fail(res, 409, 'Action is not undoable', { code: 'ACTION_NOT_UNDOABLE', actionId: action.id });
    }
    if (isFileUndoExpired(action)) return sendUndoWindowExpired(res, action);

    const stateCheck = checkStateMatch(row, action.afterState);
    if (!stateCheck.match) return sendStateChanged(res, action.id, stateCheck);

    const undoWouldUnshelfLinkedWaiver = row.classification === 'lien-waiver'
      && Boolean(row.linked_lien_waiver_id)
      && Object.hasOwn(action.beforeState || {}, 'filed')
      && action.beforeState.filed !== true;
    if (undoWouldUnshelfLinkedWaiver) {
      return fail(
        res,
        409,
        'Cannot undo shelving while this lien waiver is linked to an invoice.',
        { code: 'WAIVER_LINKED_SHELF_PROTECTED' }
      );
    }

    const sharePointDelete = action.type === FILE_ACTION_TYPE
      ? await deleteFiledSharePointCopy({
        row,
        req,
        operation: 'invoice.file_undo.sharepoint_delete',
      })
      : null;
    const { sets, values } = buildUndoUpdate(action.beforeState);
    values.push(req.params.id);
    await pool.query(
      `UPDATE documents SET ${sets.join(', ')} WHERE id = $${values.length}`,
      values
    );
    await markActionUndone(action.id, getActorName(req, res));

    const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    const updatedRow = updated.rows[0];
    await emitInvoiceAuditEvent(req, res, {
      type: action.type === FILE_ACTION_TYPE
        ? 'invoice.file_undo'
        : (action.type === 'waiver.filed_and_released'
          ? 'waiver.undo_filed_and_released'
          : 'invoice.action_undone'),
      invoiceId: req.params.id,
      row,
      changes: {
        undoneActionId: action.id,
        undoneActionType: action.type,
        ...(action.type === FILE_ACTION_TYPE ? { mode: 'footer_undo' } : {}),
        ...(sharePointDelete ? { sharePointDelete } : {}),
      },
      beforeState: action.afterState || {},
      afterState: action.beforeState || {},
      undoable: false,
      summary: action.type === FILE_ACTION_TYPE ? 'Invoice file action undone' : 'Invoice action undone',
      severity: 'info',
    });

    return res.json({
      invoice: rowToDoc(updatedRow),
      undoneActionId: action.id,
      ...(sharePointDelete ? { sharePoint: sharePointDelete } : {}),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/actions/:actionId/undo');
  }
}

async function getInvoiceActions(req, res) {
  try {
    const doc = await pool.query('SELECT id FROM documents WHERE id = $1', [req.params.id]);
    if (doc.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const { limit, offset } = getPagination(req.query);
    const result = await pool.query(
      `SELECT ${AUDIT_EVENT_COLUMNS}
       FROM audit_events
       WHERE target_id = $1
       ORDER BY timestamp DESC, created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );

    return res.json({ actions: result.rows.map(rowToAuditEvent) });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/actions');
  }
}

module.exports = {
  executeAction,
  getInvoiceActions,
  undoAction,
};
