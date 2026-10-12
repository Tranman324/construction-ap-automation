'use strict';

const {
  checkStateMatch,
  emitInvoiceAuditEvent,
  findUndoableAction,
  getRequestAuditActor,
  markActionUndone,
} = require('../../../lib/auditEvents');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { canonicalizeErrorBody, errorBody } = require('../../../lib/response');
const { validateApprovalEligibility } = require('./approvalValidator');
const { getEffectiveCoding } = require('./approvalStateService');
const { queueApprovedInvoiceWaiverMerge } = require('./pdfMergeService');
const { pool, audit, rowToDoc } = require('./supabase');
const { withTransaction } = require('./transaction');
const {
  markLinkedWaiverLinked,
} = require('./waiverLinkedStatusService');

const APPROVAL_STATE_FIELDS = [
  'status',
  'invoice_date',
  'approved_at',
  'approved_by',
  'routing_code',
  'phase_code',
  'cost_type',
  'gl_account',
  'gl_date',
];

// BE-G: canonical camelCase origin keys for the coding-default columns
// (matches FIELD_MAP in invoiceEditService).
const CODING_DEFAULT_ORIGIN_KEYS = {
  routing_code: 'routingCode',
  phase_code: 'phaseCode',
  cost_type: 'costType',
  gl_account: 'glAccount',
  gl_date: 'glDate',
};

function pickState(row, fields = APPROVAL_STATE_FIELDS) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

function getActorName(req, res) {
  return getRequestAuditActor(req, res).name || 'system';
}

function actionMetadata(event, type, undoEndpoint) {
  return {
    actionId: event.id,
    type,
    undoable: true,
    undoEndpoint,
  };
}

function sendStateChanged(res, actionId, stateCheck) {
  return res.status(409).json(errorBody(
    'Document was modified since your action. Undo is no longer safe.',
    'STATE_CHANGED_SINCE_ACTION',
    { actionId, staleFields: stateCheck.staleFields }
  ));
}

function buildRestoreApprovalUpdate(beforeState) {
  const values = [];
  const sets = [];
  APPROVAL_STATE_FIELDS.forEach((field) => {
    values.push(beforeState && Object.prototype.hasOwnProperty.call(beforeState, field)
      ? beforeState[field]
      : null);
    sets.push(`${field} = $${values.length}`);
  });

  // BE-G: approvals snapshot field_origins into beforeState (only — never
  // afterState, whose keys drive checkStateMatch), so a strict unapprove
  // restores provenance with the values. Pre-feature events lack the key and
  // leave origins untouched (never fabricated).
  if (beforeState && Object.prototype.hasOwnProperty.call(beforeState, 'field_origins')) {
    values.push(beforeState.field_origins);
    sets.push(`field_origins = $${values.length}`);
  }

  values.push(new Date().toISOString());
  sets.push(`updated_at = $${values.length}`);
  return { sets, values };
}

function buildOriginMergeClause(vals, origins) {
  vals.push(JSON.stringify(origins));
  return `, field_origins = field_origins || $${vals.length}::jsonb`;
}

async function applyApprovalOverrides(db, req, row, actor) {
  const overrideFieldMap = {
    routingCode: 'routing_code',
    phaseCode: 'phase_code',
    costType: 'cost_type',
    glAccount: 'gl_account',
    glDate: 'gl_date',
  };
  const sets = [];
  const vals = [];
  const originPatch = {};
  const originAt = new Date().toISOString();
  let idx = 1;

  for (const [camel, col] of Object.entries(overrideFieldMap)) {
    if (req.body && camel in req.body) {
      sets.push(`${col} = $${idx++}`);
      vals.push(req.body[camel]);
      row[col] = req.body[camel];
      // BE-G: approval overrides are explicit user input — manual origin,
      // stamped in the same statement as the value write.
      originPatch[camel] = { origin: 'manual', at: originAt, by: actor };
    }
  }

  if (sets.length === 0) return;

  const originClause = buildOriginMergeClause(vals, originPatch);
  vals.push(req.params.id);
  await db.query(
    `UPDATE documents SET ${sets.join(', ')}${originClause}, updated_at = NOW() WHERE id = $${vals.length}`,
    vals
  );
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

function approvalStatusConflict(status) {
  return makeJsonResponse({
    error: `Cannot approve invoice while status is "${status}".`,
    code: 'INVALID_STATUS_TRANSITION',
  }, 409);
}

async function approveInvoice(req, res) {
  try {
    const requestId = req.requestId;
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      if (!['pending', 'modified', 'reviewed'].includes(row.status)) {
        return approvalStatusConflict(row.status);
      }

      const beforeState = pickState(row);
      // BE-G: snapshot provenance so strict unapprove can restore it. Goes in
      // beforeState ONLY — afterState keys drive checkStateMatch.
      beforeState.field_origins = row.field_origins ?? {};
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'invoiceDate')) {
        return makeJsonResponse({
          error: 'Cannot approve with invoiceDate. Save the corrected invoice date before approving.',
          code: 'INVOICE_DATE_APPROVAL_OVERRIDE_UNSUPPORTED',
        }, 400);
      }
      await applyApprovalOverrides(db, req, row, actor);

      // Effective-values gate: validate the row merged with the served
      // codingDefaults — the exact merge GET /api/validate-approval previews —
      // then persist those effective values on success. Preview ⟺ action.
      const { applied, effectiveRow } = getEffectiveCoding(row, { log: req.log });
      // Duplicate blocker (DUPLICATE-WORKFLOW-SPEC 2.4): live evaluation,
      // same service the banner endpoint consumes so they cannot disagree.
      const { evaluateDuplicateStatus } = require('./duplicateStatusService');
      const duplicateStatus = await evaluateDuplicateStatus(row, { db });
      const eligibility = validateApprovalEligibility(effectiveRow, { invoiceId: req.params.id, closedPeriodDateSource: 'invoice', duplicateStatus });
      if (eligibility.error) return makeJsonResponse(eligibility, 400);
      const { approvalPath } = eligibility;

      const appliedEntries = Object.entries(applied);
      if (appliedEntries.length > 0) {
        const sets = [];
        const vals = [];
        const originPatch = {};
        const originAt = new Date().toISOString();
        let idx = 1;
        for (const [col, val] of appliedEntries) {
          sets.push(`${col} = $${idx++}`);
          vals.push(val);
          row[col] = val;
          // BE-G: coding defaults are server-derived fills (hasValue-guarded,
          // never overwrite) — derived origin, same statement as the write.
          const camel = CODING_DEFAULT_ORIGIN_KEYS[col];
          if (camel) originPatch[camel] = { origin: 'derived', at: originAt, by: 'approval-defaults' };
        }
        const originClause = buildOriginMergeClause(vals, originPatch);
        vals.push(req.params.id);
        await db.query(
          `UPDATE documents SET ${sets.join(', ')}${originClause}, updated_at = NOW() WHERE id = $${vals.length}`,
          vals
        );
      }

      const now = new Date().toISOString();
      const approvalSets = [
        'status = $1',
        'approved_at = $2',
        'approved_by = $3',
        'updated_at = $2',
      ];
      const approvalValues = ['approved', now, actor];
      approvalValues.push(req.params.id);
      const updateResult = await db.query(
        `UPDATE documents
           SET ${approvalSets.join(',\n               ')}
           WHERE id = $${approvalValues.length} AND status IN ('pending', 'modified', 'reviewed')`,
        approvalValues
      );
      if (updateResult.rowCount === 0) return approvalStatusConflict(row.status);

      // Linked-waiver lifecycle (2026-08-05): approving an invoice parks its
      // linked lien waiver as status 'linked' so it leaves the pending queue.
      // Same transaction — approval and waiver parking commit atomically.
      const waiverTransition = await markLinkedWaiverLinked({
        db,
        invoiceId: req.params.id,
        waiverId: row.linked_lien_waiver_id,
        actor,
        req,
        res,
      });

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      const changes = {
        status: [row.status, 'approved'],
        approvalPath,
        autoRouting: applied.routing_code ? `routing_code set to ${applied.routing_code}` : null,
        ...(Object.keys(applied).length > 0 ? { appliedCodingDefaults: applied } : {}),
      };
      // Legacy audit history is a required part of approval. Enlist it in the
      // transaction so a failed audit insert rolls back the full approval.
      await audit(req.params.id, 'approved', changes, 'dashboard', db);
      return { row, beforeState, updatedRow: updated.rows[0], approvalPath, applied, waiverTransition, changes };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);

    const { row, beforeState, updatedRow, changes } = outcome;
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.approved',
      invoiceId: req.params.id,
      row,
      changes,
      beforeState,
      afterState: pickState(updatedRow),
      undoable: true,
      summary: 'Invoice approved',
      severity: 'info',
    });

    // Approval-confirmation learning: an unchanged approval verifies the
    // pipeline's match — promote heuristic matches into the mapping caches.
    // Fire-and-forget; a learning failure must never affect the approval.
    const { recordApprovalConfirmation } = require('./matcher');
    recordApprovalConfirmation(row).then((promoted) => {
      if (promoted.vendor || promoted.job || promoted.subcontract) {
        req.log.info({
          operation: 'invoice.approve.confirmation_learning',
          context: { invoiceId: req.params.id, promoted },
        }, 'Approval promoted heuristic matches into mapping caches');
      }
    }).catch((err) => {
      req.log.warn({
        operation: 'invoice.approve.confirmation_learning',
        context: { invoiceId: req.params.id },
        error: err && err.message ? err.message : String(err),
      }, 'recordApprovalConfirmation failed');
    });

    if (row.linked_lien_waiver_id) {
      queueApprovedInvoiceWaiverMerge({
        pool,
        invoice: { ...row },
        invoiceId: req.params.id,
        waiverId: row.linked_lien_waiver_id,
        requestId,
        requestLog: req.log,
      });
    }

    res.json({
      invoice: rowToDoc(updatedRow),
      action: actionMetadata(event, 'approve', `/api/invoices/${req.params.id}/unapprove`),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/approve');
  }
}

async function unapproveInvoice(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { error: { status: 404, message: 'Invoice not found' } };

      const row = result.rows[0];
      const currentStatus = row.status;
      if (currentStatus !== 'approved' && currentStatus !== 'modified') {
        return {
          error: {
            status: 400,
            message: `Cannot unapprove invoice with status "${currentStatus}". Only approved or modified invoices can be unapproved.`,
          },
        };
      }

      // Strict undo (restore the pre-approval coding) is only safe when the doc
      // still looks exactly like approval left it. When it was edited afterwards
      // (e.g. fixing coding after a Spectrum rejection), fall back to a plain
      // unapprove — flip to pending, KEEP the current edits — instead of
      // refusing with 409 and stranding the doc in approved forever.
      let action = await findUndoableAction(req.params.id, 'invoice.approved');
      if (action && !checkStateMatch(row, action.afterState).match) {
        action = null;
      }

      const beforeState = pickState(row);
      const restoredState = action
        ? { ...action.beforeState }
        : { ...pickState(row), status: 'pending', approved_at: null, approved_by: null };
      const { sets, values } = buildRestoreApprovalUpdate(restoredState);
      values.push(req.params.id);
      await db.query(
        `UPDATE documents SET ${sets.join(', ')} WHERE id = $${values.length}`,
        values
      );

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, currentStatus, beforeState, action, updatedRow: updated.rows[0] };
    });
    if (outcome.error) return fail(res, outcome.error.status, outcome.error.message);

    const { row, currentStatus, beforeState, action, updatedRow } = outcome;
    if (action) await markActionUndone(action.id, getActorName(req, res));
    await audit(req.params.id, 'unapproved', { status: [currentStatus, updatedRow.status] });
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.unapproved',
      invoiceId: req.params.id,
      row,
      changes: { status: [currentStatus, updatedRow.status] },
      beforeState,
      afterState: pickState(updatedRow),
      undoable: true,
      summary: 'Invoice unapproved',
      severity: 'info',
    });

    res.json({
      invoice: rowToDoc(updatedRow),
      action: actionMetadata(event, 'unapprove', `/api/invoices/${req.params.id}/approve`),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/unapprove');
  }
}

module.exports = {
  CODING_DEFAULT_ORIGIN_KEYS,
  approveInvoice,
  unapproveInvoice,
};
