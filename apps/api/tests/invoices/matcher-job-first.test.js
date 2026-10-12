'use strict';

// B1 (2026-07-24): job-first matching. A subcontract's numbering prefix does
// not always match its Spectrum job (real cases: DMA sub 25-434.08 on job
// 26-434; Halden Brookie sub 26-113.13 on job 26-413). Whenever a sub number is
// the matching evidence, the job MUST be resolved through Spectrum's sub→job
// link — the prefix is only a fallback when the sub isn't in the sidecar.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const root = path.resolve(__dirname, '..', '..');

// Sidecar fixtures: a mis-prefixed active sub, and a closed sub (no active row).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matcher-job-first-'));
const SUBS_PATH = path.join(tmpDir, 'subcontracts.json');
const JOBS_PATH = path.join(tmpDir, 'jobs.json');
fs.writeFileSync(SUBS_PATH, JSON.stringify([
  { subcontract_number: '25-434.08', job: '26-434', status: 'Active', phases: [] },
  { subcontract_number: '11-111.11', job: '11-999', status: 'Closed', phases: [] },
]));
fs.writeFileSync(JOBS_PATH, JSON.stringify([
  { Job_Number: '26-434', Job_Description: 'Brightwater' },
  { Job_Number: '25-434', Job_Description: 'Prior-year job that shares the sub prefix' },
]));

function loadMatcherWithFixtures() {
  const realConfig = require(path.join(root, 'config'));
  const mockedConfig = { ...realConfig, SUBCONTRACTS_PATH: SUBS_PATH, JOBS_PATH: JOBS_PATH };
  const resolved = require.resolve(path.join(root, 'modules/invoices/services/matcher.js'));
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../../../config') return mockedConfig;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
  }
}

const matcher = loadMatcherWithFixtures();

// --- findSubcontractJob: the sub→job link ---

test('findSubcontractJob resolves the Spectrum job, not the sub prefix', () => {
  assert.equal(matcher.findSubcontractJob('25-434.08'), '26-434');
});

test('findSubcontractJob falls back to non-Active rows when no Active row exists', () => {
  assert.equal(matcher.findSubcontractJob('11-111.11'), '11-999');
});

test('findSubcontractJob returns null for unknown subs and blank input', () => {
  assert.equal(matcher.findSubcontractJob('99-799.99'), null);
  assert.equal(matcher.findSubcontractJob(''), null);
  assert.equal(matcher.findSubcontractJob(null), null);
});

// --- resolveJobNumber: extracted sub number path (il7x regression) ---

test('extracted sub number yields the Spectrum job even when the prefix job exists', async () => {
  // Job "25-434" exists in the jobs sidecar — the old prefix derivation would
  // have returned it. The sub's real job is 26-434.
  const result = await matcher.resolveJobNumber({ jobNumber: '25-434.08' });
  assert.equal(result.jobNumber, '26-434');
  assert.equal(result.subcontractNumber, '25-434.08');
  assert.equal(result.method, 'extracted-subcontract');
  assert.equal(result.confidence, 0.99);
});

test('unknown sub number falls back to the prefix at reduced confidence', async () => {
  const result = await matcher.resolveJobNumber({ jobNumber: '99-799.99' });
  assert.equal(result.jobNumber, '99-799');
  assert.equal(result.subcontractNumber, '99-799.99');
  assert.equal(result.method, 'extracted-subcontract');
  assert.equal(result.confidence, 0.7);
});

// --- resolveJobNumber: subject-line sub number path ---

test('subject-line sub number resolves the job through the sidecar link', async () => {
  const result = await matcher.resolveJobNumber({ emailSubject: 'PO 25-434.08 billing' });
  assert.equal(result.jobNumber, '26-434');
  assert.equal(result.subcontractNumber, '25-434.08');
  assert.equal(result.method, 'subject-line');
});
