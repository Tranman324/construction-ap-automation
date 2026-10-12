'use strict';

const { fail, safeError } = require('../../../middleware/errorResponse');
const { pool, audit } = require('./supabase');
const { withTransaction } = require('./transaction');

// Cent tolerance: allocations must sum to the invoice total to the cent. Mirrors
// the frontend `Math.abs(remaining) < 0.01` balanced rule (MultiPhaseAllocationPanel);
// the backend value is canonical. Compared in integer cents to avoid FP drift.
const ALLOCATION_TOLERANCE_CENTS = 1;

// Collect ALL per-line problems (does not early-return) so the 422 can report
// per-line details. Returns the validated rows + line errors + running total.
function collectAllocations(allocations, phasesByCode, subcontractNumber) {
  const validated = [];
  const lineErrors = [];
  let totalAllocated = 0;
  const seenPhases = new Set();

  allocations.forEach((allocation, index) => {
    const line = index + 1;
    if (!allocation || typeof allocation !== 'object') {
      lineErrors.push({ line, error: 'Allocation is not an object' });
      return;
    }
    const phaseCode = (allocation.phase_code || '').trim();
    if (!phaseCode) {
      lineErrors.push({ line, error: 'Missing phase_code' });
      return;
    }
    const phaseRow = phasesByCode.get(phaseCode);
    if (!phaseRow) {
      lineErrors.push({ line, phase_code: phaseCode, error: `Phase '${phaseCode}' is not on subcontract ${subcontractNumber}` });
      return;
    }
    if (seenPhases.has(phaseCode)) {
      lineErrors.push({ line, phase_code: phaseCode, error: `Phase ${phaseCode} is allocated more than once` });
      return;
    }
    seenPhases.add(phaseCode);
    const amount = Number(allocation.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      lineErrors.push({ line, phase_code: phaseCode, error: `Amount must be a positive number, got ${allocation.amount}` });
      return;
    }
    totalAllocated += amount;
    validated.push({
      phase_code: phaseCode,
      cost_type: phaseRow.cost_type,
      amount: Math.round(amount * 100) / 100,
      description: (allocation.description || phaseRow.description || '').slice(0, 200),
    });
  });

  return { validated, lineErrors, totalAllocated };
}

function checkAllocationTotal(invoiceAmount, totalAllocated) {
  const invoiceTotal = Number(invoiceAmount);
  if (!Number.isFinite(invoiceTotal)) {
    return { error: 'Invoice has no amount set — cannot validate allocation total' };
  }
  const invoiceCents = Math.round(invoiceTotal * 100);
  const allocatedCents = Math.round(totalAllocated * 100);
  if (Math.abs(allocatedCents - invoiceCents) >= ALLOCATION_TOLERANCE_CENTS) {
    const allocatedRounded = allocatedCents / 100;
    const invoiceRounded = invoiceCents / 100;
    return {
      error: `Sum of allocations ($${allocatedRounded.toFixed(2)}) must equal invoice total ($${invoiceRounded.toFixed(2)}). Difference: $${((allocatedCents - invoiceCents) / 100).toFixed(2)}`,
    };
  }
  return { invoiceTotalRounded: invoiceCents / 100, totalAllocatedRounded: allocatedCents / 100 };
}

/**
 * Chokepoint for persisting phase allocations. This is the ONLY writer of
 * documents.phase_allocations (verified by inventory), so validation here covers
 * every path. Validation runs on a locked read inside a transaction: an invalid
 * allocation set (bad line, negative/zero amount, unknown phase, duplicate phase,
 * or sum != invoice within a cent) is rejected 422 with per-line details and NO
 * write occurs — the row is unchanged.
 */
async function updatePhaseAllocations(req, res) {
  try {
    const { allocations } = req.body || {};

    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query(
        'SELECT id, subcontract_number, amount, multi_phase_candidate FROM documents WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (result.rows.length === 0) return { notFound: true };
      const row = result.rows[0];

      // Clear. Also recompute multi_phase_candidate from the sub's actual
      // phase count: the save path forces the flag true, so clearing on a
      // genuinely single-phase sub would otherwise strand the row with
      // flag=true + no allocations = permanent approval blocker.
      if (allocations === null || (Array.isArray(allocations) && allocations.length === 0)) {
        let isMultiPhase = false;
        if (row.subcontract_number) {
          const { getSubcontractPhaseInfo } = require('./matcher');
          const phaseInfo = getSubcontractPhaseInfo(row.subcontract_number);
          isMultiPhase = Boolean(phaseInfo && phaseInfo.isMultiPhase);
        }
        await db.query(
          'UPDATE documents SET phase_allocations = NULL, multi_phase_candidate = $2, updated_at = NOW() WHERE id = $1',
          [req.params.id, isMultiPhase]
        );
        return { cleared: true };
      }

      if (!Array.isArray(allocations)) return { badRequest: 'allocations must be an array (or null to clear)' };
      if (!row.subcontract_number) return { badRequest: 'Invoice has no matched subcontract — cannot allocate to phases' };

      const { getSubcontractPhaseInfo } = require('./matcher');
      const phaseInfo = getSubcontractPhaseInfo(row.subcontract_number);
      if (!phaseInfo) return { subNotFound: row.subcontract_number };

      const phasesByCode = new Map(phaseInfo.phases.map((phase) => [phase.phase_code, phase]));
      const { validated, lineErrors, totalAllocated } = collectAllocations(allocations, phasesByCode, row.subcontract_number);
      const totalCheck = checkAllocationTotal(row.amount, totalAllocated);

      // Reject BEFORE any write — row unchanged.
      if (lineErrors.length > 0 || totalCheck.error) {
        return { invalid: { lines: lineErrors, total: totalCheck.error || null } };
      }

      await db.query(
        `UPDATE documents
         SET phase_allocations = $1,
             multi_phase_candidate = true,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(validated), req.params.id]
      );
      return {
        saved: {
          validated,
          subcontractNumber: row.subcontract_number,
          invoiceTotalRounded: totalCheck.invoiceTotalRounded,
          totalAllocatedRounded: totalCheck.totalAllocatedRounded,
        },
      };
    });

    if (outcome.notFound) return fail(res, 404, 'Invoice not found');
    if (outcome.badRequest) return fail(res, 400, outcome.badRequest);
    if (outcome.subNotFound) return fail(res, 404, `Subcontract ${outcome.subNotFound} not found in Spectrum data`);
    if (outcome.invalid) {
      return fail(res, 422, 'Invalid phase allocation', {
        code: 'INVALID_PHASE_ALLOCATION',
        lines: outcome.invalid.lines,
        total: outcome.invalid.total,
      });
    }

    if (outcome.cleared) {
      await audit(req.params.id, 'phase-allocations-cleared', {});
      return res.json({ id: req.params.id, phaseAllocations: null, message: 'Phase allocations cleared' });
    }

    const { validated, subcontractNumber, invoiceTotalRounded, totalAllocatedRounded } = outcome.saved;
    await audit(req.params.id, 'phase-allocations-set', {
      allocationCount: validated.length,
      phases: validated.map((allocation) => ({ phase: allocation.phase_code, amount: allocation.amount })),
      total: totalAllocatedRounded,
    });
    return res.json({
      id: req.params.id,
      subcontractNumber,
      invoiceTotal: invoiceTotalRounded,
      allocationTotal: totalAllocatedRounded,
      phaseAllocations: validated,
      message: `Allocated $${totalAllocatedRounded.toFixed(2)} across ${validated.length} phase${validated.length === 1 ? '' : 's'}`,
    });
  } catch (err) {
    return safeError(res, err, 'PATCH /api/invoices/:id/phase-allocations');
  }
}

module.exports = {
  updatePhaseAllocations,
};
