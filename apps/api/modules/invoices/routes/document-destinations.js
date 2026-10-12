'use strict';
/**
 * /api/document-destinations routes
 * Serves the SharePoint destination catalog (folder tree + per-document-type
 * default paths). Read is view-gated; the Settings write is manage_settings-
 * gated, validated, and audited.
 */

const express = require('express');
const router = express.Router();

const { validate } = require('../../../middleware/validate');
const { requirePermission } = require('../../../middleware/permissions');
const { documentDestinationsWriteSchema, resourceIdParamsSchema } = require('../../../lib/schemas');
const {
  getDocumentDestinations,
  listDocumentDestinationVersions,
  getDocumentDestinationVersion,
  updateDocumentDestinations,
} = require('../services/documentDestinationsService');

router.get('/', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return getDocumentDestinations(req, res);
});

router.get('/versions', requirePermission('accounting.invoices.manage_settings'), async (req, res) => {
  return listDocumentDestinationVersions(req, res);
});

router.get('/versions/:id', requirePermission('accounting.invoices.manage_settings'), validate(resourceIdParamsSchema, 'params'), async (req, res) => {
  return getDocumentDestinationVersion(req, res);
});

router.put('/', requirePermission('accounting.invoices.manage_settings'), validate(documentDestinationsWriteSchema), async (req, res) => {
  return updateDocumentDestinations(req, res);
});

module.exports = router;
