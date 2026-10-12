'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('undo migration extends audit_events and documents without creating a third action table', () => {
  const migration = read('migrations/2026-06-30_undo_system.sql');

  assert.match(migration, /ALTER TABLE audit_events/);
  for (const column of [
    'before_state JSONB',
    'after_state JSONB',
    'undoable BOOLEAN NOT NULL DEFAULT false',
    'undone_at TIMESTAMPTZ',
    'undone_by TEXT',
    'filed_at TIMESTAMPTZ',
    'approved_at TIMESTAMPTZ',
    'approved_by TEXT',
    'discarded_at TIMESTAMPTZ',
    'discarded_by TEXT',
    'reconciled BOOLEAN NOT NULL DEFAULT false',
    'waiver_released BOOLEAN NOT NULL DEFAULT false',
  ]) {
    assert.match(migration, new RegExp(column.replace(/[()]/g, '\\$&')));
  }

  assert.doesNotMatch(migration, /invoice_action_events/i);
});

test('audit event helper stores undo snapshots and exposes undo lookup helpers', () => {
  const source = read('lib/auditEvents.js');

  assert.match(source, /before_state/);
  assert.match(source, /after_state/);
  assert.match(source, /undoable/);
  assert.match(source, /async function findUndoableAction/);
  assert.match(source, /async function markActionUndone/);
  assert.match(source, /function checkStateMatch/);
  assert.match(source, /STATE_CHANGED_SINCE_ACTION|staleFields/);
});

test('discard undo is separate from soft-delete restore', () => {
  const statusService = read('modules/invoices/services/invoiceStatusService.js');
  const routes = read('modules/invoices/routes/invoices.js');

  assert.match(routes, /router\.post\('\/:id\/undiscard'/);
  assert.match(statusService, /async function undiscardInvoice/);
  assert.match(statusService, /findUndoableAction\(req\.params\.id, 'invoice\.discarded'\)/);
  assert.match(statusService, /discarded_at = NULL/);
  assert.match(statusService, /code: 'TRANSIENT_STATUS'/);
  assert.doesNotMatch(statusService, /restoreInvoice/);
});

test('file undo route stays unified while review, reconcile, and edit inverse endpoints are wired explicitly', () => {
  const routes = read('modules/invoices/routes/invoices.js');
  const statusService = read('modules/invoices/services/invoiceStatusService.js');
  const editService = read('modules/invoices/services/invoiceEditService.js');

  for (const route of [
    "/:id/unreview",
    "/:id/reconcile",
    "/:id/unreconcile",
    "/:id/unedit",
    "/:id/actions",
    "/:id/actions/:actionId/undo",
  ]) {
    assert.match(routes, new RegExp(route.replace(/[/:]/g, '\\$&')));
  }

  assert.match(statusService, /async function fileDocument/);
  assert.match(statusService, /async function unfileDocument/);
  assert.doesNotMatch(routes, /\/:id\/unfile/);
  assert.doesNotMatch(routes, /unfileDocument\(req, res\)/);
  assert.doesNotMatch(statusService.slice(statusService.indexOf('module.exports')), /unfileDocument/);
  assert.doesNotMatch(routes, /toggleFiled\(req, res\)/);
  assert.match(editService, /code: 'APPROVED_LOCKED'/);
  assert.match(editService, /async function uneditInvoice/);
});

test('approval undo restores routing override fields from before_state', () => {
  const source = read('modules/invoices/services/invoiceApprovalService.js');

  for (const field of [
    'routing_code',
    'invoice_date',
    'phase_code',
    'cost_type',
    'gl_account',
    'gl_date',
    'approved_at',
    'approved_by',
  ]) {
    assert.match(source, new RegExp(`'${field}'`));
  }

  assert.match(source, /findUndoableAction\(req\.params\.id, 'invoice\.approved'\)/);
  assert.match(source, /buildRestoreApprovalUpdate\(restoredState\)/);
  assert.match(source, /checkStateMatch\(row, action\.afterState\)/);
});

test('bulk and waiver link flows write audit_events snapshots without bulk undo responses', () => {
  const bulk = read('modules/invoices/services/bulkActionService.js');
  const waiver = read('modules/invoices/services/lienWaiverLinkService.js');

  assert.match(bulk, /beforeState/);
  assert.match(bulk, /afterState/);
  assert.match(bulk, /undoable: action !== 'reject'/);
  assert.doesNotMatch(bulk, /actionMetadata/);
  assert.match(waiver, /type: 'invoice\.waiver_linked'/);
  assert.match(waiver, /type: 'invoice\.waiver_unlinked'/);
  assert.match(waiver, /undoable: false/);
});
