'use strict';

const { safeError } = require('../../../middleware/errorResponse');
const { canonicalizeErrorBody, errorBody } = require('../../../lib/response');
const {
  checkStateMatch,
  emitInvoiceAuditEvent,
  findUndoableAction,
  getRequestAuditActor,
  markActionUndone,
} = require('../../../lib/auditEvents');
const { pool, audit, rowToDoc, getWaiverActionSerializationOptions } = require('./supabase');
const { TRANSIENT_STATUSES } = require('./statusConstants');
const { withTransaction } = require('./transaction');
const { buildApprovalState } = require('./approvalStateService');
const {
  matchSubcontract,
  recordJobFeedback,
  recordSubcontractFeedback,
  recordVendorFeedback,
  recordSubjectJobFeedback,
  recordSenderJobFeedback,
} = require('./matcher');
const { VENDORS_PATH } = require('../../../config');

const FIELD_MAP = {
  vendorCode: 'vendor_code',
  jobNumber: 'job_match_number',
  subcontractNumber: 'subcontract_number',
  amount: 'amount',
  invoiceNumber: 'invoice_number',
  invoiceDate: 'invoice_date',
  dueDate: 'due_date',
  description: 'description',
  notes: 'description',
  classification: 'classification',
  displayName: 'display_name',
  lienWaiverStatus: 'lien_waiver_status',
  vendorName: 'vendor_name',
  projectName: 'project_name',
  routingCode: 'routing_code',
  phaseCode: 'phase_code',
  costType: 'cost_type',
  glAccount: 'gl_account',
  glDate: 'gl_date',
  lienWaiverRequired: 'lien_waiver_required',
  waiverType: 'waiver_type',
};

const DATE_COLUMNS = new Set(['invoice_date', 'due_date', 'gl_date']);
const ACTIVITY_DEFAULTED_CODING_FIELDS = new Set([
  'routingCode',
  'phaseCode',
  'glAccount',
  'costType',
]);

// phase_allocations / multi_phase_candidate are not directly editable but are
// invalidated/recomputed when subcontract_number changes, so unedit must be
// able to restore them. field_origins is snapshotted into beforeState on every
// origin-stamping edit so unedit restores provenance along with the values.
const EDITABLE_COLUMNS = new Set([...Object.values(FIELD_MAP), 'was_modified', 'phase_allocations', 'multi_phase_candidate', 'field_origins']);
const FINANCIAL_EDITABLE_FIELDS = new Set(['amount', 'invoiceNumber', 'vendorCode']);
const FINANCIAL_EDITABLE_COLUMNS = new Set(['amount', 'invoice_number', 'vendor_code']);
const FINANCIAL_FIELD_NAMES = {
  amount: 'amount',
  invoice_number: 'invoiceNumber',
  vendor_code: 'vendorCode',
};

// Fields that can be edited even when the invoice is approved.
// Limited to submission mechanics (allocation, dates, notes) that don't
// change the financial substance reviewed during approval.
// Amount and invoiceNumber require unapproving first.
const APPROVED_EDITABLE_FIELDS = new Set([
  'invoiceDate', 'dueDate',
  'routingCode', 'phaseCode', 'costType', 'glAccount', 'glDate',
  'notes', 'description',
]);

function getActorName(req, res) {
  return getRequestAuditActor(req, res).name || 'system';
}

function actionMetadata(event, type, undoEndpoint) {
  return {
    actionId: event.id,
    type,
    undoable: Boolean(undoEndpoint),
    ...(undoEndpoint ? { undoEndpoint } : {}),
  };
}

function sendStateChanged(res, actionId, stateCheck) {
  return res.status(409).json(errorBody(
    'Document was modified since your action. Undo is no longer safe.',
    'STATE_CHANGED_SINCE_ACTION',
    { actionId, staleFields: stateCheck.staleFields }
  ));
}

function makeJsonResponse(body, statusCode = 200) {
  return { statusCode, body: canonicalizeErrorBody(body) };
}

function sendJsonOutcome(res, outcome) {
  const body = canonicalizeErrorBody(outcome.body);
  return outcome.statusCode && outcome.statusCode !== 200
    ? res.status(outcome.statusCode).json(body)
    : res.json(body);
}

function buildInvoiceUpdate(row, body) {
  const changes = {};
  const beforeState = {};
  const afterState = {};
  const sets = [];
  const vals = [];
  let idx = 1;

  for (const [camel, col] of Object.entries(FIELD_MAP)) {
    if (camel in body) {
      const oldVal = row[col];
      let newVal = body[camel];
      // Postgres rejects '' for date columns — treat cleared dates as NULL.
      if (DATE_COLUMNS.has(col) && typeof newVal === 'string' && newVal.trim() === '') {
        newVal = null;
      }
      if (String(oldVal) !== String(newVal)) changes[camel] = [oldVal, newVal];
      beforeState[col] = oldVal ?? null;
      afterState[col] = newVal ?? null;
      sets.push(`${col} = $${idx++}`);
      vals.push(newVal);
    }
  }

  return { afterState, beforeState, changes, sets, vals, idx };
}

function isBlankCodingValue(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

// Activity should describe the coding value the editor was served, but undo and
// legacy audit history must continue to reflect the persisted document state.
function buildActivityChanges(changes, row, codingDefaults) {
  let activityChanges = changes;
  for (const [field, change] of Object.entries(changes)) {
    if (!ACTIVITY_DEFAULTED_CODING_FIELDS.has(field) || !isBlankCodingValue(row[FIELD_MAP[field]])) continue;
    const defaultValue = codingDefaults?.[field];
    if (isBlankCodingValue(defaultValue)) continue;
    if (activityChanges === changes) activityChanges = { ...changes };
    activityChanges[field] = [defaultValue, change[1]];
  }
  return activityChanges;
}

function recordEditFeedback(req, row) {
  if ('vendorCode' in req.body && req.body.vendorCode !== row.vendor_code) {
    try {
      recordVendorFeedback({
        email: row.email_from || '',
        name: row.vendor_name || '',
        vendorCode: req.body.vendorCode,
        vendorName: row.vendor_name || '',
      });
    } catch (err) {
      req.log.warn({
        operation: 'invoice.edit.record_vendor_feedback',
        context: { invoiceId: req.params.id },
        error: err && err.message ? err.message : String(err),
        err,
      }, 'recordVendorFeedback failed');
    }
  }

  // Only HUMAN subcontract choices are learned: server-derived writes would
  // re-record what the file already says, and clears (derived or manual "×")
  // must never cache a null for the (vendor, job) pair — a null cache hit
  // would permanently block derivation for every future invoice on the pair.
  if ('subcontractNumber' in req.body && !req._derivedSubcontract
      && req.body.subcontractNumber && req.body.subcontractNumber !== row.subcontract_number) {
    try {
      recordSubcontractFeedback({
        vendorCode: req.body.vendorCode || row.vendor_code || '',
        jobNumber: req.body.jobNumber || row.job_match_number || '',
        subcontractNumber: req.body.subcontractNumber,
      });
    } catch (err) {
      req.log.warn({
        operation: 'invoice.edit.record_subcontract_feedback',
        context: { invoiceId: req.params.id },
        error: err && err.message ? err.message : String(err),
        err,
      }, 'recordSubcontractFeedback failed');
    }
  }

  if ('jobNumber' in req.body && req.body.jobNumber !== row.job_match_number) {
    const address = row.project_address || row.vendor_address || '';
    if (address && req.body.jobNumber) {
      try {
        recordJobFeedback({
          vendorCode: req.body.vendorCode || row.vendor_code || '',
          address,
          jobNumber: req.body.jobNumber,
        });
      } catch (err) {
        req.log.warn({
          operation: 'invoice.edit.record_job_feedback',
          context: { invoiceId: req.params.id },
          error: err && err.message ? err.message : String(err),
          err,
        }, 'recordJobFeedback failed');
      }
    }

    // Subject-based job feedback (works even without address)
    if (req.body.jobNumber && row.email_subject) {
      try {
        recordSubjectJobFeedback({
          vendorCode: req.body.vendorCode || row.vendor_code || '',
          emailSubject: row.email_subject,
          jobNumber: req.body.jobNumber,
        });
      } catch (err) {
        req.log.warn({ err }, 'recordSubjectJobFeedback failed');
      }
    }

    // Sender-based job feedback
    if (req.body.jobNumber && row.email_from) {
      try {
        recordSenderJobFeedback({
          vendorCode: req.body.vendorCode || row.vendor_code || '',
          senderEmail: row.email_from,
          jobNumber: req.body.jobNumber,
        });
      } catch (err) {
        req.log.warn({ err }, 'recordSenderJobFeedback failed');
      }
    }
  }
}

async function updateInvoice(req, res) {
  try {
    // Classification writes must use an existing active type — same invariant
    // as POST /:id/reclassify. New types are only created explicitly via
    // POST /api/classifications.
    if ('classification' in req.body) {
      const { normalizeClassificationName } = require('./pipeline');
      const { getActiveClassificationNames } = require('../routes/settings');
      const normalized = normalizeClassificationName(req.body.classification);
      const activeNames = await getActiveClassificationNames();
      if (!activeNames.has(normalized)) {
        return res.status(400).json(errorBody(
          `Unknown or inactive classification: ${normalized}`,
          'INVALID_CLASSIFICATION'
        ));
      }
      req.body.classification = normalized;
    }

    // Waived/invoice amount semantics: null clears; a number or numeric string
    // persists; a non-numeric string / NaN / non-finite value is REJECTED with a
    // canonical 422 (row unchanged) — never coerced, stripped, or written raw.
    if ('amount' in req.body) {
      const rawAmount = req.body.amount;
      const validAmount = rawAmount === null
        || (typeof rawAmount === 'number' && Number.isFinite(rawAmount))
        || (typeof rawAmount === 'string' && rawAmount.trim() !== '' && Number.isFinite(Number(rawAmount)));
      if (!validAmount) {
        return res.status(422).json(errorBody(
          'Invalid amount: provide a number, a numeric string, or null to clear',
          'INVALID_AMOUNT'
        ));
      }
    }

    const requestedFields = Object.keys(req.body);
    const financialFields = requestedFields.filter((field) => FINANCIAL_EDITABLE_FIELDS.has(field));
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      if (row.status === 'approved') {
        const disallowed = requestedFields.filter((f) => !APPROVED_EDITABLE_FIELDS.has(f));
        if (disallowed.length > 0) {
          return makeJsonResponse({
              error: `Cannot edit ${disallowed.join(', ')} on an approved invoice. Unapprove first.`,
              code: 'APPROVED_LOCKED',
              lockedFields: disallowed,
          }, 409);
        }
      }
      if (TRANSIENT_STATUSES.has(row.status)) {
        return makeJsonResponse({
            error: `Cannot edit invoice while status is "${row.status}".`,
            code: 'TRANSIENT_STATUS',
        }, 409);
      }
      if (
        'classification' in req.body
        && req.body.classification !== row.classification
        && row.linked_lien_waiver_id
      ) {
        return makeJsonResponse({
          error: 'Unlink the lien waiver before changing this document classification.',
          code: 'WAIVER_LINKED_CLASSIFICATION_PROTECTED',
        }, 409);
      }
      if (row.status === 'submitted' && financialFields.length > 0) {
        return makeJsonResponse({
            error: `Cannot edit ${financialFields.join(', ')} on a submitted invoice.`,
            code: 'SUBMITTED_FINANCIAL_LOCKED',
            lockedFields: financialFields,
        }, 409);
      }

      // Match-time routing (PM-else-D): manually assigning a job to a row
      // without a routing code derives and persists routing in the same edit.
      // Never overwrites an existing or explicitly provided routing code.
      const routingUnset = row.routing_code == null || String(row.routing_code).trim() === '';
      if ('jobNumber' in req.body && req.body.jobNumber && !('routingCode' in req.body) && routingUnset) {
        try {
          const { deriveRoutingCode } = require('./submitRouting');
          const derivedRouting = deriveRoutingCode(req.body.jobNumber);
          if (derivedRouting) req.body.routingCode = derivedRouting;
        } catch (deriveErr) {
          req.log?.warn?.({ err: deriveErr }, 'Routing derivation on job edit failed (non-fatal)');
        }
      }

      // Server-derived subcontract (owner ruling 2026-08-05): (vendor, job)
      // determines the subcontract — the client never selects one on a
      // vendor/job edit. Unique match → attach; none → clear (direct-to-job,
      // e.g. dumpsters or no sub written); ambiguous → clear and report
      // options so the UI can offer a picker. An EXPLICIT subcontractNumber
      // in the body (picker choice / manual clear) always wins.
      let subcontractDerivation = null;
      if (('vendorCode' in req.body || 'jobNumber' in req.body) && !('subcontractNumber' in req.body)) {
        const effVendor = 'vendorCode' in req.body ? req.body.vendorCode : row.vendor_code;
        const effJob = 'jobNumber' in req.body ? req.body.jobNumber : row.job_match_number;
        try {
          const derivation = await matchSubcontract(effVendor || '', effJob || '');
          const currentSub = row.subcontract_number || null;
          const derivedSub = derivation.subcontractNumber || null;
          // Ambiguous pair whose current sub is already a valid option: keep it
          // (re-selecting the same vendor must not wipe a prior picker choice).
          const keepCurrent = derivation.method === 'ambiguous'
            && Array.isArray(derivation.options)
            && derivation.options.some((opt) => opt.number === currentSub);
          if (!keepCurrent && derivedSub !== currentSub) {
            req.body.subcontractNumber = derivedSub;
            req._derivedSubcontract = true;
          }
          subcontractDerivation = {
            method: derivation.method,
            subcontractNumber: keepCurrent ? currentSub : derivedSub,
            ...(derivation.options ? { options: derivation.options } : {}),
          };
        } catch (deriveErr) {
          req.log?.warn?.({ err: deriveErr }, 'Subcontract derivation on vendor/job edit failed (sub left untouched)');
        }
      }

      const { afterState, beforeState, changes, sets, vals } = buildInvoiceUpdate(row, req.body);
      if (sets.length === 0) return { row, updatedRow: row, noChanges: true, subcontractDerivation };
      const activityCodingDefaults = buildApprovalState(
        row,
        { invoiceId: req.params.id, log: req.log }
      ).codingDefaults;

      // Vendor code change → sync both name columns to the Spectrum canonical
      // name so the list view (matched_vendor_name) and detail view
      // (vendor_name) always agree.
      const extraDerivedOriginFields = [];
      if (changes.vendorCode && req.body.vendorCode) {
        try {
          const fs = require('fs');
          const raw = JSON.parse(fs.readFileSync(VENDORS_PATH, 'utf8'));
          const vendors = Array.isArray(raw) ? raw : raw?.Vendors || [];
          const entry = vendors.find((v) => String(v?.Vendor_Code || '').trim() === req.body.vendorCode);
          const spectrumName = entry ? String(entry.Name || '').trim() : null;
          if (spectrumName) {
            vals.push(spectrumName);
            sets.push(`vendor_name = $${vals.length}`);
            vals.push(spectrumName);
            sets.push(`matched_vendor_name = $${vals.length}`);
            extraDerivedOriginFields.push('vendorName');
          }
        } catch (lookupErr) {
          req.log?.warn?.({ err: lookupErr }, 'Vendor name lookup on code edit failed (names left unchanged)');
        }
      }

      // Subcontract change invalidates phase state: old allocations reference
      // the old sub's phases, and multi_phase_candidate was computed for the
      // old sub. Clear allocations and recompute the flag from the NEW sub's
      // actual phase count so the approval verdict stays honest (a stale
      // true-flag hard-blocks approval on a genuinely single-phase sub).
      if (changes.subcontractNumber) {
        let isMultiPhase = false;
        if (req.body.subcontractNumber) {
          try {
            const { getSubcontractPhaseInfo } = require('./matcher');
            const phaseInfo = getSubcontractPhaseInfo(req.body.subcontractNumber);
            isMultiPhase = Boolean(phaseInfo && phaseInfo.isMultiPhase);
          } catch (phaseErr) {
            req.log?.warn?.({ err: phaseErr }, 'Phase recompute on subcontract edit failed (flag set false)');
          }
        }
        beforeState.phase_allocations = row.phase_allocations ?? null;
        afterState.phase_allocations = null;
        vals.push(null);
        sets.push(`phase_allocations = $${vals.length}`);
        beforeState.multi_phase_candidate = row.multi_phase_candidate || false;
        afterState.multi_phase_candidate = isMultiPhase;
        vals.push(isMultiPhase);
        sets.push(`multi_phase_candidate = $${vals.length}`);
        if (row.phase_allocations != null) changes.phaseAllocations = [row.phase_allocations, null];
        if (Boolean(row.multi_phase_candidate) !== isMultiPhase) {
          changes.multiPhaseCandidate = [Boolean(row.multi_phase_candidate), isMultiPhase];
        }
      }

      beforeState.was_modified = row.was_modified || false;
      afterState.was_modified = true;

      // BE-G persistent per-field origin: requestedFields was captured BEFORE
      // the in-transaction derivations mutate req.body, so it is the ground
      // truth for what the client explicitly sent. Any other key in `changes`
      // (derived routing/subcontract, phase invalidation) plus the vendor-name
      // sync was server-derived in this same edit and must never read as
      // manual. Origins ride the same UPDATE so provenance is atomic with the
      // accepted values. field_origins goes into beforeState ONLY (restore
      // path) — never afterState, whose keys drive checkStateMatch.
      const originPatch = {};
      const originAt = new Date().toISOString();
      const originActor = getActorName(req, res);
      for (const camel of Object.keys(changes)) {
        originPatch[camel] = {
          origin: requestedFields.includes(camel) ? 'manual' : 'derived',
          at: originAt,
          by: originActor,
        };
      }
      for (const camel of extraDerivedOriginFields) {
        originPatch[camel] = { origin: 'derived', at: originAt, by: originActor };
      }
      if (Object.keys(originPatch).length > 0) {
        beforeState.field_origins = row.field_origins ?? {};
        vals.push(JSON.stringify(originPatch));
        sets.push(`field_origins = field_origins || $${vals.length}::jsonb`);
      }

      let idx = vals.length + 1;
      sets.push(`was_modified = $${idx++}`);
      vals.push(true);
      sets.push(`updated_at = $${idx++}`);
      vals.push(new Date().toISOString());

      if (row.submit_error) {
        sets.push(`submit_error = $${idx++}`);
        vals.push(null);
      }

      const whereClauses = [`id = $${idx++}`, `status <> ALL($${idx++}::text[])`];
      vals.push(req.params.id, [...TRANSIENT_STATUSES]);
      if (financialFields.length > 0) {
        whereClauses.push(`status <> $${idx++}`);
        vals.push('submitted');
      }
      const updateResult = await db.query(
        `UPDATE documents SET ${sets.join(', ')} WHERE ${whereClauses.join(' AND ')}`,
        vals
      );
      if (updateResult.rowCount === 0) {
        return makeJsonResponse({
            error: 'Cannot edit invoice because its status changed.',
            code: 'INVALID_STATUS_TRANSITION',
        }, 409);
      }

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return {
        row,
        updatedRow: updated.rows[0],
        afterState,
        beforeState,
        changes,
        activityCodingDefaults,
        subcontractDerivation,
      };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);
    if (outcome.noChanges) return res.json({
      invoice: rowToDoc(outcome.row, getWaiverActionSerializationOptions(req)),
      action: null,
      approvalVerdict: buildApprovalState(outcome.row, { invoiceId: req.params.id, log: req.log }),
      ...(outcome.subcontractDerivation ? { subcontractDerivation: outcome.subcontractDerivation } : {}),
    });

    const { row, updatedRow, afterState, beforeState, changes, activityCodingDefaults } = outcome;
    await audit(req.params.id, 'edited', changes);
    recordEditFeedback(req, row);

    // Targeted re-match: when vendor/job is corrected, re-run matcher on other
    // pending docs from the same vendor (async, fire-and-forget so the edit
    // response isn't delayed)
    if ('jobNumber' in req.body || 'vendorCode' in req.body) {
      const targetVendor = req.body.vendorCode || row.vendor_code;
      if (targetVendor) {
        const { rematchVendorPending } = require('./rematch');
        rematchVendorPending(targetVendor).then(result => {
          if (result.improved > 0) {
            req.log.info({ vendor: targetVendor, improved: result.improved, total: result.total }, 'Targeted re-match updated pending invoices');
          }
        }).catch(err => {
          req.log.warn({ err, vendor: targetVendor }, 'Targeted re-match failed');
        });
      }
    }

    // Vendor assignment unlocks vendor-scoped rules: re-run the rules engine
    // in fill-only mode (empty coding fields only — gl/phase/cost/routing/job;
    // never status/notes/flagged) so the edit itself can't discard or overwrite
    // the user's explicit choices. Awaited so the response reflects the fills.
    if ('vendorCode' in changes) {
      try {
        const { applyRulesToDocumentById } = require('./rulesApplyService');
        const rulesOutcome = await applyRulesToDocumentById(req.params.id, { fillOnly: true });
        if (rulesOutcome.applied.length > 0) {
          req.log?.info?.({ invoiceId: req.params.id, patches: rulesOutcome.patches }, 'Rules re-applied after vendor edit');
        }
      } catch (rulesErr) {
        req.log?.warn?.({ err: rulesErr }, 'Rules re-run after vendor edit failed (non-fatal)');
      }
    }

    // Statement docs: vendor assignment unlocks line matching (Toolbox +
    // Spectrum lookups are vendor-scoped). Re-match lines automatically so
    // the user doesn't need a second manual step after categorizing.
    let statementRematch = null;
    if (row.classification === 'statement' && 'vendorCode' in changes) {
      try {
        const { rematchStatementLinesForDocument } = require('./statementLineService');
        statementRematch = await rematchStatementLinesForDocument(req.params.id);
        if (statementRematch && statementRematch.statusChanges.length > 0) {
          await audit(req.params.id, 'statement-lines-rematched', {
            changes: statementRematch.statusChanges,
            trigger: 'vendor-assigned',
          }, getActorName(req, res));
        }
      } catch (rematchErr) {
        req.log?.warn?.({ err: rematchErr }, 'Auto-rematch after vendor assignment failed (non-fatal)');
      }
    }

    const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    const activityChanges = buildActivityChanges(
      changes,
      row,
      activityCodingDefaults
    );
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.edited',
      invoiceId: req.params.id,
      row,
      changes: activityChanges,
      beforeState,
      afterState,
      undoable: true,
      summary: 'Invoice edited',
      severity: 'info',
    });

    const invoice = rowToDoc(updated.rows[0], getWaiverActionSerializationOptions(req));
    res.json({
      invoice,
      action: actionMetadata(event, 'edit', `/api/invoices/${req.params.id}/unedit`),
      approvalVerdict: buildApprovalState(updated.rows[0], { invoiceId: req.params.id, log: req.log }),
      ...(outcome.subcontractDerivation ? { subcontractDerivation: outcome.subcontractDerivation } : {}),
      ...(row.classification === 'statement' && 'vendorCode' in changes ? {
        statementLines: invoice.statementLines || [],
        statusChanges: statementRematch?.statusChanges || [],
      } : {}),
    });
  } catch (err) {
    return safeError(res, err, 'PATCH /api/invoices/:id');
  }
}

function buildRestoreEditUpdate(beforeState) {
  const values = [];
  const sets = [];
  for (const [field, value] of Object.entries(beforeState || {})) {
    if (!EDITABLE_COLUMNS.has(field)) continue;
    values.push(value);
    sets.push(`${field} = $${values.length}`);
  }

  values.push(new Date().toISOString());
  sets.push(`updated_at = $${values.length}`);
  return { sets, values };
}

async function uneditInvoice(req, res) {
  try {
    const action = await findUndoableAction(req.params.id, 'invoice.edited');
    if (!action) {
      return res.status(404).json(errorBody('Undo action not found', 'ACTION_NOT_FOUND'));
    }

    const restoredFinancialFields = Object.keys(action.beforeState || {})
      .filter((field) => FINANCIAL_EDITABLE_COLUMNS.has(field))
      .map((field) => FINANCIAL_FIELD_NAMES[field]);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return makeJsonResponse({ error: 'Invoice not found' }, 404);

      const row = result.rows[0];
      const stateCheck = checkStateMatch(row, action.afterState);
      if (!stateCheck.match) return makeJsonResponse({
        error: 'Document was modified since your action. Undo is no longer safe.',
        code: 'STATE_CHANGED_SINCE_ACTION',
        actionId: action.id,
        staleFields: stateCheck.staleFields,
      }, 409);
      if (TRANSIENT_STATUSES.has(row.status)) {
        return makeJsonResponse({
          error: `Cannot edit invoice while status is "${row.status}".`,
          code: 'TRANSIENT_STATUS',
        }, 409);
      }
      if (row.status === 'submitted' && restoredFinancialFields.length > 0) {
        return makeJsonResponse({
          error: `Cannot restore ${restoredFinancialFields.join(', ')} on a submitted invoice.`,
          code: 'SUBMITTED_FINANCIAL_LOCKED',
          lockedFields: restoredFinancialFields,
        }, 409);
      }

      const beforeState = Object.fromEntries(
        Object.keys(action.beforeState || {}).map((field) => [field, row[field] ?? null])
      );
      const { sets, values } = buildRestoreEditUpdate(action.beforeState);
      if (sets.length === 1) return { row, noChanges: true };

      const whereClauses = [`id = $${values.length + 1}`, `status <> ALL($${values.length + 2}::text[])`];
      values.push(req.params.id, [...TRANSIENT_STATUSES]);
      if (restoredFinancialFields.length > 0) {
        whereClauses.push(`status <> $${values.length + 1}`);
        values.push('submitted');
      }
      const updateResult = await db.query(
        `UPDATE documents SET ${sets.join(', ')} WHERE ${whereClauses.join(' AND ')}`,
        values
      );
      if (updateResult.rowCount === 0) {
        return makeJsonResponse({
          error: 'Cannot undo edit because its status changed.',
          code: 'INVALID_STATUS_TRANSITION',
        }, 409);
      }
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, beforeState, updatedRow: updated.rows[0] };
    });

    if (outcome.body) return sendJsonOutcome(res, outcome);
    if (outcome.noChanges) return res.json({ invoice: rowToDoc(outcome.row, getWaiverActionSerializationOptions(req)) });

    const { row, beforeState, updatedRow } = outcome;
    await markActionUndone(action.id, getActorName(req, res));
    await audit(req.params.id, 'unedited', { restoredFields: Object.keys(action.beforeState || {}) });

    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.unedited',
      invoiceId: req.params.id,
      row,
      changes: { restoredFields: Object.keys(action.beforeState || {}) },
      beforeState,
      afterState: action.beforeState || {},
      undoable: true,
      summary: 'Invoice edit undone',
      severity: 'info',
    });

    res.json({
      invoice: rowToDoc(updatedRow, getWaiverActionSerializationOptions(req)),
      action: actionMetadata(event, 'unedit', `/api/invoices/${req.params.id}/actions/${event.id}/undo`),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/unedit');
  }
}

module.exports = {
  FIELD_MAP,
  uneditInvoice,
  updateInvoice,
};
