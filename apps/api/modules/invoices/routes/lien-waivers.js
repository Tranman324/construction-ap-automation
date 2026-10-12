'use strict';
/**
 * /api/lien-waivers routes
 */

const express = require('express');
const router = express.Router();
const { getOrphanInvoicesForWaiver, listFiledOrphanWaivers } = require('../services/lienWaiverQueryService');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const { lienWaiverOrphansQuerySchema, orphanCandidatesQuerySchema, resourceIdParamsSchema } = require('../../../lib/schemas');
const { getPagination } = require('../../../lib/pagination');

// GET /api/lien-waivers/orphans
router.get('/orphans', requirePermission('accounting.invoices.view_details'), validate(lienWaiverOrphansQuerySchema, 'query'), async (req, res) => {
  try {
    const {
      vendorCode,
      jobNumber,
      search,
      limit: validatedLimit,
      page: pageNum,
      offset: requestedOffset,
    } = req.query;

    const { limit: limitNum, offset: normalizedOffset } = getPagination(req.query);
    const useOffset = requestedOffset !== undefined;
    const offset = useOffset ? normalizedOffset : (pageNum - 1) * validatedLimit;
    const responsePage = useOffset
      ? Math.floor(normalizedOffset / limitNum) + 1
      : pageNum;

    const { rows, total } = await listFiledOrphanWaivers({ vendorCode, jobNumber, search, limit: limitNum, offset });

    const waivers = rows.map(r => ({
      id:           r.id,
      fileName:     r.file_name || null,
      vendorCode:   r.vendor_code || null,
      vendorName:   r.vendor_name || null,
      jobNumber:    r.job_match_number || null,
      amountWaived: r.amount != null ? parseFloat(r.amount) : null,
      receivedAt:   r.email_received_at ? r.email_received_at.toISOString() : (r.queued_at ? r.queued_at.toISOString() : null),
      emailFrom:    r.email_from || null,
    }));

    res.json({ waivers, total, page: responsePage, limit: limitNum });
  } catch (err) {
    return safeError(res, err, 'GET /api/lien-waivers/orphans');
  }
});

router.get('/:id/orphan-invoices', requirePermission('accounting.invoices.view_details'), validate(resourceIdParamsSchema, 'params'), validate(orphanCandidatesQuerySchema, 'query'), async (req, res) => {
  try {
    const result = await getOrphanInvoicesForWaiver({ id: req.params.id, query: req.query });
    if (result.missing) return fail(res, 404, 'Waiver not found');
    if (result.invalidTarget) return fail(res, 400, 'Document is not a lien waiver');
    return res.json(result);
  } catch (err) {
    return safeError(res, err, 'GET /api/lien-waivers/:id/orphan-invoices');
  }
});

module.exports = router;
