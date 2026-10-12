'use strict';
/**
 * /api/subcontracts routes
 */

const express = require('express');
const router = express.Router();
const { readJSON } = require('../services/utils');
const { SUBCONTRACTS_PATH } = require('../../../config');
const { safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const { subcontractsQuerySchema } = require('../../../lib/schemas');
const { getPagination } = require('../../../lib/pagination');

router.get('/', requirePermission('accounting.invoices.view_details'), validate(subcontractsQuerySchema, 'query'), (req, res) => {
  try {
    const { vendorCode, jobNumber } = req.query;
    const { limit, offset } = getPagination(req.query);
    const subs = readJSON(SUBCONTRACTS_PATH, []);

    const results = subs.filter(s => {
      const vc = (s.VendorCode || s.vendorCode || s.vendor_code || '').trim();
      const jn = (s.Job || s.job || s.jobNumber || s.subcontract_number?.split('.')[0] || '').toString().trim();
      if (vendorCode && vc !== vendorCode.trim()) return false;
      if (jobNumber  && jn !== jobNumber.trim())  return false;
      return true;
    }).map(s => ({
      subcontractNumber: s.subcontract_number || s.subcontractNumber || '',
      job: s.job || s.Job || '',
      vendorCode: s.vendor_code || s.vendorCode || s.VendorCode || '',
      vendor: s.vendor || '',
      revContract: s.rev_contract ?? s.revContract ?? 0,
      totalBilled: s.total_billed ?? s.totalBilled ?? 0,
      totalPaid: s.total_paid ?? s.totalPaid ?? 0,
      unpaidBalance: s.unpaid_balance ?? s.unpaidBalance ?? 0,
      unbilled: s.unbilled ?? 0,
      pctBilled: s.pct_billed ?? s.pctBilled ?? 0,
      retPct: s.ret_pct ?? s.retPct ?? 0,
      status: s.status || '',
      phases: (s.phases || []).map(p => ({
        phaseCode: p.phase_code || p.phaseCode || '',
        costType: p.cost_type || p.costType || '',
        description: p.description || '',
        originalAmount: p.original_amount ?? p.originalAmount ?? 0,
        amountBilled: p.amount_billed ?? p.amountBilled ?? 0,
      })),
    })).sort((left, right) => {
      const leftKey = `${left.subcontractNumber}\u0000${left.job}\u0000${left.vendorCode}`.toLowerCase();
      const rightKey = `${right.subcontractNumber}\u0000${right.job}\u0000${right.vendorCode}`.toLowerCase();
      if (leftKey === rightKey) return 0;
      return leftKey < rightKey ? -1 : 1;
    }).slice(offset, offset + limit);

    res.json(results);
  } catch (err) {
    return safeError(res, err, 'GET /api/subcontracts');
  }
});

module.exports = router;
