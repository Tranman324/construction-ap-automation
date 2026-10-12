'use strict';

const { checkPermission } = require('../../../middleware/permissions');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { errorBody } = require('../../../lib/response');
const { pool, audit } = require('./supabase');
const { validateApprovalEligibility } = require('./approvalValidator');
const { getEffectiveCoding } = require('./approvalStateService');
const { CODING_DEFAULT_ORIGIN_KEYS } = require('./invoiceApprovalService');
const { DISCARD_PROTECTED_STATUSES } = require('./statusConstants');
const { withTransaction } = require('./transaction');
const { maybeCacheJunkFromDiscard } = require('./junkFilterService');

const ACTION_PERMISSIONS = {
  approve: 'accounting.invoices.approve',
  unapprove: 'accounting.invoices.approve',
  discard: 'accounting.invoices.delete',
  review: 'accounting.invoices.view_details',
  file: 'accounting.invoices.view_details',
};

const ACTION_AUDIT_EVENTS = {
  approve: {
    type: 'invoice.approved',
    summary: 'Invoice approved',
    severity: 'info',
  },
  unapprove: {
    type: 'invoice.unapproved',
    summary: 'Invoice unapproved',
    severity: 'info',
  },
  discard: {
    type: 'invoice.discarded',
    summary: 'Invoice discarded',
    severity: 'warning',
  },
  review: {
    type: 'invoice.reviewed',
    summary: 'Invoice reviewed',
    severity: 'info',
  },
  file: {
    type: 'invoice.filed',
    summary: 'Invoice marked filed',
    severity: 'info',
  },
};

const ACTION_STATE_FIELDS = {
  approve: ['status', 'approved_at', 'approved_by', 'routing_code', 'phase_code', 'cost_type', 'gl_account', 'gl_date'],
  unapprove: ['status', 'approved_at', 'approved_by'],
  discard: ['status', 'discarded_at', 'discarded_by'],
  review: ['status', 'reviewed_at'],
  file: ['filed', 'filed_at'],
};

function getActorName(req, res) {
  return getRequestAuditActor(req, res).name || 'system';
}

function pickState(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

async function emitBulkInvoiceAuditEvent(req, res, action, id, row, changes) {
  const event = ACTION_AUDIT_EVENTS[action];
  if (!event) return;

  const { beforeState, afterState, ...auditChanges } = changes;
  await emitInvoiceAuditEvent(req, res, {
    ...event,
    invoiceId: id,
    row,
    changes: auditChanges,
    beforeState,
    afterState,
    undoable: action !== 'reject',
  });
}

function validateBulkApproval(row, effectiveRow, { duplicateStatus = null } = {}) {
  if (!['pending', 'modified', 'reviewed'].includes(row.status)) {
    return {
      error: `Cannot approve invoice while status is "${row.status}".`,
      code: 'INVALID_STATUS_TRANSITION',
    };
  }
  // Effective-values gate: the same row→codingDefaults merge the verdict
  // endpoint previews and single approve validates/persists.
  return validateApprovalEligibility(effectiveRow, { invoiceId: row.id, duplicateStatus });
}

async function approveBulkInvoice(id, now, actor) {
  return withTransaction(pool, async (db) => {
    const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
    if (result.rows.length === 0) return { notFound: true };

    const row = result.rows[0];
    const currentStatus = row.status;
    const { applied, effectiveRow } = getEffectiveCoding(row);
    // Duplicate blocker shares the single-approve evaluation (spec 2.4).
    const { evaluateDuplicateStatus } = require('./duplicateStatusService');
    const duplicateStatus = await evaluateDuplicateStatus(row, { db });
    const eligibility = validateBulkApproval(row, effectiveRow, { duplicateStatus });
    if (eligibility.error) {
      return {
        skipped: {
          id,
          invoiceNumber: row.invoice_number,
          ...eligibility,
        },
      };
    }

    const beforeState = pickState(row, ACTION_STATE_FIELDS.approve);
    const afterState = {
      ...beforeState,
      status: 'approved',
      approved_at: now,
      approved_by: actor,
      ...applied,
    };
    // BE-G: snapshot provenance for undo restore. beforeState ONLY — set after
    // afterState is built so the spread cannot leak it into checkStateMatch.
    beforeState.field_origins = row.field_origins ?? {};
    // Persist the approval plus the effective coding values the gate just
    // validated (fill-only — never overwrites a set column).
    const sets = ['status = $1', 'approved_at = $2', 'approved_by = $3', 'updated_at = $2'];
    const vals = ['approved', now, actor];
    const originPatch = {};
    let idx = 4;
    for (const [col, val] of Object.entries(applied)) {
      sets.push(`${col} = $${idx++}`);
      vals.push(val);
      row[col] = val;
      // BE-G: coding-default fills are server-derived — never manual.
      const camel = CODING_DEFAULT_ORIGIN_KEYS[col];
      if (camel) originPatch[camel] = { origin: 'derived', at: now, by: 'approval-defaults' };
    }
    let originClause = '';
    if (Object.keys(originPatch).length > 0) {
      vals.push(JSON.stringify(originPatch));
      originClause = `, field_origins = field_origins || $${vals.length}::jsonb`;
      idx += 1;
    }
    vals.push(id);
    const updateResult = await db.query(
      `UPDATE documents
         SET ${sets.join(', ')}${originClause}
         WHERE id = $${idx} AND status IN ('pending', 'modified', 'reviewed')`,
      vals
    );

    if (updateResult.rowCount === 0) {
      return {
        skipped: {
          id,
          invoiceNumber: row.invoice_number,
          error: `Cannot approve invoice while status is "${row.status}".`,
          code: 'INVALID_STATUS_TRANSITION',
        },
      };
    }

    const legacyChanges = {
      status: [currentStatus, 'approved'],
      ...(Object.keys(applied).length > 0 ? { appliedCodingDefaults: applied } : {}),
    };
    return {
      row,
      legacyChanges,
      changes: { ...legacyChanges, beforeState, afterState },
    };
  });
}

async function discardBulkInvoice(id, now, actor) {
  return withTransaction(pool, async (db) => {
    const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
    if (result.rows.length === 0) return { notFound: true };

    const row = result.rows[0];
    if (DISCARD_PROTECTED_STATUSES.has(row.status)) {
      return {
        skipped: {
          id,
          invoiceNumber: row.invoice_number,
          reason: `Cannot discard invoice while status is "${row.status}"`,
          code: row.status === 'submitted' ? 'INVALID_STATUS_TRANSITION' : 'TRANSIENT_STATUS',
        },
      };
    }

    const clearsLinkedWaiverShelf = row.classification === 'lien-waiver'
      && Boolean(row.linked_lien_waiver_id);
    const beforeState = pickState(
      row,
      clearsLinkedWaiverShelf
        ? [...ACTION_STATE_FIELDS.discard, 'filed', 'filed_at']
        : ACTION_STATE_FIELDS.discard
    );
    const updateResult = await db.query(
      `UPDATE documents
       SET status = $1,
           discarded_at = $2,
           discarded_by = $3,
           discard_source = 'manual',
           ${clearsLinkedWaiverShelf ? 'filed = false,\n           filed_at = NULL,' : ''}
           updated_at = $2
       WHERE id = $4 AND status <> ALL($5::text[])`,
      ['discarded', now, actor, id, [...DISCARD_PROTECTED_STATUSES]]
    );
    if (updateResult.rowCount === 0) {
      return {
        skipped: {
          id,
          invoiceNumber: row.invoice_number,
          reason: 'Cannot discard invoice because its status changed.',
          code: 'INVALID_STATUS_TRANSITION',
        },
      };
    }

    // Junk-cache hook: discarding an 'other'-classified IMAGE teaches the
    // pipeline's junk fingerprint cache. Best-effort, pool-based.
    await maybeCacheJunkFromDiscard(row);

    const legacyChanges = {
      status: [row.status, 'discarded'],
      ...(clearsLinkedWaiverShelf ? {
        filed: [row.filed === true, false],
        filedAt: [row.filed_at || null, null],
      } : {}),
    };
    return {
      row,
      legacyChanges,
      changes: {
        ...legacyChanges,
        beforeState,
        afterState: {
          ...beforeState,
          status: 'discarded',
          discarded_at: now,
          discarded_by: actor,
          ...(clearsLinkedWaiverShelf ? { filed: false, filed_at: null } : {}),
        },
      },
    };
  });
}

async function bulkAction(req, res) {
  try {
    const { ids, action } = req.body;
    if (!(action in ACTION_PERMISSIONS)) {
      return fail(res, 400, `Bulk action "${action}" is not supported. Reject must be performed per-invoice.`);
    }
    const requiredPerm = ACTION_PERMISSIONS[action];
    if (requiredPerm && !checkPermission(req, requiredPerm)) {
      return fail(res, 403, 'Forbidden');
    }

    const now = new Date().toISOString();
    const actor = getActorName(req, res);
    let updated = 0;
    const skipped = [];

    for (const id of ids) {
      if (action === 'approve') {
        const outcome = await approveBulkInvoice(id, now, actor);
        if (outcome.notFound) continue;
        if (outcome.skipped) {
          skipped.push(outcome.skipped);
          continue;
        }

        await audit(id, action, outcome.legacyChanges);
        await emitBulkInvoiceAuditEvent(req, res, action, id, outcome.row, outcome.changes);
        updated++;
        continue;
      }

      if (action === 'discard') {
        const outcome = await discardBulkInvoice(id, now, actor);
        if (outcome.notFound) continue;
        if (outcome.skipped) {
          skipped.push(outcome.skipped);
          continue;
        }

        await audit(id, action, outcome.legacyChanges);
        await emitBulkInvoiceAuditEvent(req, res, action, id, outcome.row, outcome.changes);
        updated++;
        continue;
      }

      const outcome = await withTransaction(pool, async (db) => {
        const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
        if (result.rows.length === 0) return { notFound: true };

        const row = result.rows[0];
        const currentStatus = row.status;
        const beforeState = pickState(row, ACTION_STATE_FIELDS[action] || ['status']);
        let newStatus;
        let afterState;

        if (action === 'unapprove') {
          if (currentStatus !== 'approved' && currentStatus !== 'modified') return { skipped: true };
          newStatus = 'pending';
          afterState = {
            ...beforeState,
            status: 'pending',
            approved_at: null,
            approved_by: null,
          };
        } else if (action === 'review') {
          newStatus = 'reviewed';
          afterState = {
            ...beforeState,
            status: 'reviewed',
            reviewed_at: now,
          };
        } else if (action === 'file') {
          if (row.filed) return { skipped: true };
          await db.query('UPDATE documents SET filed = true, filed_at = $1, updated_at = $1 WHERE id = $2', [now, id]);
          const legacyChanges = { filed: [row.filed || false, true] };
          return {
            row,
            legacyChanges,
            changes: {
              ...legacyChanges,
              beforeState,
              afterState: { filed: true, filed_at: now },
            },
          };
        } else {
          // Unreachable: action allowlist is enforced above.
          return { skipped: true };
        }

        const legacyChanges = { status: [currentStatus, newStatus] };
        const changes = { ...legacyChanges, beforeState, afterState };
        if (action === 'unapprove') {
          await db.query(
            'UPDATE documents SET status = $1, approved_at = NULL, approved_by = NULL, updated_at = $2 WHERE id = $3',
            [newStatus, now, id]
          );
        } else if (action === 'review') {
          await db.query(
            'UPDATE documents SET status = $1, reviewed_at = $2, updated_at = $2 WHERE id = $3',
            [newStatus, now, id]
          );
        }
        return { row, legacyChanges, changes };
      });
      if (outcome.notFound || outcome.skipped) continue;

      const { row, legacyChanges, changes } = outcome;
      if (action === 'file') await audit(id, 'filed', legacyChanges);
      else await audit(id, action, legacyChanges);
      await emitBulkInvoiceAuditEvent(req, res, action, id, row, changes);
      updated++;
    }

    const response = {
      updated,
      ...(skipped.length > 0 ? {
        skipped: skipped.length,
        skippedInvoices: skipped,
        message: `${skipped.length} invoice(s) skipped due to missing required fields`,
      } : {}),
    };
    if (action === 'discard' && ids.length > 0 && skipped.length === ids.length) {
      return res.status(409).json(errorBody(
        'No invoices could be discarded.',
        'BULK_ACTION_SKIPPED',
        response
      ));
    }
    return res.json(response);
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/bulk');
  }
}

module.exports = {
  ACTION_PERMISSIONS,
  bulkAction,
  validateBulkApproval,
};
