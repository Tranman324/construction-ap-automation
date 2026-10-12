'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { resolveRunOutcome } = require('../../modules/invoices/routes/pipeline');

const MINTED = 'run-1757000000000-deadbeef';

test('accepts the status-file result when runId matches and exit is clean', () => {
  const fileLastResult = { runId: MINTED, processed: 7, queued: 3, errors: 0, durationMs: 1200 };

  const outcome = resolveRunOutcome({ fileLastResult, runId: MINTED, exitCode: 0 });

  assert.deepEqual(outcome, fileLastResult);
  assert.equal(outcome.failed, undefined);
});

test('stale result from a previous run is rejected as an explicit failure, never stale success', () => {
  // Repro of the QA finding: child dies before writing the status file, so the
  // file still holds a prior run's counts under a different runId.
  const fileLastResult = { runId: 'run-1756990000000', processed: 7, queued: 3, errors: 0 };

  const outcome = resolveRunOutcome({ fileLastResult, runId: MINTED, exitCode: 1 });

  assert.deepEqual(outcome, { processed: 0, queued: 0, errors: 0, failed: true, runId: MINTED });
});

test('missing status file yields an explicit failure', () => {
  const outcome = resolveRunOutcome({ fileLastResult: undefined, runId: MINTED, exitCode: 0 });

  assert.deepEqual(outcome, { processed: 0, queued: 0, errors: 0, failed: true, runId: MINTED });
});

test('matching result with non-zero exit is preserved but flagged failed', () => {
  const fileLastResult = { runId: MINTED, processed: 2, queued: 1, errors: 1 };

  const outcome = resolveRunOutcome({ fileLastResult, runId: MINTED, exitCode: 1 });

  assert.deepEqual(outcome, { ...fileLastResult, failed: true });
});

test('a concurrent cron run result (different runId) does not masquerade as this run', () => {
  // Cron self-mints run-<startTime>; even a fresh cron success must not be
  // reported as the manual run's result.
  const fileLastResult = { runId: 'run-1757000000123', processed: 5, queued: 2, errors: 0 };

  const outcome = resolveRunOutcome({ fileLastResult, runId: MINTED, exitCode: 1 });

  assert.equal(outcome.failed, true);
  assert.equal(outcome.processed, 0);
});

test('service status writes use the shared config PIPELINE_STATUS_PATH the routes read', () => {
  // Regression guard for the path divergence found live 2026-09-04: the
  // service wrote pipeline-status.json under its own DATA_DIR while the
  // routes read config PIPELINE_STATUS_PATH — so GET /status served a file
  // frozen months earlier and every run's result looked stale.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'modules', 'invoices', 'services', 'pipeline.js'),
    'utf8',
  );

  assert.doesNotMatch(source, /path\.join\(DATA_DIR,\s*['"]pipeline-status\.json['"]\)/);
  assert.match(source, /\bPIPELINE_STATUS_PATH\b[\s\S]*require\('\.\.\/\.\.\/\.\.\/config'\)/);
});

test('legacy result without a runId is never accepted', () => {
  const fileLastResult = { processed: 4, queued: 4, errors: 0 };

  const outcome = resolveRunOutcome({ fileLastResult, runId: MINTED, exitCode: 0 });

  assert.deepEqual(outcome, { processed: 0, queued: 0, errors: 0, failed: true, runId: MINTED });
});
