'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function submissionEntry(docId, invoiceNumber, vendorCode) {
  const row = { id: docId, invoice_number: invoiceNumber, vendor_code: vendorCode };
  return {
    docId,
    row,
    invoice: { Invoice_Number: invoiceNumber, Vendor_Code: vendorCode },
  };
}

function successResult(entry) {
  return {
    Invoice_Number: entry.invoice.Invoice_Number,
    Vendor_Code: entry.invoice.Vendor_Code,
    Success: true,
  };
}

function rejectedResult(entry, error = 'Spectrum rejected this invoice') {
  return {
    Invoice_Number: entry.invoice.Invoice_Number,
    Vendor_Code: entry.invoice.Vendor_Code,
    Success: false,
    Error_Message: error,
  };
}

async function runApply(entries, spectrumInvoices, options = {}) {
  const finalized = [];
  const reverted = [];
  const audited = [];
  const logs = [];
  const pool = {
    async query(sql) {
      if (/WHERE linked_to/.test(sql)) return { rows: [] };
      if (/SELECT linked_lien_waiver_id FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ linked_lien_waiver_id: null }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await withMockedModules({
    './submitState': {
      finalizeSubmittedInvoice: async (_pool, docId) => {
        finalized.push(docId);
        if (options.finalizeFailsFor === docId) throw new Error(`finalize failed for ${docId}`);
      },
      logSubmitError: (_requestLog, operation, context, message) => logs.push({ operation, context, message }),
      normalizeSubmitError: (message, fallback) => message || fallback,
      revertClaimedInvoices: async (_pool, ids) => {
        reverted.push(...ids);
        if (options.revertFailsFor && ids.includes(options.revertFailsFor)) {
          throw new Error(`revert failed for ${options.revertFailsFor}`);
        }
      },
    },
    '../../../lib/auditEvents': {
      emitInvoiceAuditEvent: async (_req, _res, event) => {
        if (options.auditFailsFor === event.invoiceId) throw new Error(`audit failed for ${event.invoiceId}`);
      },
    },
  }, async () => {
    const { applySpectrumResults } = freshRequire('modules/invoices/services/submitResult.js');
    options.results = await applySpectrumResults({
      pool,
      audit: async (docId) => {
        audited.push(docId);
        if (options.auditFailsFor === docId) throw new Error(`audit failed for ${docId}`);
      },
      req: { user: { email: 'reviewer@example.com' } },
      res: { locals: {} },
      now: '2026-07-15T12:00:00.000Z',
      spectrumResp: { statusCode: 200, body: { APInvoices: spectrumInvoices } },
      submissionEntries: entries,
      requestLog: {
        debug() {},
        error(...args) { logs.push({ operation: args[0]?.operation, message: args[1] }); },
      },
    });
  });

  return { audited, finalized, logs, results: options.results, reverted };
}

async function runSubmitWithDuplicatePreflight(duplicateRows, ids = ['doc-a', 'doc-b']) {
  let claimCalls = 0;
  let postCalls = 0;
  let responseStatus = null;
  let responseBody = null;
  const requestLog = { error() {}, info() {} };

  const pool = {
    async query(sql, params) {
      assert.match(sql, /SELECT id, vendor_code, invoice_number/);
      assert.match(sql, /status IN \('approved', 'submitting', 'submitted'\)/);
      assert.deepEqual(params, [ids]);
      return { rows: duplicateRows };
    },
  };

  await withMockedModules({
    '../../../lib/logger': requestLog,
    './supabase': { pool, audit: async () => {} },
    './spectrum': {
      postToSpectrum: async () => {
        postCalls += 1;
      },
    },
    './submitPayload': {
      buildSpectrumSubmission: async () => assert.fail('payload build must not run'),
      validateSubmissionGlAccounts: () => ({
        ok: true,
        errors: [],
        unresolvedGlAccounts: [],
      }),
    },
    './submitResult': {
      applySpectrumResults: async () => assert.fail('result handling must not run'),
      spectrumInvoiceIdentity(value) {
        const vendorCode = value && (value.Vendor_Code ?? value.vendor_code);
        const invoiceNumber = value && (value.Invoice_Number ?? value.invoice_number);
        if (vendorCode == null || invoiceNumber == null) return null;
        const normalizedVendorCode = String(vendorCode).trim();
        const normalizedInvoiceNumber = String(invoiceNumber).trim();
        return normalizedVendorCode && normalizedInvoiceNumber
          ? JSON.stringify([normalizedVendorCode, normalizedInvoiceNumber])
          : null;
      },
    },
    './submitState': {
      claimInvoicesForSubmit: async () => {
        claimCalls += 1;
        return [];
      },
      logSubmitError() {},
      revertClaimedInvoices: async () => assert.fail('claim rollback must not run'),
    },
  }, async () => {
    const { submitInvoices } = freshRequire('modules/invoices/services/submitWorkflow.js');
    await submitInvoices(
      { body: { ids, overrides: {} }, log: requestLog },
      {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(body) {
          responseBody = body;
          return body;
        },
      }
    );
  });

  return { claimCalls, postCalls, responseBody, responseStatus };
}

async function runWorkflowWithMalformedSpectrumResults() {
  let postCalls = 0;
  let responseBody = null;
  const reverts = [];
  const logs = [];
  const requestLog = {
    debug() {},
    error(entry, message) { logs.push({ ...entry, message }); },
    info() {},
  };
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const pool = {
    async query(sql, params) {
      assert.match(sql, /SELECT id, vendor_code, invoice_number/);
      assert.deepEqual(params, [['doc-a']]);
      return { rows: [invoiceA.row] };
    },
  };

  delete require.cache[require.resolve(path.join(root, 'modules/invoices/services/submitResult.js'))];
  await withMockedModules({
    '../../../lib/logger': requestLog,
    '../../../lib/auditEvents': { emitInvoiceAuditEvent: async () => {} },
    './supabase': { pool, audit: async () => {} },
    './spectrum': {
      findSpectrumInvoice: async () => null,
      postToSpectrum: async () => {
        postCalls += 1;
        return { statusCode: 200, body: { APInvoices: { malformed: true } } };
      },
    },
    './submitPayload': {
      buildSpectrumSubmission: async () => ({
        APInvoices: [invoiceA.invoice],
        submissionEntries: [invoiceA],
        validation: { ok: true, errors: [] },
      }),
      validateSubmissionGlAccounts: () => ({
        ok: true,
        errors: [],
        unresolvedGlAccounts: [],
      }),
    },
    './submitState': {
      claimInvoicesForSubmit: async () => [invoiceA.row],
      finalizeSubmittedInvoice: async () => assert.fail('malformed results must not finalize'),
      logSubmitError: (_requestLog, operation, context, message) => logs.push({ operation, context, message }),
      normalizeSubmitError: (message, fallback) => message || fallback,
      revertClaimedInvoices: async (_pool, ids, message, _requestLog, context) => {
        reverts.push({ ids, message, context });
      },
    },
  }, async () => {
    const { submitInvoices } = freshRequire('modules/invoices/services/submitWorkflow.js');
    await submitInvoices(
      { body: { ids: ['doc-a'], overrides: {} }, log: requestLog },
      { json(body) { responseBody = body; return body; } }
    );
  });

  return { logs, postCalls, responseBody, reverts };
}

function currentOpenInvoiceDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function submitCandidate(overrides = {}) {
  return {
    id: 'doc-a',
    status: 'approved',
    classification: 'invoice',
    submit_error: null,
    vendor_code: 'VEND-A',
    invoice_number: 'INV-A',
    amount: '100.00',
    job_number: null,
    job_match_number: null,
    subcontract_number: null,
    invoice_date: currentOpenInvoiceDate(),
    file_path: null,
    merged_file_path: null,
    gl_account: null,
    phase_code: null,
    cost_type: 'L',
    routing_code: 'D',
    multi_phase_candidate: false,
    phase_allocations: null,
    ...overrides,
  };
}

async function runSubmitGlRefusal({
  candidateRows,
  claimedRows = candidateRows,
  ids = candidateRows.map((row) => row.id),
  submitAll = false,
}) {
  let auditCalls = 0;
  let claimCalls = 0;
  let resultCalls = 0;
  let responseStatus = 200;
  let responseBody = null;
  let spectrumLookupCalls = 0;
  const postedGlAccounts = [];
  const reverts = [];
  const requestLog = { debug() {}, error() {}, info() {} };
  const requestIds = submitAll ? undefined : ids;
  const pool = {
    async query(sql, params) {
      assert.match(sql, /SELECT id, vendor_code, invoice_number/);
      assert.deepEqual(params, submitAll ? [] : [ids]);
      return { rows: candidateRows };
    },
  };

  await withMockedModules({
    '../../../lib/logger': requestLog,
    './supabase': {
      pool,
      audit: async () => {
        auditCalls += 1;
      },
    },
    './spectrum': {
      findSpectrumInvoice: async () => {
        spectrumLookupCalls += 1;
        return null;
      },
      lookupPhaseCode: async () => null,
      postToSpectrum: async ({ APInvoices }) => {
        postedGlAccounts.push(...APInvoices.flatMap((invoice) => (
          invoice.APInvoiceDetails.map((detail) => detail.Distribution.GL_Account)
        )));
        return { statusCode: 200, body: { APInvoices: [] } };
      },
    },
    './submitResult': {
      applySpectrumResults: async () => {
        resultCalls += 1;
        return claimedRows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoice_number,
          success: true,
        }));
      },
      spectrumInvoiceIdentity(value) {
        const vendorCode = value && (value.Vendor_Code ?? value.vendor_code);
        const invoiceNumber = value && (value.Invoice_Number ?? value.invoice_number);
        if (vendorCode == null || invoiceNumber == null) return null;
        return JSON.stringify([String(vendorCode).trim(), String(invoiceNumber).trim()]);
      },
    },
    './submitState': {
      claimInvoicesForSubmit: async () => {
        claimCalls += 1;
        for (const row of claimedRows) row.status = 'submitting';
        return claimedRows;
      },
      logSubmitError() {},
      revertClaimedInvoices: async (_pool, revertedIds, message, _log, context) => {
        for (const row of claimedRows) {
          if (revertedIds.includes(row.id)) row.status = 'approved';
        }
        reverts.push({ ids: revertedIds, message, context });
      },
    },
    './pdf': { ensurePdf: async () => null },
    './matching': { getSubcontractsMap: () => ({}) },
    './submitRouting': { loadJobPmMap: () => ({ pmToRouting: {}, jobPmMap: {} }) },
    './spectrumValidation': { validatePayload: () => ({ ok: true, errors: [] }) },
  }, async () => {
    const { submitInvoices } = freshRequire('modules/invoices/services/submitWorkflow.js');
    await submitInvoices(
      { body: { ids: requestIds, overrides: {} }, log: requestLog },
      {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(body) {
          responseBody = body;
          return body;
        },
      }
    );
  });

  return {
    auditCalls,
    claimCalls,
    postedGlAccounts,
    responseBody,
    responseStatus,
    resultCalls,
    reverts,
    spectrumLookupCalls,
  };
}

async function runSubmitClosedPeriodRefusal(row) {
  let claimCalls = 0;
  let payloadBuildCalls = 0;
  let postCalls = 0;
  let responseStatus = 200;
  let responseBody = null;
  let spectrumLookupCalls = 0;
  const requestLog = { debug() {}, error() {}, info() {} };
  const pool = {
    async query(sql, params) {
      assert.match(sql, /SELECT id, vendor_code, invoice_number/);
      assert.deepEqual(params, [['doc-a']]);
      return { rows: [row] };
    },
  };

  await withMockedModules({
    '../../../lib/logger': requestLog,
    './supabase': { pool, audit: async () => assert.fail('audit must not run') },
    './spectrum': {
      findSpectrumInvoice: async () => {
        spectrumLookupCalls += 1;
        return null;
      },
      postToSpectrum: async () => {
        postCalls += 1;
        assert.fail('Spectrum post must not run');
      },
    },
    './submitPayload': {
      buildSpectrumSubmission: async () => {
        payloadBuildCalls += 1;
        assert.fail('payload build must not run');
      },
      validateSubmissionGlAccounts: () => ({
        ok: true,
        errors: [],
        unresolvedGlAccounts: [],
      }),
    },
    './submitResult': {
      applySpectrumResults: async () => assert.fail('result handling must not run'),
      spectrumInvoiceIdentity(value) {
        return JSON.stringify([value.vendor_code, value.invoice_number]);
      },
    },
    './submitState': {
      claimInvoicesForSubmit: async () => {
        claimCalls += 1;
        assert.fail('claim must not run');
      },
      logSubmitError() {},
      revertClaimedInvoices: async () => assert.fail('claim rollback must not run'),
    },
  }, async () => {
    const { submitInvoices } = freshRequire('modules/invoices/services/submitWorkflow.js');
    await submitInvoices(
      { body: { ids: ['doc-a'], overrides: {} }, log: requestLog },
      {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(body) {
          responseBody = body;
          return body;
        },
      }
    );
  });

  return {
    claimCalls,
    payloadBuildCalls,
    postCalls,
    responseBody,
    responseStatus,
    spectrumLookupCalls,
  };
}

test('matches shuffled Spectrum results by Vendor_Code and Invoice_Number instead of response position', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const invoiceB = submissionEntry('doc-b', 'INV-B', 'VEND-B');
  const outcome = await runApply(
    [invoiceA, invoiceB],
    [rejectedResult(invoiceB), successResult(invoiceA)]
  );

  assert.deepEqual(outcome.finalized, ['doc-a']);
  assert.deepEqual(outcome.reverted, ['doc-b']);
  assert.deepEqual(outcome.results.map(({ id, success }) => ({ id, success })), [
    { id: 'doc-a', success: true },
    { id: 'doc-b', success: false },
  ]);
});

test('a missing or unmatched Spectrum result reverts only the invoice without an identity match', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const invoiceB = submissionEntry('doc-b', 'INV-B', 'VEND-B');
  const outcome = await runApply([invoiceA, invoiceB], [successResult(invoiceB)]);

  assert.deepEqual(outcome.finalized, ['doc-b']);
  assert.deepEqual(outcome.reverted, ['doc-a']);
  assert.deepEqual(outcome.results.map(({ id, success }) => ({ id, success })), [
    { id: 'doc-a', success: false },
    { id: 'doc-b', success: true },
  ]);
});

test('an extra Spectrum result cannot be applied positionally to a submitted invoice', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const extraInvoice = submissionEntry('doc-extra', 'INV-EXTRA', 'VEND-EXTRA');
  const outcome = await runApply([invoiceA], [successResult(extraInvoice), successResult(invoiceA)]);

  assert.deepEqual(outcome.finalized, ['doc-a']);
  assert.deepEqual(outcome.reverted, []);
  assert.equal(outcome.results.length, 1);
  assert.ok(outcome.logs.some((entry) => entry.operation === 'invoice.submit.spectrum_result_response'));
});

test('multiple Spectrum results for one identity are ambiguous rather than consumed FIFO', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const outcome = await runApply([invoiceA], [successResult(invoiceA), rejectedResult(invoiceA)]);

  assert.deepEqual(outcome.finalized, []);
  assert.deepEqual(outcome.reverted, ['doc-a']);
  assert.equal(outcome.results[0].error, 'Spectrum returned multiple results for this invoice identity');
});

test('a malformed truthy APInvoices response is contained per invoice without throwing to workflow rollback', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const invoiceB = submissionEntry('doc-b', 'INV-B', 'VEND-B');
  const outcome = await runApply([invoiceA, invoiceB], { unexpected: true });

  assert.deepEqual(outcome.finalized, []);
  assert.deepEqual(outcome.reverted, ['doc-a', 'doc-b']);
  assert.deepEqual(outcome.results.map(({ id, success, error }) => ({ id, success, error })), [
    { id: 'doc-a', success: false, error: 'Spectrum returned an invalid invoice result list' },
    { id: 'doc-b', success: false, error: 'Spectrum returned an invalid invoice result list' },
  ]);
  assert.ok(outcome.logs.some((entry) => entry.operation === 'invoice.submit.spectrum_result_response'));
});

test('duplicate local Vendor_Code and Invoice_Number pairs are rejected before any claim or Spectrum post', async () => {
  const outcome = await runSubmitWithDuplicatePreflight([
    {
      id: 'doc-a', vendor_code: ' VEND-A ', invoice_number: ' INV-A ',
      status: 'approved', amount: '100.00', job_match_number: '26-407',
    },
    {
      id: 'doc-b', vendor_code: 'VEND-A', invoice_number: 'INV-A',
      status: 'approved', amount: '200.00', job_number: '26-408',
    },
  ]);

  assert.equal(outcome.responseStatus, 400);
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.postCalls, 0);
  assert.deepEqual(outcome.responseBody.details.duplicates, [{
    vendorCode: 'VEND-A',
    invoiceNumber: 'INV-A',
    documentIds: ['doc-a', 'doc-b'],
    reason: 'batch_duplicate',
    documents: [
      { id: 'doc-a', status: 'approved', jobNumber: '26-407', amount: 100 },
      { id: 'doc-b', status: 'approved', jobNumber: '26-408', amount: 200 },
    ],
  }]);
});

test('a selected invoice is blocked when another eligible local document has its identity', async () => {
  const outcome = await runSubmitWithDuplicatePreflight([
    { id: 'doc-a', vendor_code: 'VEND-A', invoice_number: 'INV-A' },
    { id: 'doc-b', vendor_code: ' VEND-A ', invoice_number: ' INV-A ' },
  ], ['doc-a']);

  assert.equal(outcome.responseStatus, 400);
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.postCalls, 0);
  assert.deepEqual(outcome.responseBody.details.duplicates[0].documentIds, ['doc-a', 'doc-b']);
});

test('a selected approved invoice is blocked when a submitted local document has its identity', async () => {
  const outcome = await runSubmitWithDuplicatePreflight([
    { id: 'doc-approved', vendor_code: 'VEND-A', invoice_number: 'INV-A' },
    { id: 'doc-submitted', vendor_code: ' VEND-A ', invoice_number: ' INV-A ' },
  ], ['doc-approved']);

  assert.equal(outcome.responseStatus, 400);
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.postCalls, 0);
  assert.deepEqual(outcome.responseBody.details.duplicates[0].documentIds, ['doc-approved', 'doc-submitted']);
});

test('an unresolved GL wins over a duplicate identity before claim or Spectrum I/O', async () => {
  const selected = submitCandidate();
  const submittedDuplicate = submitCandidate({
    id: 'doc-submitted',
    status: 'submitted',
    gl_account: '5300',
    cost_type: 'M',
  });
  const outcome = await runSubmitGlRefusal({
    candidateRows: [selected, submittedDuplicate],
    ids: ['doc-a'],
  });

  assert.equal(outcome.responseStatus, 422);
  assert.equal(outcome.responseBody.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.deepEqual(outcome.responseBody.details.unresolvedGlAccounts, [{
    id: 'doc-a',
    invoiceNumber: 'INV-A',
    costType: 'L',
  }]);
  assert.equal(outcome.spectrumLookupCalls, 0);
  assert.deepEqual(outcome.postedGlAccounts, []);
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.resultCalls, 0);
  assert.equal(outcome.auditCalls, 0);
  assert.deepEqual(outcome.reverts, []);
  assert.equal(selected.status, 'approved');
  assert.equal(submittedDuplicate.status, 'submitted');
});

test('a resolvable GL preserves duplicate identity rejection before claim or Spectrum I/O', async () => {
  const selected = submitCandidate({ gl_account: '5300', cost_type: 'M' });
  const submittedDuplicate = submitCandidate({
    id: 'doc-submitted',
    status: 'submitted',
    gl_account: '5300',
    cost_type: 'M',
  });
  const outcome = await runSubmitGlRefusal({
    candidateRows: [selected, submittedDuplicate],
    ids: ['doc-a'],
  });

  assert.equal(outcome.responseStatus, 400);
  assert.equal(outcome.responseBody.code, undefined);
  assert.deepEqual(outcome.responseBody.details.duplicates, [{
    vendorCode: 'VEND-A',
    invoiceNumber: 'INV-A',
    documentIds: ['doc-a', 'doc-submitted'],
    reason: 'already_submitted',
    documents: [
      { id: 'doc-a', status: 'approved', jobNumber: null, amount: 100 },
      { id: 'doc-submitted', status: 'submitted', jobNumber: null, amount: 100 },
    ],
  }]);
  assert.equal(outcome.spectrumLookupCalls, 0);
  assert.deepEqual(outcome.postedGlAccounts, []);
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.resultCalls, 0);
  assert.equal(outcome.auditCalls, 0);
  assert.deepEqual(outcome.reverts, []);
  assert.equal(selected.status, 'approved');
  assert.equal(submittedDuplicate.status, 'submitted');
});

test('a malformed Spectrum result response stays within applySpectrumResults after a post', async () => {
  const outcome = await runWorkflowWithMalformedSpectrumResults();

  assert.equal(outcome.postCalls, 1);
  assert.equal(outcome.responseBody.success, false);
  assert.equal(outcome.responseBody.results[0].error, 'Spectrum returned an invalid invoice result list');
  assert.deepEqual(outcome.reverts, [{
    ids: ['doc-a'],
    message: 'Spectrum returned an invalid invoice result list',
    context: { docId: 'doc-a', reason: 'malformed_spectrum_result_response' },
  }]);
  assert.equal(outcome.reverts.some(({ context }) => context?.reason === 'unexpected_submit_failure'), false);
});

test('a finalization bookkeeping failure for one invoice does not abort or revert another acknowledgement', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const invoiceB = submissionEntry('doc-b', 'INV-B', 'VEND-B');
  const outcome = await runApply(
    [invoiceA, invoiceB],
    [successResult(invoiceA), successResult(invoiceB)],
    { finalizeFailsFor: 'doc-a' }
  );

  assert.deepEqual(outcome.finalized, ['doc-a', 'doc-b']);
  assert.deepEqual(outcome.reverted, []);
  assert.deepEqual(outcome.results.map(({ id, success }) => ({ id, success })), [
    { id: 'doc-a', success: false },
    { id: 'doc-b', success: true },
  ]);
});

test('single submit refuses an unresolvable GL before claim, Spectrum, local writes, or audit', async () => {
  const row = submitCandidate();
  const outcome = await runSubmitGlRefusal({ candidateRows: [row] });

  assert.deepEqual(outcome.postedGlAccounts, []);
  assert.equal(outcome.responseStatus, 422);
  assert.equal(outcome.responseBody.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.match(outcome.responseBody.error, /GL account/i);
  assert.deepEqual(outcome.responseBody.details.unresolvedGlAccounts, [{
    id: 'doc-a',
    invoiceNumber: 'INV-A',
    costType: 'L',
  }]);
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.resultCalls, 0);
  assert.equal(outcome.auditCalls, 0);
  assert.deepEqual(outcome.reverts, []);
  assert.equal(row.status, 'approved');
});

test('single submit refuses a whitespace-only served GL mapping before claim, Spectrum, local writes, or audit', async () => {
  const approvalRules = require('../../modules/invoices/services/approvalRules.json');
  const originalMapping = approvalRules.codingDefaults.costTypeGlMap.map.M;
  approvalRules.codingDefaults.costTypeGlMap.map.M = '   ';
  try {
    const row = submitCandidate({ cost_type: 'M' });
    const outcome = await runSubmitGlRefusal({ candidateRows: [row] });

    assert.deepEqual(outcome.postedGlAccounts, []);
    assert.equal(outcome.responseStatus, 422);
    assert.equal(outcome.responseBody.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
    assert.match(outcome.responseBody.error, /GL account/i);
    assert.deepEqual(outcome.responseBody.details.unresolvedGlAccounts, [{
      id: 'doc-a',
      invoiceNumber: 'INV-A',
      costType: 'M',
    }]);
    assert.equal(outcome.claimCalls, 0);
    assert.equal(outcome.resultCalls, 0);
    assert.equal(outcome.auditCalls, 0);
    assert.deepEqual(outcome.reverts, []);
    assert.equal(row.status, 'approved');
  } finally {
    approvalRules.codingDefaults.costTypeGlMap.map.M = originalMapping;
  }
});

test('bulk submit refuses the whole batch when any GL is unresolvable before side effects', async () => {
  const valid = submitCandidate({
    id: 'doc-valid',
    vendor_code: 'VEND-VALID',
    invoice_number: 'INV-VALID',
    gl_account: '5300',
    cost_type: 'M',
  });
  const invalid = submitCandidate({
    id: 'doc-invalid',
    vendor_code: 'VEND-INVALID',
    invoice_number: 'INV-INVALID',
  });
  const outcome = await runSubmitGlRefusal({ candidateRows: [valid, invalid] });

  assert.deepEqual(outcome.postedGlAccounts, []);
  assert.equal(outcome.responseStatus, 422);
  assert.equal(outcome.responseBody.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.deepEqual(
    outcome.responseBody.details.unresolvedGlAccounts.map(({ id }) => id),
    ['doc-invalid']
  );
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.resultCalls, 0);
  assert.equal(outcome.auditCalls, 0);
  assert.deepEqual(outcome.reverts, []);
  assert.equal(valid.status, 'approved');
  assert.equal(invalid.status, 'approved');
});

test('submit-all queue requests use the same pre-claim GL refusal', async () => {
  const row = submitCandidate();
  const outcome = await runSubmitGlRefusal({
    candidateRows: [row],
    submitAll: true,
  });

  assert.deepEqual(outcome.postedGlAccounts, []);
  assert.equal(outcome.responseStatus, 422);
  assert.equal(outcome.responseBody.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.resultCalls, 0);
  assert.equal(outcome.auditCalls, 0);
  assert.deepEqual(outcome.reverts, []);
  assert.equal(row.status, 'approved');
});

test('a GL that becomes unresolvable during claim is reverted and returns the same 422 without dispatch or audit', async () => {
  const preflightRow = submitCandidate({ gl_account: '5300', cost_type: 'M' });
  const claimedRow = submitCandidate({ gl_account: null, cost_type: 'L' });
  const outcome = await runSubmitGlRefusal({
    candidateRows: [preflightRow],
    claimedRows: [claimedRow],
  });

  assert.deepEqual(outcome.postedGlAccounts, []);
  assert.equal(outcome.responseStatus, 422);
  assert.equal(outcome.responseBody.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.match(outcome.responseBody.error, /GL account/i);
  assert.deepEqual(outcome.responseBody.details.unresolvedGlAccounts, [{
    id: 'doc-a',
    invoiceNumber: 'INV-A',
    costType: 'L',
  }]);
  assert.equal(outcome.claimCalls, 1);
  assert.equal(outcome.resultCalls, 0);
  assert.equal(outcome.auditCalls, 0);
  assert.deepEqual(outcome.reverts, [{
    ids: ['doc-a'],
    message: 'Submission validation failed: GL account could not be resolved',
    context: { reason: 'unresolvable_gl_account_after_claim' },
  }]);
  assert.equal(claimedRow.status, 'approved');
});

test('a closed canonical invoice date is blocked before claim, payload build, or Spectrum I/O', async () => {
  const { getClosedPeriodInfo } = require('../../modules/invoices/services/approvalValidator');
  const row = submitCandidate({
    invoice_date: '2024-01-15',
    gl_account: '5300',
    cost_type: 'M',
  });
  const closedPeriod = getClosedPeriodInfo(row.invoice_date);
  assert.ok(closedPeriod, 'fixture must use a closed server period');

  const outcome = await runSubmitClosedPeriodRefusal(row);

  assert.equal(outcome.responseStatus, 400);
  assert.equal(outcome.responseBody.code, 'CLOSED_PERIOD_DATE');
  assert.match(outcome.responseBody.error, /invoice date falls in .*closed period/i);
  assert.deepEqual(outcome.responseBody.details, {
    invoiceDateMonth: closedPeriod.monthKey,
    currentMonth: closedPeriod.currentMonthKey,
    suggestedInvoiceDate: closedPeriod.suggestedInvoiceDate,
    glDateMonth: closedPeriod.monthKey,
    suggestedGlDate: closedPeriod.suggestedInvoiceDate,
    nextAction: `Update the invoice date to ${closedPeriod.suggestedInvoiceDate}, then retry Spectrum submission.`,
  });
  assert.equal(outcome.claimCalls, 0);
  assert.equal(outcome.payloadBuildCalls, 0);
  assert.equal(outcome.postCalls, 0);
  assert.equal(outcome.spectrumLookupCalls, 0);
  assert.equal(row.status, 'approved');
});

// ── B3: closed-A/P-period rejection translated to "invoice date" wording ──
test('a closed-period Spectrum rejection is translated into invoice-date guidance (t23r case)', async () => {
  const { explainSpectrumRejection } = require('../../modules/invoices/services/submitResult');
  const raw = 'G/L date is outside of min/max range for A/P';
  const explained = explainSpectrumRejection(raw, { GL_Date: '06/04/2026' });
  assert.match(explained, /invoice date \(06\/04\/2026\) falls in a closed A\/P period/);
  assert.match(explained, /Edit the invoice date to a day in the current month/);
  assert.ok(explained.includes(`[Spectrum: ${raw}]`)); // raw message preserved
});

test('non-closed-period rejections pass through untranslated', async () => {
  const { explainSpectrumRejection } = require('../../modules/invoices/services/submitResult');
  assert.equal(
    explainSpectrumRejection('Job number is invalid for subcontract', { GL_Date: '07/01/2026' }),
    'Job number is invalid for subcontract'
  );
  assert.equal(explainSpectrumRejection(null, {}), '');
});

test('the translated closed-period message is what gets recorded as the submit error', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  invoiceA.invoice.GL_Date = '06/04/2026';
  const outcome = await runApply(
    [invoiceA],
    [rejectedResult(invoiceA, 'G/L date is outside of min/max range for A/P')]
  );

  assert.deepEqual(outcome.reverted, ['doc-a']);
  assert.equal(outcome.results[0].success, false);
  assert.match(outcome.results[0].error, /invoice date \(06\/04\/2026\) falls in a closed A\/P period/);
});

test('an audit bookkeeping failure for one invoice does not abort a later acknowledgement', async () => {
  const invoiceA = submissionEntry('doc-a', 'INV-A', 'VEND-A');
  const invoiceB = submissionEntry('doc-b', 'INV-B', 'VEND-B');
  const outcome = await runApply(
    [invoiceA, invoiceB],
    [successResult(invoiceA), successResult(invoiceB)],
    { auditFailsFor: 'doc-a' }
  );

  assert.deepEqual(outcome.finalized, ['doc-a', 'doc-b']);
  assert.deepEqual(outcome.reverted, []);
  assert.deepEqual(outcome.results.map(({ id, success }) => ({ id, success })), [
    { id: 'doc-a', success: false },
    { id: 'doc-b', success: true },
  ]);
});
