'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { invokePromoteRoute, loadDocumentsRoute } = require('./inbound-promotion-fixtures');

test('migration, route contract, and package enumeration preserve additive scope', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../migrations/2026-09-18_document_inbound_promotions.sql'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../../modules/invoices/routes/documents.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.match(migration, /UNIQUE \(source_email_message_id, source_attachment_id\)/);
  assert.match(route, /inbound-attachments\/\:attachmentId\/promote/); assert.match(route, /requirePermission\('accounting\.invoices\.view_details'\)/);
  assert.match(packageJson.scripts.test, /inbound-promotion\.test\.js/);
  assert.match(packageJson.scripts.test, /inbound-promotion-route\.test\.js/);
});

test('mounted promotion route enforces permission, validates input, and maps ownership failures', async () => {
  const calls = [];
  class FakeInboundAttachmentError extends Error {
    constructor(statusCode, message, code) { super(message); this.statusCode = statusCode; this.code = code; }
  }
  const fakeInbound = {
    InboundAttachmentError: FakeInboundAttachmentError,
    promoteAttachment: async (...args) => {
      calls.push(args);
      if (args[0] === 'foreign-doc') throw new FakeInboundAttachmentError(404, 'Attachment not found', 'INBOUND_ATTACHMENT_NOT_FOUND');
      return { promoted: true, documentId: 'promoted-1' };
    },
  };
  const router = await loadDocumentsRoute(fakeInbound);
  const allowed = { userId: 'reviewer-1', permissions: ['accounting.invoices.view_details'] };
  const denied = await invokePromoteRoute(router, { id: 'doc-1', attachmentId: 'att-1', user: { userId: 'denied', permissions: [] } });
  assert.equal(denied.statusCode, 403); assert.equal(calls.length, 0);
  const malformed = await invokePromoteRoute(router, { id: 'doc-1', attachmentId: 'att-1', body: { unexpected: true }, user: allowed });
  assert.equal(malformed.statusCode, 400); assert.equal(calls.length, 0);
  const ownership = await invokePromoteRoute(router, { id: 'foreign-doc', attachmentId: 'att-1', user: allowed });
  assert.equal(ownership.statusCode, 404); assert.equal(ownership.body.code, 'INBOUND_ATTACHMENT_NOT_FOUND');
  const accepted = await invokePromoteRoute(router, { id: 'doc-1', attachmentId: 'att-1', user: allowed });
  assert.equal(accepted.statusCode, 201); assert.deepEqual(calls[1].slice(0, 2), ['doc-1', 'att-1']);
});
