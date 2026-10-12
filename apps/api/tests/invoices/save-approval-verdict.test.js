'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const root = path.resolve(__dirname, '..', '..');

async function withMocks(mocks, fn) {
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return original.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = original; }
}

function fresh(relative) {
  const resolved = require.resolve(path.join(root, relative));
  delete require.cache[resolved];
  return require(resolved);
}

function res() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

function dispatch(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const req = { body, headers: {}, method, originalUrl: url, url, user: { role: 'admin', permissions: ['accounting.invoices.view_details'] }, log: { error() {}, info() {}, warn() {} }, on() {}, resume() {}, socket: {}, unpipe() {} };
    const response = { body: null, headersSent: false, locals: {}, statusCode: 200, end() { this.headersSent = true; resolve(this); }, getHeader() { return undefined; }, json(value) { this.body = value; this.headersSent = true; resolve(this); return this; }, removeHeader() {}, set() { return this; }, setHeader() {}, status(code) { this.statusCode = code; return this; } };
    app.handle(req, response, reject);
  });
}

async function withFixedClock(fn) {
  const RealDate = global.Date;
  const instant = new RealDate('2026-07-28T20:00:00.000Z');
  global.Date = class FixedDate extends RealDate { constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(instant); } static now() { return instant.getTime(); } };
  try { return await fn(); } finally { global.Date = RealDate; }
}

test('PATCH returns the same post-save approval verdict as GET validate-approval', async () => {
  const row = { id: 'invoice-1', status: 'pending', classification: 'invoice', invoice_number: 'INV-1', vendor_code: 'V-1', invoice_date: '2026-07-01', gl_date: '2026-07-01', amount: 100, job_match_number: null, subcontract_number: null, routing_code: 'D', phase_code: null, cost_type: 'M', gl_account: '5300', submit_error: null, was_modified: false };
  const pool = { async query(sql, params = []) {
    if (/FOR UPDATE/.test(sql) || /SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row], rowCount: 1 };
    if (/UPDATE documents SET/.test(sql)) { row.invoice_number = params[0]; row.was_modified = true; return { rows: [], rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const auditEvents = { checkStateMatch: () => ({ match: true }), emitInvoiceAuditEvent: async () => ({ id: 'event-1' }), emitPlatformAuditEvent: async () => null, findUndoableAction: async () => null, getRequestAuditActor: () => ({ name: 'reviewer@example.com' }), markActionUndone: async () => {} };
  const settingsService = { createCustomClassification: async () => ({}), createRetentionSetting: async () => ({}), deleteCustomClassification: async () => false, deleteRetentionSetting: async () => false, getClassificationOverride: async () => null, getDocumentById: async () => row, listRetentionSettings: async () => [], loadClassificationRows: async () => [], updateCustomClassification: async () => null, updateRetentionSetting: async () => null, upsertBuiltInClassificationOverride: async () => ({}) };
  const mocks = {
    './supabase': { pool, audit: async () => {}, rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) }, './transaction': { withTransaction: async (_pool, fn) => fn(pool) },
    './matcher': { getSubcontractPhaseInfo: () => null, recordJobFeedback() {}, recordSubcontractFeedback() {}, recordVendorFeedback() {}, recordSubjectJobFeedback() {}, recordSenderJobFeedback() {} },
    './matching': { getSubcontractsMap: () => ({}) }, './phaseOptionsService': { findSuggestedRouting: () => ({ suggestedRoutingCode: null, suggestedRoutingPm: null }) },
    '../../../lib/auditEvents': auditEvents, '../../../middleware/errorResponse': { fail: (response, status, error) => response.status(status).json({ error }), safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
    '../services/settingsService': settingsService, '../services/spectrum': { getGlAccounts: async () => [] }, '../services/utils': { readJSON: () => [] }, '../../../config': { DATA_DIR: '/fixture/data' },
    '/etc/toolbox/paths.js': { BOX_SCRIPT: '/fixture/box.js', WEBHOOKS_JSON: '/fixture/webhooks.json', DATA_DIR: '/fixture/data' },
  };
  await withFixedClock(() => withMocks(mocks, async () => {
    const app = express();
    app.use('/api/invoices', fresh('modules/invoices/routes/invoices.js'));
    app.use('/api', fresh('modules/invoices/routes/settings.js'));
    const patchResponse = await dispatch(app, 'PATCH', `/api/invoices/${row.id}`, { invoiceNumber: null });
    const getResponse = await dispatch(app, 'GET', `/api/validate-approval/${row.id}`, {});
    assert.equal(patchResponse.statusCode, 200);
    assert.equal(getResponse.statusCode, 200);
    assert.ok(patchResponse.body.approvalVerdict, 'PATCH must add approvalVerdict');
    assert.deepEqual(patchResponse.body.approvalVerdict, getResponse.body);
    assert.ok(patchResponse.body.approvalVerdict.blockers.some((blocker) => /invoice number/i.test(blocker)), 'post-save blocker must be returned');
    assert.equal(row.invoice_number, null);
    assert.equal(patchResponse.body.action.type, 'edit');

    const noOpResponse = await dispatch(app, 'PATCH', `/api/invoices/${row.id}`, {});
    assert.equal(noOpResponse.statusCode, 200);
    assert.deepEqual(noOpResponse.body.approvalVerdict, getResponse.body);
    assert.deepEqual(noOpResponse.body.invoice, row, 'no-op keeps the nested invoice response shape');
    assert.equal(noOpResponse.body.action, null, 'no-op preserves its explicit null action semantic');
    assert.equal(noOpResponse.body.invoice_number, undefined, 'no-op must not flatten the invoice into the response envelope');
  }));
});
