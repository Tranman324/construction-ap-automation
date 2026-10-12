'use strict';

/**
 * /api/documents routes
 *
 * Document-level operations that don't fit the invoice-centric route namespace.
 * Currently: Spectrum COI upload and shared document collaboration.
 */

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const { resourceIdParamsSchema } = require('../../../lib/schemas');
const { documentAttachmentParamsSchema, documentAttachmentEmptyBodySchema } = require('../../../lib/schemas');
const { uploadToSpectrum } = require('../services/spectrumCoiUploadService');
const { fail } = require('../../../middleware/errorResponse');
const logger = require('../../../lib/logger');
const { sanitizeFilename } = require('../services/sanitize');
const inboundAttachments = require('../services/inboundAttachmentPromotionService');
const { registerCollaborationRoutes } = require('./collaboration');

// POST /api/documents/:id/upload-to-spectrum
router.post(
  '/:id/upload-to-spectrum',
  requirePermission('accounting.invoices.submit_spectrum'),
  validate(resourceIdParamsSchema, 'params'),
  async (req, res) => {
    try {
      return await uploadToSpectrum(req, res);
    } catch (err) {
      logger.error({ err, documentId: req.params.id }, 'upload-to-spectrum route error');
      if (!res.headersSent) {
        return fail(res, 500, 'Internal server error');
      }
    }
  }
);

registerCollaborationRoutes(router, 'document');

function inboundAttachmentAction(action) {
  return async (req, res) => {
    try {
      return res.json(await inboundAttachments[action](req.params.id));
    } catch (err) {
      if (err instanceof inboundAttachments.InboundAttachmentError) {
        return fail(res, err.statusCode, err.message, err.code, err.details);
      }
      (req.log || logger).error({ operation: `document.inbound_attachment.${action}`, documentId: req.params.id }, 'Inbound attachment request failed');
      return fail(res, 500, 'Internal server error');
    }
  };
}

function attachmentContent(action) {
  return async (req, res) => {
    try {
      const result = await inboundAttachments.getAttachment(req.params.id, req.params.attachmentId);
      const filename = sanitizeFilename(result.item.name || 'attachment');
      const contentType = result.item.contentType || 'application/octet-stream';
      const safeInlineType = /^(?:application\/pdf|image\/(?:gif|jpe?g|png|tiff?))$/i.test(contentType);
      res.type(safeInlineType ? contentType : 'application/octet-stream');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', 'sandbox');
      res.set('Content-Disposition', `${action === 'preview' && safeInlineType ? 'inline' : 'attachment'}; filename="${filename}"`);
      return res.send(result.buffer);
    } catch (err) {
      if (err instanceof inboundAttachments.InboundAttachmentError) {
        return fail(res, err.statusCode, err.message, err.code, err.details);
      }
      (req.log || logger).error({ operation: `document.inbound_attachment.${action}`, documentId: req.params.id }, 'Inbound attachment content request failed');
      return fail(res, 500, 'Internal server error');
    }
  };
}

router.get('/:id/inbound-attachments', requirePermission('accounting.invoices.view_details'),
  validate(resourceIdParamsSchema, 'params'), inboundAttachmentAction('listSourceAttachments'));
router.get('/:id/inbound-attachments/:attachmentId/preview', requirePermission('accounting.invoices.view_details'),
  validate(documentAttachmentParamsSchema, 'params'), attachmentContent('preview'));
router.get('/:id/inbound-attachments/:attachmentId/download', requirePermission('accounting.invoices.view_details'),
  validate(documentAttachmentParamsSchema, 'params'), attachmentContent('download'));
router.post('/:id/inbound-attachments/:attachmentId/promote', requirePermission('accounting.invoices.view_details'),
  validate(documentAttachmentParamsSchema, 'params'), validate(documentAttachmentEmptyBodySchema), async (req, res) => {
    try {
      return res.status(201).json(await inboundAttachments.promoteAttachment(req.params.id, req.params.attachmentId, req.user));
    } catch (err) {
      if (err instanceof inboundAttachments.InboundAttachmentError) return fail(res, err.statusCode, err.message, err.code, err.details);
      (req.log || logger).error({ operation: 'document.inbound_attachment.promote', documentId: req.params.id }, 'Inbound attachment promotion failed');
      return fail(res, 500, 'Internal server error');
    }
  });
module.exports = router;
