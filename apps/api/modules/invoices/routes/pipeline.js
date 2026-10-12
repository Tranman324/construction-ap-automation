'use strict';
/**
 * /api/pipeline routes
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { listPipelineErrors, resolvePipelineError, retryPipelineError } = require('../services/pipelineErrorService');
const { listSkips, rescueSkip } = require('../services/junkFilterService');
const { readJSON } = require('../services/utils');
const { PIPELINE_STATUS_PATH } = require('../../../config');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { pipelineLimiter } = require('../../../middleware/rateLimiter');
const { validate } = require('../../../middleware/validate');
const { getPagination } = require('../../../lib/pagination');
const {
  paginationQuerySchema,
  pipelineErrorResolveSchema,
  pipelineErrorsQuerySchema,
  resourceIdParamsSchema,
} = require('../../../lib/schemas');

// In-memory pipeline state (shared via module scope)
const pipelineState = { running: false, lastRun: null, lastResult: null };

/**
 * Decide what lastResult to record when a pipeline child exits.
 *
 * The status file is a shared sink (cron also runs the pipeline), so a result
 * is only trusted when its runId matches the runId this route minted for the
 * spawned child. Anything else — stale file, missing file, or a crash before
 * the status write — is reported as an explicit failure, never as stale or
 * fabricated success.
 */
function resolveRunOutcome({ fileLastResult, runId, exitCode }) {
  const matched = Boolean(fileLastResult && fileLastResult.runId === runId);
  if (matched && exitCode === 0) return fileLastResult;
  if (matched) return { ...fileLastResult, failed: true };
  return { processed: 0, queued: 0, errors: 0, failed: true, runId };
}

// POST /api/pipeline/run
router.post('/run', pipelineLimiter, requirePermission('accounting.invoices.manage_retention'), (req, res) => {
  if (pipelineState.running) {
    return fail(res, 409, 'Pipeline is already running', { status: 'running' });
  }
  try {
    pipelineState.running = true;
    pipelineState.lastRun = new Date().toISOString();

    const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, 'pipeline.log');
    const logFd = fs.openSync(logFile, 'a');

    // Unique per-request run id; the service stamps it into the status file's
    // lastResult so the close handler can correlate result with this run.
    const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const child = spawn('node', [path.join(__dirname, '..', 'services', 'pipeline.js'), 'run'], {
      cwd: path.join(__dirname, '..', '..'),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, PG_POOL_MAX: '3', PIPELINE_RUN_ID: runId },
    });
    child.unref();
    fs.closeSync(logFd);
    child.on('close', (exitCode) => {
      pipelineState.running = false;
      const statusData = readJSON(PIPELINE_STATUS_PATH, {});
      pipelineState.lastResult = resolveRunOutcome({
        fileLastResult: statusData.lastResult,
        runId,
        exitCode,
      });
    });

    res.json({ status: 'started' });
  } catch (err) {
    pipelineState.running = false;
    return safeError(res, err, 'POST /api/pipeline/run');
  }
});

// GET /api/pipeline/status
router.get('/status', requirePermission('accounting.invoices.manage_retention'), (req, res) => {
  try {
    const fileStatus = readJSON(PIPELINE_STATUS_PATH, {});
    res.json({
      running:    pipelineState.running,
      lastRun:    pipelineState.lastRun || fileStatus.lastRun || null,
      lastResult: pipelineState.lastResult || fileStatus.lastResult || null,
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/pipeline/status');
  }
});

// GET /api/pipeline/errors
router.get('/errors', requirePermission('accounting.invoices.manage_settings'), validate(pipelineErrorsQuerySchema, 'query'), async (req, res) => {
  try {
    const { resolved = 'false' } = req.query;
    const { limit, offset } = getPagination(req.query);
    const rows = await listPipelineErrors({ resolved, limit, offset });
    res.json(rows.map(r => ({
      id: r.id,
      emailMessageId: r.email_message_id,
      emailSubject: r.email_subject,
      emailFrom: r.email_from,
      errorMessage: r.error_message,
      errorStage: r.error_stage,
      retryCount: r.retry_count,
      maxRetries: r.max_retries,
      resolved: r.resolved,
      createdAt: r.created_at?.toISOString(),
      lastRetryAt: r.last_retry_at?.toISOString(),
    })));
  } catch (err) {
    return safeError(res, err, 'GET /api/pipeline/errors');
  }
});

// POST /api/pipeline/errors/:id/resolve
router.post('/errors/:id/resolve', requirePermission('accounting.invoices.manage_settings'), validate(resourceIdParamsSchema, 'params'), validate(pipelineErrorResolveSchema), async (req, res) => {
  try {
    await resolvePipelineError(req.params.id);
    res.json({ resolved: true });
  } catch (err) {
    return safeError(res, err, 'POST /api/pipeline/errors/:id/resolve');
  }
});

// POST /api/pipeline/errors/:id/retry
router.post('/errors/:id/retry', requirePermission('accounting.invoices.manage_settings'), validate(resourceIdParamsSchema, 'params'), async (req, res) => {
  try {
    await retryPipelineError(req.params.id);
    res.json({ reset: true });
  } catch (err) {
    return safeError(res, err, 'POST /api/pipeline/errors/:id/retry');
  }
});

// GET /api/pipeline/skips — recent attachment skips (all filter layers), paginated.
// Audit/rescue surface for the junk filtering system; see
// docs/specs/invoices/ATTACHMENT-FILTERING.md.
router.get('/skips', requirePermission('accounting.invoices.manage_settings'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    const rows = await listSkips({ limit, offset });
    res.json(rows.map(r => ({
      id: Number(r.id),
      fileName: r.file_name,
      fileSizeBytes: r.file_size_bytes,
      sha256: r.sha256,
      reason: r.reason,
      emailFrom: r.email_from,
      emailSubject: r.email_subject,
      emailMessageId: r.email_message_id,
      skippedAt: r.skipped_at?.toISOString(),
      junkCached: r.junk_cached === true,
    })));
  } catch (err) {
    return safeError(res, err, 'GET /api/pipeline/skips');
  }
});

// POST /api/pipeline/skips/:id/rescue — un-junk a skipped attachment: removes
// its hash from junk_attachments (if cached) and returns the email context
// needed to reprocess (re-forward the email or re-run the pipeline on it).
router.post('/skips/:id/rescue', requirePermission('accounting.invoices.manage_settings'), validate(resourceIdParamsSchema, 'params'), async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return fail(res, 400, 'Skip id must be numeric');
    const result = await rescueSkip(req.params.id);
    if (!result) return fail(res, 404, 'Skip entry not found');
    const { skip, junkRemoved } = result;
    res.json({
      rescued: true,
      junkHashRemoved: junkRemoved,
      skip: {
        id: Number(skip.id),
        fileName: skip.file_name,
        fileSizeBytes: skip.file_size_bytes,
        sha256: skip.sha256,
        reason: skip.reason,
        emailFrom: skip.email_from,
        emailSubject: skip.email_subject,
        emailMessageId: skip.email_message_id,
        skippedAt: skip.skipped_at?.toISOString(),
      },
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/pipeline/skips/:id/rescue');
  }
});

module.exports = router;
module.exports.pipelineState = pipelineState;
module.exports.resolveRunOutcome = resolveRunOutcome;
