'use strict';
/**
 * /api/invoices routes
 * CRUD, bulk, submit, approve, reject, discard, lien waivers
 */

const express = require('express');
const router = express.Router();
const { registerCollaborationRoutes } = require('./collaboration');

const {
  invoiceBulkActionSchema,
  invoiceListQuerySchema,
  invoiceNeighborsQuerySchema,
  invoiceStatsQuerySchema,
  invoiceTrashQuerySchema,
  invoiceSubmitSchema,
  invoiceUnifiedActionSchema,
  invoiceFlagSchema,
  invoiceUnflagSchema,
  invoiceUpdateSchema,
  lienWaiverLinkSchema,
  paginationQuerySchema,
  orphanCandidatesQuerySchema,
  resourceIdParamsSchema,
  statementLineCreateSchema,
  statementAttributePatchSchema,
  warrantyClassificationPatchSchema,
  statementLineResolveSchema,
  statementLineUpdateSchema,
  waiverRequestSchema,
  waiverContactAddSchema,
  coiOverrideCreateSchema,
} = require('../../../lib/schemas');
const { validate } = require('../../../middleware/validate');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { checkPermission, requirePermission } = require('../../../middleware/permissions');
const { approveInvoice, unapproveInvoice } = require('../services/invoiceApprovalService');
const { ACTION_PERMISSIONS, bulkAction } = require('../services/bulkActionService');
const {
  getInvoice,
  getInvoiceNeighbors,
  getInvoiceStats,
  listDeletedInvoices,
  listInvoices,
} = require('../services/invoiceCollectionService');
const {
  permanentlyDeleteInvoice,
  restoreInvoice,
  softDeleteInvoice,
} = require('../services/invoiceDeletionService');
const { uneditInvoice, updateInvoice } = require('../services/invoiceEditService');
const { flagDocument, unflagDocument } = require('../services/documentFlagService');
const {
  getInvoiceAudit,
  getInvoiceEmail,
  headInvoiceFile,
  streamInvoiceFile,
  streamInvoicePdf,
} = require('../services/invoiceFileService');
const {
  discardInvoice,
  fileDocument,
  flagForSplit,
  reclassifyInvoice,
  revertLienWaiverBypass,
  reconcileInvoice,
  rejectInvoice,
  revertWaiverOverride,
  reprocessInvoice,
  retryInvoice,
  reviewInvoice,
  setLienWaiverBypass,
  setWaiverOverride,
  undiscardInvoice,
  unreconcileInvoice,
  unreviewInvoice,
} = require('../services/invoiceStatusService');
const {
  getDuplicateStatus,
  setDuplicateBypass,
  revertDuplicateBypass,
} = require('../services/duplicateWorkflowRoutes');
const {
  getLinkedDocuments,
  getSiblings,
  linkDocument,
} = require('../services/linkedDocumentsService');
const { linkWaiver, unlinkWaiver } = require('../services/lienWaiverLinkService');
const { getWaiverActionSerializationOptions, rowToDoc } = require('../services/supabase');
const {
  getOrphanWaiversForInvoice,
} = require('../services/lienWaiverQueryService');
const { updatePhaseAllocations } = require('../services/phaseAllocationService');
const { getPhaseOptions } = require('../services/phaseOptionsService');
const { submitInvoices } = require('../services/submitWorkflow');
const {
  addStatementLine,
  deleteStatementLine,
  rematchStatementLines,
  resolveStatementLine,
  unresolveStatementLine,
  updateStatementLine,
} = require('../services/statementLineService');
const { updateStatementAttributes } = require('../services/statementAttributeService');
const { updateWarrantyClassification } = require('../services/warrantyClassificationService');
const {
  executeAction,
  getInvoiceActions,
  undoAction,
} = require('../services/unifiedActionService');
const { applyCoiOverride, revokeCoiOverride } = require('../services/coiOverrideService');
const { updateCoiManualValues } = require('../services/coiManualValueService');

function requireBulkActionPermission(req, res, next) {
  const action = req.body?.action;
  const requiredPermission = ACTION_PERMISSIONS[action];

  if (!requiredPermission || !checkPermission(req, requiredPermission)) {
    return fail(res, 403, 'Forbidden');
  }

  return next();
}

router.get('/', requirePermission('accounting.invoices.view'), validate(invoiceListQuerySchema, 'query'), async (req, res) => {
  return listInvoices(req, res);
});

router.get('/stats', requirePermission('accounting.invoices.view'), validate(invoiceStatsQuerySchema, 'query'), async (req, res) => {
  return getInvoiceStats(req, res);
});

// Server-computed keyset prev/next for the detail Prev/Next arrows + post-action
// auto-advance. Same filter/sort vocabulary as the list; the anchor id is a path param
// (distinct from /:id, so registration order relative to /:id does not matter).
router.get('/:id/neighbors', requirePermission('accounting.invoices.view'), validate(invoiceNeighborsQuerySchema, 'query'), async (req, res) => {
  return getInvoiceNeighbors(req, res);
});

router.get('/trash', requirePermission('accounting.invoices.view'), validate(invoiceTrashQuerySchema, 'query'), async (req, res) => {
  return listDeletedInvoices(req, res);
});

router.get('/:id', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return getInvoice(req, res);
});

router.post('/:id/coi-overrides', requirePermission('accounting.invoices.coi_override'), validate(coiOverrideCreateSchema), async (req, res) => {
  return applyCoiOverride(req, res);
});

router.delete('/:id/coi-overrides/:checkId', requirePermission('accounting.invoices.coi_override'), async (req, res) => {
  return revokeCoiOverride(req, res);
});
router.patch('/:id/coi-manual-values', requirePermission('accounting.invoices.coi_override'), async (req, res) => updateCoiManualValues(req, res));

router.get('/:id/pdf', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return streamInvoicePdf(req, res);
});

router.patch('/:id', requirePermission('accounting.invoices.view_details'), validate(invoiceUpdateSchema), async (req, res) => {
  return updateInvoice(req, res);
});

router.post('/:id/unedit', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return uneditInvoice(req, res);
});

router.post('/:id/approve', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return approveInvoice(req, res);
});

router.post('/:id/unapprove', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return unapproveInvoice(req, res);
});

router.post('/:id/review', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return reviewInvoice(req, res);
});

router.post('/:id/unreview', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return unreviewInvoice(req, res);
});

// Workflow-neutral "needs attention" flag. Both gates reuse the existing
// view_details key; unflag authorization (original flagger or manage_rules
// holder) is enforced at the service layer, not here.
router.post('/:id/flag', requirePermission('accounting.invoices.view_details'), validate(invoiceFlagSchema), async (req, res) => {
  return flagDocument(req, res);
});

router.post('/:id/unflag', requirePermission('accounting.invoices.view_details'), validate(invoiceUnflagSchema), async (req, res) => {
  return unflagDocument(req, res);
});

router.post('/:id/file', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return fileDocument(req, res);
});

// Manual file upload for link-only emails (no-attachment/error/unsupported docs).
// multipart/form-data with a single 'file' field. See attachFileService.js.
const multer = require('multer');
const attachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
router.post('/:id/attach-file', requirePermission('accounting.invoices.view_details'), (req, res) => {
  attachUpload.single('file')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        const status = multerErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return fail(res, status, multerErr.message);
      }
      const { attachFileAndReprocess } = require('../services/attachFileService');
      const result = await attachFileAndReprocess(req.params.id, req.file, req.user, { req, res });
      res.json(result);
    } catch (err) {
      return safeError(res, err, 'POST /api/invoices/:id/attach-file');
    }
  });
});

router.get('/:id/waiver-recipient', requirePermission('accounting.invoices.request_waiver'), async (req, res) => {
  try {
    const { getWaiverRecipient } = require('../services/waiverRecipientService');
    res.json(await getWaiverRecipient(req.params.id));
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/waiver-recipient');
  }
});

// W5: inline manual add to the vendor contacts directory from the recipient
// picker dialog. Document-scoped so the vendor binding comes from the doc,
// never from client input. Directory-only — trust/resolution never read it.
router.post('/:id/waiver-contacts', requirePermission('accounting.invoices.request_waiver'), validate(waiverContactAddSchema), async (req, res) => {
  try {
    const { pool } = require('../services/supabase');
    const { rows } = await pool.query(
      'SELECT id, classification, vendor_code FROM documents WHERE id = $1',
      [req.params.id]
    );
    const doc = rows[0];
    if (!doc) return fail(res, 404, 'Document not found');
    if (!['invoice', 'pay-application'].includes(doc.classification)) {
      return fail(res, 422, 'Vendor contacts can only be added from invoice or pay-application documents');
    }
    if (!doc.vendor_code) return fail(res, 422, 'Document has no matched vendor');

    const { validateRecipientOverride } = require('../services/waiverRecipientParsing');
    const email = validateRecipientOverride(req.body.email); // 400 on blocked/invalid
    const { upsertVendorContact, listVendorContacts } = require('../services/vendorContactsService');
    const saved = await upsertVendorContact({
      vendorCode: doc.vendor_code,
      email,
      name: req.body.name || null,
      source: 'manual',
      addedBy: req.user?.email || req.user?.id || 'unknown',
    });
    if (!saved) return fail(res, 400, 'That address looks like an automated mailbox and cannot be added');
    res.json({ success: true, directoryContacts: await listVendorContacts(doc.vendor_code) });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/waiver-contacts');
  }
});

router.post('/:id/request-waiver', requirePermission('accounting.invoices.request_waiver'), validate(waiverRequestSchema), async (req, res) => {
  try {
    const { requestWaiver } = require('../services/waiverRequestService');
    const { invoiceRow, ...result } = await requestWaiver(req.params.id, req.user, {
      resend: req.body?.resend === true,
      recipientOverride: req.body?.recipientOverride || null,
      req,
      res,
    });
    res.json({
      ...result,
      invoice: rowToDoc(invoiceRow, getWaiverActionSerializationOptions(req)),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/request-waiver');
  }
});

router.post('/:id/waiver-override', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return setWaiverOverride(req, res);
});

router.post('/:id/waiver-override/revert', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return revertWaiverOverride(req, res);
});

router.post('/:id/waiver-bypass', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return setLienWaiverBypass(req, res);
});

router.post('/:id/waiver-bypass/revert', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return revertLienWaiverBypass(req, res);
});

// Duplicate workflow (DUPLICATE-WORKFLOW-SPEC): live status + guarded bypass.
router.get('/:id/duplicate-status', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return getDuplicateStatus(req, res);
});

router.post('/:id/duplicate-bypass', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return setDuplicateBypass(req, res);
});

router.post('/:id/duplicate-bypass/revert', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return revertDuplicateBypass(req, res);
});

router.post('/:id/reconcile', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return reconcileInvoice(req, res);
});

router.post('/:id/unreconcile', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return unreconcileInvoice(req, res);
});

router.post('/:id/statement-lines', requirePermission('accounting.invoices.approve'), validate(statementLineCreateSchema), async (req, res) => {
  return addStatementLine(req, res);
});

router.post('/:id/statement-lines/rematch', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return rematchStatementLines(req, res);
});

router.post('/:id/statement-lines/:lineId/resolve', requirePermission('accounting.invoices.approve'), validate(statementLineResolveSchema), async (req, res) => {
  return resolveStatementLine(req, res);
});

router.post('/:id/statement-lines/:lineId/unresolve', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return unresolveStatementLine(req, res);
});

router.patch('/:id/statement-lines/:lineId', requirePermission('accounting.invoices.approve'), validate(statementLineUpdateSchema), async (req, res) => {
  return updateStatementLine(req, res);
});

router.patch('/:id/statement-attributes', requirePermission('accounting.invoices.approve'), validate(statementAttributePatchSchema, 'body', 422), async (req, res) => {
  return updateStatementAttributes(req, res);
});

router.patch('/:id/warranty-classification', requirePermission('accounting.invoices.approve'), validate(warrantyClassificationPatchSchema, 'body', 422), async (req, res) => {
  return updateWarrantyClassification(req, res);
});

router.delete('/:id/statement-lines/:lineId', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return deleteStatementLine(req, res);
});

router.get('/:id/siblings', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  return getSiblings(req, res);
});

router.post('/:id/link', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return linkDocument(req, res);
});

router.get('/:id/linked', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  return getLinkedDocuments(req, res);
});

router.post('/:id/reject', requirePermission('accounting.invoices.reject'), async (req, res) => {
  return rejectInvoice(req, res);
});

router.post('/:id/discard', requirePermission('accounting.invoices.delete'), async (req, res) => {
  return discardInvoice(req, res);
});

router.post('/:id/undiscard', requirePermission('accounting.invoices.delete'), async (req, res) => {
  return undiscardInvoice(req, res);
});

router.post('/:id/actions', requirePermission('accounting.invoices.approve'), validate(invoiceUnifiedActionSchema), async (req, res) => {
  return executeAction(req, res);
});

router.post('/:id/actions/:actionId/undo', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return undoAction(req, res);
});

router.get('/:id/actions', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  return getInvoiceActions(req, res);
});

router.post('/:id/reclassify', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return reclassifyInvoice(req, res);
});

router.post('/:id/retry', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return retryInvoice(req, res);
});

router.post('/:id/reprocess', requirePermission('accounting.invoices.view_details'), validate(resourceIdParamsSchema, 'params'), async (req, res) => {
  return reprocessInvoice(req, res);
});

router.post('/:id/flag-for-split', requirePermission('accounting.invoices.manage_splits'), async (req, res) => {
  return flagForSplit(req, res);
});

router.get('/:id/phase-options', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return getPhaseOptions(req, res);
});

router.patch('/:id/phase-allocations', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return updatePhaseAllocations(req, res);
});

router.post('/bulk', validate(invoiceBulkActionSchema), requireBulkActionPermission, async (req, res) => {
  return bulkAction(req, res);
});

router.post('/submit', requirePermission('accounting.invoices.submit_spectrum'), validate(invoiceSubmitSchema), async (req, res) => {
  return submitInvoices(req, res);
});

router.get('/:id/email', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return getInvoiceEmail(req, res);
});

router.head('/:id/file', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return headInvoiceFile(req, res);
});

router.get('/:id/file', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return streamInvoiceFile(req, res);
});

router.get('/:id/audit', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  return getInvoiceAudit(req, res);
});

router.delete('/:id', requirePermission('accounting.invoices.delete'), async (req, res) => {
  return softDeleteInvoice(req, res);
});

router.post('/:id/restore', requirePermission('accounting.invoices.delete'), async (req, res) => {
  return restoreInvoice(req, res);
});

router.delete('/:id/permanent', requirePermission('accounting.invoices.permanent_delete'), async (req, res) => {
  return permanentlyDeleteInvoice(req, res);
});

router.get('/:id/orphan-waivers', requirePermission('accounting.invoices.view_details'), validate(resourceIdParamsSchema, 'params'), validate(orphanCandidatesQuerySchema, 'query'), async (req, res) => {
  try {
    const result = await getOrphanWaiversForInvoice({ id: req.params.id, query: req.query });
    if (result.missing) return fail(res, 404, 'Invoice not found');
    if (result.invalidTarget) return fail(res, 400, 'Document is not an invoice or pay application');
    return res.json(result);
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/orphan-waivers');
  }
});

router.post('/:id/link-waiver', requirePermission('accounting.invoices.approve'), validate(lienWaiverLinkSchema), async (req, res) => {
  return linkWaiver(req, res);
});

router.delete('/:id/link-waiver', requirePermission('accounting.invoices.approve'), async (req, res) => {
  return unlinkWaiver(req, res);
});

registerCollaborationRoutes(router, 'invoice');

module.exports = router;
