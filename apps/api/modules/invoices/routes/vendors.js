'use strict';
/**
 * /api/vendors routes
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { spawn } = require('child_process');
const { readJSON, writeJSON } = require('../services/utils');
const { spectrumState } = require('../services/spectrum');
const { VENDORS_PATH, SPECTRUM_REFRESH_PATH } = require('../../../config');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const { vendorsQuerySchema } = require('../../../lib/schemas');
const { getPagination } = require('../../../lib/pagination');

function vendorCode(vendor) {
  return (vendor.Vendor_Code || vendor.vendor_code || vendor.code || '').trim();
}

function vendorName(vendor) {
  return (vendor.Name || vendor.name || '').trim();
}

function compareVendors(left, right) {
  const leftName = vendorName(left).toLowerCase();
  const rightName = vendorName(right).toLowerCase();
  if (leftName !== rightName) return leftName < rightName ? -1 : 1;

  const leftCode = vendorCode(left).toLowerCase();
  const rightCode = vendorCode(right).toLowerCase();
  if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1;
  return 0;
}

// GET /api/vendors — search vendor list
router.get('/', requirePermission('accounting.invoices.view'), validate(vendorsQuerySchema, 'query'), (req, res) => {
  try {
    const { search } = req.query;
    const { limit, offset } = getPagination(req.query);
    const vendors = readJSON(VENDORS_PATH, []);

    const q = search.toLowerCase();
    const results = [...vendors]
      .sort(compareVendors)
      .filter(v => {
        if (!q) return true;
        const name = vendorName(v).toLowerCase();
        const code = vendorCode(v).toLowerCase();
        return name.includes(q) || code.includes(q);
      })
      .slice(offset, offset + limit)
      .map(v => ({
        code: vendorCode(v),
        name: vendorName(v),
      }));

    res.json(results);
  } catch (err) {
    return safeError(res, err, 'GET /api/vendors');
  }
});

// POST /api/vendors/refresh — trigger Spectrum data refresh
router.post('/refresh', requirePermission('accounting.invoices.manage_settings'), (req, res) => {
  if (spectrumState.running) {
    return fail(res, 409, 'Spectrum refresh is already running', { status: 'running' });
  }
  try {
    spectrumState.running = true;
    spectrumState.startedAt = new Date().toISOString();

    // cwd must be modules/invoices — the script lives at
    // modules/invoices/scripts/refresh-spectrum.sh. The old '..', '..' cwd
    // (modules/) made bash exit 127 instantly while still stamping
    // lastRefresh, so the button reported success without syncing anything.
    const child = spawn('bash', ['scripts/refresh-spectrum.sh'], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    child.on('close', (code) => {
      const endTime = new Date().toISOString();
      const existing = readJSON(SPECTRUM_REFRESH_PATH, {});
      writeJSON(SPECTRUM_REFRESH_PATH, {
        ...existing,
        lastRefresh: endTime,
        lastExitCode: code,
        lastResult: existing.lastResult || { vendors: 0, jobs: 0, subcontracts: 0, durationMs: 0 },
      });
      spectrumState.running = false;
      if (code !== 0) {
        req.log.error({ operation: 'spectrum.refresh', context: { exitCode: code } }, 'refresh-spectrum.sh exited non-zero');
      }
    });

    res.json({ status: 'started', startedAt: spectrumState.startedAt });
  } catch (err) {
    spectrumState.running = false;
    return safeError(res, err, 'POST /api/vendors/refresh');
  }
});

// GET /api/vendors/refresh/status — refresh status
router.get('/refresh/status', requirePermission('accounting.invoices.manage_settings'), (req, res) => {
  try {
    const fileStatus = readJSON(SPECTRUM_REFRESH_PATH, {});
    res.json({
      running:     spectrumState.running,
      startedAt:   spectrumState.running ? spectrumState.startedAt : undefined,
      lastRefresh: fileStatus.lastRefresh || null,
      lastResult:  fileStatus.lastResult  || null,
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/vendors/refresh/status');
  }
});

module.exports = router;
