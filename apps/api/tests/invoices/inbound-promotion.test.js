'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const service = require('../../modules/invoices/services/inboundAttachmentPromotionService');
const {
  concurrentDatabase, database, mailbox, pipeline, source,
} = require('./inbound-promotion-fixtures');

test('lists only file attachments and promotes through classifier/extractor with child provenance and actor audit', async () => {
  const db = database(source());
  const sourceBefore = { filePath: db.state.row.file_path, fileName: db.state.row.file_name };
  const listed = await service.listSourceAttachments('child-2', { db, mailbox: mailbox() });
  assert.deepEqual(listed.attachments.map(item => item.attachmentId), ['att-1']);
  const state = {};
  const result = await service.promoteAttachment('child-2', 'att-1', { userId: 'user-1', email: 'reviewer@example.test', role: 'ap' }, {
    db, mailbox: mailbox(), dependencies: { pipeline: pipeline(state), insertDocument: async entry => db.query('INSERT INTO documents', [entry.id, entry]), resolveActor: async () => ({ userId: 'user-1', name: 'Reviewer', role: 'ap' }), insertAuditEvent: async event => db.state.audits.push(event) },
  });
  assert.equal(result.duplicate, false); assert.equal(state.classify.context.messageId, 'graph-msg-1');
  assert.equal(db.state.docs[0].sourceDocumentId, 'child-2'); assert.equal(db.state.docs[0].sourceEmailMessageId, 'inbound-row-1');
  assert.equal(db.state.docs[0].email.body, null); assert.equal(db.state.audits[0].actor.userId, 'user-1'); assert.equal(db.state.commits, 1);
  assert.deepEqual({ filePath: db.state.row.file_path, fileName: db.state.row.file_name }, sourceBefore);
  assert.deepEqual(db.state.updates[0].params.slice(0, 2), ['child-2', 'inbound-row-1']);
});

test('promotes a synthetic docx through conversion before the real classifier boundary', async () => {
  const db = database(source());
  const state = {};
  const converted = Buffer.from('%PDF-converted-docx');
  const docx = Buffer.from('PK synthetic docx bytes');
  const convertedPath = path.join(os.tmpdir(), 'inbound-promotion-converted.pdf');
  const converter = {
    isWordDoc: file => path.extname(file).toLowerCase() === '.docx',
    convertToPdf: file => { fs.writeFileSync(convertedPath, converted); fs.rmSync(file, { force: true }); return convertedPath; },
  };
  const pipelineBoundary = pipeline(state);
  pipelineBoundary.classifyAndExtract = async (file, context) => {
    assert.equal(path.extname(file), '.pdf');
    assert.deepEqual(fs.readFileSync(file), converted);
    state.classify = { file, context };
    return { classification: 'invoice', confidence: .99, extracted: { invoiceNumber: 'INV 42', vendorName: 'Vendor' } };
  };
  const result = await service.promoteAttachment('child-2', 'att-1', { userId: 'user-1' }, {
    db, mailbox: mailbox({ attachmentName: 'invoice.docx', content: docx }),
    dependencies: {
      pipeline: pipelineBoundary, docConvert: converter,
      insertDocument: async entry => db.query('INSERT INTO documents', [entry.id, entry]),
      resolveActor: async () => ({ userId: 'user-1', name: 'Reviewer', role: 'ap' }), insertAuditEvent: async () => {},
    },
  });
  assert.equal(result.promoted, true);
  assert.equal(path.extname(db.state.docs[0].file), '.pdf');
  assert.deepEqual(Buffer.from(db.state.docs[0].pdfBase64, 'base64'), converted);
  assert.equal(state.classify.context.fileName, 'invoice.docx');
  assert.equal(fs.existsSync(convertedPath), false);
  assert.equal(db.state.row.file_name, 'source.pdf');
});

test('completed retries return one result, classifier failures roll back reservation, and ambiguity/NDR never promote', async () => {
  const db = database(source()); const options = { db, mailbox: mailbox(), dependencies: { pipeline: pipeline({}), insertDocument: async entry => db.query('INSERT INTO documents', [entry.id, entry]), resolveActor: async () => ({ userId: 'u', name: 'R', role: 'ap' }), insertAuditEvent: async () => {} } };
  const first = await service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, options);
  const second = await service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, options);
  assert.equal(first.documentId, second.documentId); assert.equal(second.duplicate, true); assert.equal(db.state.docs.length, 1);
  const failedDb = database(source()); await assert.rejects(service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, { db: failedDb, mailbox: mailbox(), dependencies: { pipeline: pipeline({}, { fail: true }), insertDocument: async () => {} } }));
  assert.equal(failedDb.state.rollbacks, 1); assert.equal(failedDb.state.reservations.size, 0);
  await assert.rejects(service.promoteAttachment('doc-a', 'att-1', { userId: 'u' }, { db: database(source({ correlation_state: 'ambiguous' })), mailbox: mailbox(), dependencies: { pipeline: pipeline({}) } }), e => e.code === 'INBOUND_MESSAGE_AMBIGUOUS');
  await assert.rejects(service.promoteAttachment('doc-a', 'att-1', { userId: 'u' }, { db: database(source({ kind: 'ndr' })), mailbox: mailbox(), dependencies: { pipeline: pipeline({}) } }), e => e.code === 'INBOUND_NDR_NOT_PROMOTABLE');
});

test('ownership, source disappearance, and sanitized context fail before promotion', async () => {
  const downloads = [];
  const db = database(source({ body_preview: '<script>alert(1)</script><b>safe</b>', sanitized_body_html: '<script>alert(1)</script><b>safe</b>' }));
  await assert.rejects(service.getAttachment('child-2', 'foreign-att', { db, mailbox: mailbox({ downloads }) }), e => e.code === 'INBOUND_ATTACHMENT_NOT_FOUND');
  await assert.rejects(service.getAttachment('child-2', 'inline-1', { db, mailbox: mailbox({ downloads }) }), e => e.code === 'INBOUND_ATTACHMENT_NOT_FOUND');
  assert.deepEqual(downloads, []);
  await assert.rejects(service.listSourceAttachments('child-2', { db, mailbox: mailbox({ unavailable: true }) }), e => e.code === 'INBOUND_SOURCE_UNAVAILABLE');
  await assert.rejects(service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, { db: database(source({ has_attachments: false })), mailbox: mailbox(), dependencies: { pipeline: pipeline({}) } }), e => e.code === 'INBOUND_MESSAGE_NO_ATTACHMENTS');
  const state = {};
  await service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, { db: database(source({ body_preview: '<script>alert(1)</script><b>safe</b>', sanitized_body_html: '<script>alert(1)</script><b>safe</b>' })), mailbox: mailbox(), dependencies: { pipeline: pipeline(state), insertDocument: async () => {}, resolveActor: async () => ({ userId: 'u', name: 'Reviewer', role: 'ap' }), insertAuditEvent: async () => {} } });
  assert.equal(state.classify.context.body, 'alert(1) safe');
  assert.doesNotMatch(state.classify.context.body, /<|>/);
});

test('post-insert failure removes the promoted file while the reservation rolls back', async () => {
  const db = database(source());
  const written = [];
  await assert.rejects(service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, {
    db, mailbox: mailbox(), dependencies: {
      pipeline: pipeline({}),
      insertDocument: async entry => {
        const file = path.join(__dirname, '../../modules/invoices/data/files', `${entry.id}.pdf`);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'promoted'); written.push(file);
        throw new Error('insert failed');
      },
    },
  }));
  assert.equal(db.state.reservations.size, 0); assert.equal(db.state.rollbacks, 1);
  assert.ok(written.length > 0, 'the failing insert should have written its file first');
  assert.ok(written.every(file => !fs.existsSync(file)), 'promotion rollback must remove exactly the files this test wrote');
});

test('overlapping promotions reserve once and cannot create duplicate documents', async () => {
  const db = concurrentDatabase(source()); let release; let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const controlled = pipeline({}); const original = controlled.classifyAndExtract;
  controlled.classifyAndExtract = async (...args) => { entered(); await gate; return original(...args); };
  const options = { db, mailbox: mailbox(), dependencies: { pipeline: controlled, insertDocument: db.insertDocument, resolveActor: async () => ({ userId: 'u', name: 'R', role: 'ap' }), insertAuditEvent: async () => {} } };
  const first = service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, options);
  await reached;
  const second = service.promoteAttachment('child-2', 'att-1', { userId: 'u' }, options);
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'INBOUND_PROMOTION_IN_PROGRESS');
  assert.equal(db.state.docs.length, 1); assert.equal(db.state.commits, 1);
});
