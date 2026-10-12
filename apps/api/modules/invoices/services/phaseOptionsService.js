'use strict';

const { JOBS_PATH, ROUTING_CODES_PATH } = require('../../../config');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { readJSON } = require('./utils');
const { pool } = require('./supabase');

function parseCurrentAllocations(row) {
  if (!row.phase_allocations) return null;
  try {
    return typeof row.phase_allocations === 'string'
      ? JSON.parse(row.phase_allocations)
      : row.phase_allocations;
  } catch {
    return null;
  }
}

// Suggested PM routing from the PM->routing sidecar. Single source for the
// approval-state endpoint's suggestedRoutingCode/suggestedRoutingPm — callers
// must never re-derive this. `log` is optional (route handlers pass req.log).
// The PM lookup is UNCONDITIONAL on budget state (owner ruling 2026-07-23):
// in-budget invoices get the same PM suggestion. `exceedsUnbilled` is kept as
// its own independent warning flag.
function findSuggestedRouting(row, phaseInfo, { log } = {}) {
  const invoiceAmount = row.amount != null ? parseFloat(row.amount) : 0;
  const exceedsUnbilled = invoiceAmount > phaseInfo.unbilled + 0.01;
  if (!row.job_match_number) {
    return { exceedsUnbilled, suggestedRoutingCode: null, suggestedRoutingPm: null };
  }

  try {
    const routingCodesData = readJSON(ROUTING_CODES_PATH) || {};
    const pmToRouting = routingCodesData.pm_to_routing || {};
    const jobsData = readJSON(JOBS_PATH) || [];
    const jobsArray = Array.isArray(jobsData) ? jobsData : jobsData.Jobs || [];
    const job = jobsArray.find((candidate) => (
      (candidate.Job_Number || '').trim() === row.job_match_number
    ));

    if (job && job.Project_Manager) {
      const suggestedRoutingPm = (job.Project_Manager || '').trim();
      return {
        exceedsUnbilled,
        suggestedRoutingCode: pmToRouting[suggestedRoutingPm] || null,
        suggestedRoutingPm,
      };
    }
  } catch (err) {
    if (log && typeof log.warn === 'function') {
      log.warn({
        operation: 'invoice.phase_options.routing_lookup',
        error: err && err.message ? err.message : String(err),
        err,
      }, 'Routing code lookup failed');
    }
  }

  return { exceedsUnbilled, suggestedRoutingCode: null, suggestedRoutingPm: null };
}

async function getPhaseOptions(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, subcontract_number, job_match_number, amount, phase_allocations, routing_code FROM documents WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    if (!row.subcontract_number) {
      return fail(res, 400, 'Invoice has no matched subcontract — multi-phase allocation requires a subcontract match first');
    }

    const { getSubcontractPhaseInfo } = require('./matcher');
    const phaseInfo = getSubcontractPhaseInfo(row.subcontract_number);
    if (!phaseInfo) {
      return fail(res, 404, `Subcontract ${row.subcontract_number} not found in Spectrum data`);
    }

    const invoiceAmount = row.amount != null ? parseFloat(row.amount) : 0;
    const { exceedsUnbilled, suggestedRoutingCode, suggestedRoutingPm } = findSuggestedRouting(
      row,
      phaseInfo,
      { log: req.log }
    );

    res.json({
      invoiceId: row.id,
      subcontractNumber: phaseInfo.subcontractNumber,
      jobNumber: row.job_match_number || phaseInfo.jobNumber,
      invoiceAmount,
      header: {
        vendorCode: phaseInfo.vendorCode,
        vendorName: phaseInfo.vendorName,
        revContract: phaseInfo.revContract,
        totalBilled: phaseInfo.totalBilled,
        unbilled: phaseInfo.unbilled,
      },
      exceedsUnbilled,
      overageAmount: exceedsUnbilled ? Math.round((invoiceAmount - phaseInfo.unbilled) * 100) / 100 : 0,
      suggestedRoutingCode,
      suggestedRoutingPm,
      currentRoutingCode: row.routing_code || null,
      isMultiPhase: phaseInfo.isMultiPhase,
      distinctPhaseCount: phaseInfo.distinctPhaseCount,
      phaseRowCount: phaseInfo.phaseRowCount,
      phaseRows: phaseInfo.phaseRows,
      phases: phaseInfo.aggregatedPhases,
      currentAllocations: parseCurrentAllocations(row),
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/phase-options');
  }
}

module.exports = {
  getPhaseOptions,
  findSuggestedRouting,
};
