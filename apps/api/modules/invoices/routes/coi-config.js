'use strict';
/**
 * /api/coi-config routes
 * Serves the COI compliance config (single-row JSONB). Read is view-gated; the
 * Settings write is manage_settings-gated and validated (422 on malformed config)
 * in the service, then audited.
 */

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const { getCoiConfig, updateCoiConfig, listCoiConfigVersions, getCoiConfigVersion } = require('../services/coiConfigService');

router.get('/', requirePermission('accounting.invoices.view_details'), async (req, res) => {
  return getCoiConfig(req, res);
});

router.put('/', requirePermission('accounting.invoices.manage_settings'), async (req, res) => {
  return updateCoiConfig(req, res);
});
router.get('/versions', requirePermission('accounting.invoices.manage_settings'), async (req, res) => listCoiConfigVersions(req, res));
router.get('/versions/:id', requirePermission('accounting.invoices.manage_settings'), async (req, res) => getCoiConfigVersion(req, res));

module.exports = router;
