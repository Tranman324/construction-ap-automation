'use strict';
/**
 * /api/feedback routes
 */

const express = require('express');
const router = express.Router();
const { validate } = require('../../../middleware/validate');
const { vendorFeedbackSchema, subcontractFeedbackSchema } = require('../../../lib/schemas');
const { recordVendorFeedback, recordSubcontractFeedback } = require('../services/matcher');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');

// POST /api/feedback/vendor
router.post('/vendor', requirePermission('accounting.invoices.view_details'), validate(vendorFeedbackSchema), async (req, res) => {
  try {
    const { email, vendorName, vendorCode } = req.body;
    if (!vendorCode) return fail(res, 400, 'vendorCode is required');
    const result = await recordVendorFeedback({ email: email || '', name: vendorName || '', vendorCode, vendorName: vendorName || '' });
    res.json({ success: true, cached: result });
  } catch (err) {
    return safeError(res, err, 'POST /api/feedback/vendor');
  }
});

// POST /api/feedback/subcontract
router.post('/subcontract', requirePermission('accounting.invoices.view_details'), validate(subcontractFeedbackSchema), async (req, res) => {
  try {
    const { vendorCode, jobNumber, subcontractNumber } = req.body;
    if (!vendorCode || !jobNumber || !subcontractNumber) {
      return fail(res, 400, 'vendorCode, jobNumber, and subcontractNumber are required');
    }
    const result = await recordSubcontractFeedback({ vendorCode, jobNumber, subcontractNumber });
    res.json({ success: true, cached: result });
  } catch (err) {
    return safeError(res, err, 'POST /api/feedback/subcontract');
  }
});

module.exports = router;
