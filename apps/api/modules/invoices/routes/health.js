'use strict';
/**
 * /api/health route
 */

const express = require('express');
const router = express.Router();
const { getPendingDocumentCount } = require('../services/healthService');
const { checkSpectrumSql } = require('../services/spectrum');
const { readJSON } = require('../services/utils');
const { PIPELINE_STATUS_PATH } = require('../../../config');

router.get('/', async (req, res) => {
  // Check Supabase connectivity
  let supabaseOk = false;
  let pendingCount = 0;
  try {
    pendingCount = await getPendingDocumentCount();
    supabaseOk = true;
  } catch (_) {}

  // Check Spectrum SQL connectivity
  const spectrumSqlOk = await checkSpectrumSql();

  // Read last pipeline run from status file
  const pipelineStatus = readJSON(PIPELINE_STATUS_PATH, {});
  const lastPipelineRun = pipelineStatus.lastRun || null;

  const uptime = Math.floor(process.uptime());

  res.json({
    status: supabaseOk ? 'ok' : 'degraded',
    uptime,
    supabase: supabaseOk,
    spectrumSql: spectrumSqlOk,
    lastPipelineRun,
    pendingCount,
    version: '1.0.0',
  });
});

module.exports = router;
