'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { divertInboundEmail } = require('../../modules/invoices/services/inboundCorrelationService');
const { pipelinePool, syntheticPdf, syntheticTinyImage, withPipelinePool } = require('./inbound-routing-fixtures');

function email(overrides = {}) {
  return { id: 'route-email', internetMessageId: '<route@example.com>', conversationId: 'route-conv',
    subject: 'Re: Invoice', from: { emailAddress: { address: 'billing@vendor.example' } },
    receivedDateTime: '2026-09-16T12:00:00Z', body: { contentType: 'HTML', content: '<p>Reply</p>' },
    hasAttachments: false, internetMessageHeaders: [], ...overrides };
}

function dependencies(messages, overrides = {}) {
  return { fetchEmailList: async () => messages, getQueueCount: async () => 0, ...overrides };
}

function run(pool, messages, overrides = {}, options = {}) {
  return withPipelinePool(pool, ({ runPipeline }) => runPipeline({ postProcess: false, ...options,
    dependencies: dependencies(messages, overrides) }));
}

test('TC-01 and TC-02 keep automatic reply and matched NDR routing before download; unmatched NDR ingests normally', async () => {
  let downloads = 0;
  const autoPdf = syntheticPdf('auto-reply.pdf'), ndrPdf = syntheticPdf('ndr.pdf');
  const auto = pipelinePool();
  try {
    const dropped = await run(auto, [email({ id: 'tc01-auto', hasAttachments: true, subject: 'Out of Office: Away',
      internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'auto-replied' }] })], {
      downloadAttachments: async () => { downloads++; return { files: [{ path: autoPdf.filePath, filename: 'auto-reply.pdf' }] }; },
    });
    assert.equal(dropped.threadSkipped, 1);
    assert.equal(auto.state.inboundRows.length, 0);
    assert.equal(auto.state.documents.length, 0);
    const ndr = pipelinePool({ referenceRows: [{ id: 'doc-source', split_from: null, email_from: 'billing@vendor.example' }] });
    const captured = await run(ndr, [email({ id: 'tc02-ndr', hasAttachments: true,
      subject: 'Delivery Status Notification (Failure)', internetMessageHeaders: [{ name: 'Status', value: '5.1.1' },
        { name: 'References', value: '<outbound>' }] })], {
      downloadAttachments: async () => { downloads++; return { files: [{ path: ndrPdf.filePath, filename: 'ndr.pdf' }] }; },
    });
    assert.equal(captured.processed, 1);
    assert.equal(ndr.state.inboundRows[0].kind, 'ndr');
    assert.equal(ndr.state.inboundRows[0].state, 'matched');
    assert.equal(ndr.state.documents.length, 0);
    assert.equal(downloads, 0);
    const unmatchedNdr = pipelinePool();
    const normal = await run(unmatchedNdr, [email({ id: 'tc02-unmatched-ndr', hasAttachments: true,
      subject: 'Delivery Status Notification (Failure)', internetMessageHeaders: [{ name: 'Status', value: '5.1.1' }] })], {
      downloadAttachments: async () => { downloads++; return { files: [{ path: ndrPdf.filePath, filename: 'ndr.pdf' }] }; },
      classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
    });
    assert.equal(normal.errors, 0); assert.equal(normal.queued, 1);
    assert.equal(unmatchedNdr.state.inboundRows.length, 0);
    assert.equal(unmatchedNdr.state.documents.length, 1);
    assert.equal(downloads, 1, 'an unmatched NDR follows the normal download path');
  } finally {
    fs.rmSync(autoPdf.directory, { recursive: true, force: true });
    fs.rmSync(ndrPdf.directory, { recursive: true, force: true });
  }
});

test('filtered attachment routing follows the shared prefilter when no real files remain', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-source', split_from: null, email_from: 'billing@vendor.example' }] });
  const image = syntheticTinyImage(), events = [];
  try {
    await withPipelinePool(pool, async ({ runPipeline }) => {
      const filter = require('../../modules/invoices/services/junkFilterService');
      const original = filter.preFilterRealFile;
      filter.preFilterRealFile = (...args) => { events.push('prefilter'); return original(...args); };
      try {
        await runPipeline({ postProcess: false, dependencies: dependencies([email({ id: 'tc03-filtered', hasAttachments: true,
          internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] })], {
          downloadAttachments: async () => { events.push('download'); return { files: [{ path: image.filePath, filename: 'signature.png', attachmentId: 'sig-1' }] }; },
          divertInboundEmail: async args => { events.push(`route:${args.hasRealAttachments}`); return divertInboundEmail({ ...args, config: {} }); },
          classifyAndExtract: async () => { events.push('classify'); return { classification: 'receipt' }; },
        }) });
      } finally { filter.preFilterRealFile = original; }
    });
    assert.deepEqual(events, ['download', 'prefilter', 'route:false']);
    assert.equal(pool.state.inboundRows[0].state, 'matched');
    assert.equal(pool.state.inboundRows[0].attachmentReviewed, false);
    assert.equal(pool.state.documents.length, 0);
  } finally { fs.rmSync(image.directory, { recursive: true, force: true }); }
});

test('TC-10 ambiguous attachment is reviewed, ingested with source identity, and processed once', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-a', split_from: null }, { id: 'doc-b', split_from: null }] });
  const pdf = syntheticPdf('ambiguous.pdf');
  try {
    const result = await run(pool, [email({ id: 'tc10-ambiguous', hasAttachments: true,
      internetMessageHeaders: [{ name: 'References', value: '<out-a> <out-b>' }] })], {
      downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'ambiguous.pdf', attachmentId: 'att-8' }] }),
      classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
    });
    const message = pool.state.inboundRows[0], doc = pool.state.documents[0];
    assert.equal(result.processed, 1); assert.equal(message.state, 'ambiguous'); assert.equal(message.attachmentReviewed, true);
    assert.equal(pool.state.documents.length, 1);
    assert.equal(doc.source_document_id, null); assert.equal(doc.source_email_message_id, message.id); assert.equal(doc.source_attachment_id, 'att-8');
    assert.equal(pool.state.promotions.size, 0);
    assert.equal(Object.hasOwn(message, 'source_email_message_id'), false);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-30b a second attachment remains manually promotable after review', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-source', split_from: null, email_from: 'billing@vendor.example' }] });
  const pdf = syntheticPdf();
  try {
    await run(pool, [email({ id: 'tc30b-match', hasAttachments: true, internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] })], {
      downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'reply.pdf', attachmentId: 'att-1' }] }),
      classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
    });
    const service = require('../../modules/invoices/services/inboundAttachmentPromotionService');
    const { pipeline } = require('./inbound-promotion-fixtures');
    const mailbox = {
      async getAttachments() { return ['att-1', 'att-2'].map(id => ({ id, name: `${id}.pdf`, contentType: 'application/pdf', size: 40, '@odata.type': '#microsoft.graph.fileAttachment' })); },
      async downloadAttachment(_box, _message, id) { return { id, name: `${id}.pdf`, '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: Buffer.from('%PDF-1.4').toString('base64') }; },
    };
    const promoted = await service.promoteAttachment('doc-source', 'att-2', { userId: 'reviewer' }, { db: pool, mailbox, dependencies: {
      pipeline: pipeline({}), insertDocument: async (entry, db) => db.query('INSERT INTO documents (id) VALUES ($1)', [entry.id]),
      resolveActor: async () => ({ userId: 'reviewer', name: 'Reviewer', role: 'ap' }), insertAuditEvent: async () => {},
    } });
    assert.equal(pool.state.inboundRows[0].attachmentReviewed, true);
    assert.equal(promoted.duplicate, false);
    assert.equal(pool.state.promotions.get(`${pool.state.inboundRows[0].id}:att-2`).status, 'completed');
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-28 audit failure after document insert rolls back; replay persists exactly one document', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-source', split_from: null, email_from: 'billing@vendor.example' }],
    failAuditType: 'invoice.email_reply_received' });
  const pdf = syntheticPdf('rollback.pdf');
  const message = email({ id: 'tc28-replay', hasAttachments: true, internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] });
  const deps = { downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'rollback.pdf', attachmentId: 'att-28' }] }),
    classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }) };
  try {
    await withPipelinePool(pool, async ({ runPipeline }) => {
      const first = await runPipeline({ postProcess: false, dependencies: dependencies([message], deps) });
      assert.equal(first.errors, 1); assert.equal(pool.state.rollbacks, 1); assert.equal(pool.state.inboundRows.length, 0);
      assert.equal(pool.state.documents.length, 0); assert.equal(pool.state.promotions.size, 0); assert.equal(pool.state.processed.has(message.id), false);
      const docInsert = pool.state.calls.findIndex(call => /INSERT INTO documents/.test(call.sql));
      const replyAudit = pool.state.calls.findIndex(call => /INSERT INTO audit_events/.test(call.sql) && call.params[1] === 'invoice.email_reply_received');
      const rollback = pool.state.calls.findIndex(call => call.sql === 'ROLLBACK');
      assert.ok(replyAudit > docInsert && rollback > replyAudit, 'negative control fails the reply audit after the document insert');
      const replay = await runPipeline({ postProcess: false, dependencies: dependencies([message], deps) });
      assert.equal(replay.errors, 0); assert.equal(replay.queued, 1);
    });
    assert.equal(pool.state.inboundRows.length, 1); assert.equal(pool.state.documents.length, 1);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-29 and TC-29b dedupe same internet ID and attachment-bearing folder moves', async () => {
  const pdf = syntheticPdf('dedupe.pdf');
  try {
    const pool = pipelinePool(); let downloads = 0;
    await run(pool, [email({ id: 'tc29-1', conversationId: null, internetMessageId: '<same-id>', hasAttachments: true, subject: 'Invoice' }),
      email({ id: 'tc29-2', conversationId: null, internetMessageId: '<same-id>', hasAttachments: true, subject: 'Invoice' })], {
      downloadAttachments: async () => { downloads++; return { files: [{ path: pdf.filePath, filename: 'dedupe.pdf' }] }; },
      classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
    });
    assert.equal(downloads, 1); assert.equal(pool.state.documents.length, 1);
    const moved = pipelinePool(); downloads = 0;
    const movedEmail = id => email({ id, internetMessageId: null, hasAttachments: true, subject: 'Re: Moved invoice',
      receivedDateTime: '2026-09-16T12:00:00Z', internetMessageHeaders: [{ name: 'References', value: '<missing>' }] });
    await run(moved, [movedEmail('tc29b-before'), movedEmail('tc29b-after')], {
      downloadAttachments: async () => { downloads++; return { files: [{ path: pdf.filePath, filename: 'dedupe.pdf' }] }; },
      classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
    });
    assert.equal(downloads, 1); assert.equal(moved.state.documents.length, 1);
    assert.equal(moved.state.processed.has('tc29b-after'), true);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-32 marks a possible duplicate, while TC-33 dry-run makes no database writes', async () => {
  const pdf = syntheticPdf('flag.pdf');
  try {
    const pool = pipelinePool({ duplicateRows: [{ id: 'earlier-doc', status: 'submitted' }] });
    await run(pool, [email({ id: 'tc32-duplicate', hasAttachments: true, subject: 'Invoice INV-32' })], {
      downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'flag.pdf' }] }),
      classifyAndExtract: async () => ({ classification: 'invoice', confidence: 0.9,
        extracted: { invoiceNumber: 'INV-32', vendorName: 'Vendor', amount: 10 } }),
      matchInvoiceData: async () => ({ vendor: null, overallConfidence: 0 }),
    });
    assert.equal(pool.state.documents[0].flagged, true); assert.equal(pool.state.documents[0].duplicate_of, 'earlier-doc');
    const dry = pipelinePool();
    await run(dry, [email({ id: 'tc33-dry', hasAttachments: true, subject: 'Invoice INV-33' })], {
      downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'flag.pdf' }] }),
      classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
    }, { dry: true });
    assert.equal(dry.state.documents.length, 0); assert.equal(dry.state.processed.size, 0);
    assert.equal(dry.state.calls.some(call => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.sql)), false);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});
