'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { serializeEmail } = require('../../modules/invoices/services/activityService');
const { pipelinePool, syntheticPdf, withPipelinePool } = require('./inbound-routing-fixtures');
const {
  correlateInbound, divertInboundEmail, isAutomaticReply, isNdr, messageIds,
  sanitizeInboundHtml, shouldInspectInbound,
} = require('../../modules/invoices/services/inboundCorrelationService');

function email(overrides = {}) {
  return {
    id: 'graph-in-1', internetMessageId: '<in-1@example.com>', conversationId: 'conv-1',
    subject: 'Re: Invoice 1', from: { emailAddress: { address: 'billing@vendor.example' } },
    receivedDateTime: '2026-09-16T12:00:00Z', body: { contentType: 'HTML', content: '<p>Thanks</p>' },
    hasAttachments: false, internetMessageHeaders: [], ...overrides,
  };
}

function lookupPool(refRows = [], conversationRows = [], existingIds = new Set(), subjectRows = []) {
  const calls = [];
  return { calls, async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('internet_message_id = ANY')) return { rows: refRows };
    if (sql.includes('m.conversation_id=$1')) return { rows: conversationRows };
    if (sql.includes("m.sent_at >= now() - interval '14 days'")) return { rows: subjectRows };
    if (sql.startsWith('SELECT id FROM document_email_messages')) {
      return { rows: existingIds.has(params[1]) ? [{ id: 'existing' }] : [] };
    }
    if (sql.startsWith('INSERT INTO document_email_messages')) {
      if (existingIds.has(params[4])) return { rows: [] };
      existingIds.add(params[3]); return { rows: [{ id: params[0] }] };
    }
    return { rows: [] };
  } };
}

test('TC-00 shouldInspectInbound=false with a PDF uses normal document ingestion', async () => {
  const pool = pipelinePool(), pdf = syntheticPdf('tc00-normal.pdf');
  const incoming = email({ id: 'tc00-normal', internetMessageId: null, conversationId: null,
    internetMessageHeaders: undefined, hasAttachments: true, subject: 'Invoice INV-00' });
  try {
    assert.equal(shouldInspectInbound(incoming), false);
    await withPipelinePool(pool, async ({ runPipeline }) => {
      const result = await runPipeline({ postProcess: false, dependencies: {
        fetchEmailList: async () => [incoming], downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'tc00-normal.pdf' }] }),
        classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }), getQueueCount: async () => 0,
      } });
      assert.equal(result.queued, 1);
    });
    assert.equal(pool.state.inboundRows.length, 0);
    assert.equal(pool.state.documents.length, 1);
    assert.equal(pool.state.documents[0].classification, 'receipt');
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-03 matched reply without an attachment creates Activity and no document', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-matched', split_from: null, email_from: 'billing@vendor.example' }] });
  let downloads = 0;
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({ postProcess: false, dependencies: {
      fetchEmailList: async () => [email({ id: 'tc03-matched-empty', hasAttachments: false,
        internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] })],
      downloadAttachments: async () => { downloads++; throw new Error('attachmentless reply downloaded'); }, getQueueCount: async () => 0,
    } });
    assert.equal(result.processed, 1);
  });
  assert.equal(downloads, 0);
  assert.equal(pool.state.inboundRows[0].state, 'matched');
  assert.equal(pool.state.inboundRows[0].documentId, 'doc-matched');
  assert.equal(pool.state.documents.length, 0);
});

test('TC-04 ambiguous reply without an attachment is held without a document', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-a', split_from: null }, { id: 'doc-b', split_from: null }] });
  let downloads = 0;
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({ postProcess: false, dependencies: {
      fetchEmailList: async () => [email({ id: 'tc04-ambiguous-empty', hasAttachments: false,
        internetMessageHeaders: [{ name: 'References', value: '<out-a> <out-b>' }] })],
      downloadAttachments: async () => { downloads++; throw new Error('attachmentless ambiguous reply downloaded'); }, getQueueCount: async () => 0,
    } });
    assert.equal(result.processed, 1);
  });
  assert.equal(downloads, 0);
  assert.equal(pool.state.inboundRows[0].state, 'ambiguous');
  assert.equal(pool.state.documents.length, 0);
});

test('TC-05 (c) unmatched RE vendor reply without an attachment queues a body document with no inbound row', async () => {
  const pool = pipelinePool(); let downloads = 0;
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({ postProcess: false, dependencies: {
      fetchEmailList: async () => [email({ id: 'tc05-unmatched-empty', hasAttachments: false, subject: 'RE: Unknown invoice', internetMessageHeaders: [] })],
      downloadAttachments: async () => { downloads++; throw new Error('attachmentless unmatched reply downloaded'); }, getQueueCount: async () => 0,
    } });
    assert.equal(result.errors, 0); assert.equal(result.queued, 1); assert.equal(result.threadSkipped, 0);
  });
  assert.equal(downloads, 0);
  assert.equal(pool.state.inboundRows.length, 0);
  const auditTypes = pool.state.calls.filter(call => /INSERT INTO audit_events/.test(call.sql)).map(call => call.params[1]);
  assert.deepEqual(auditTypes, ['invoice.intake'], 'only the normal intake audit, no reply-received audit');
  assert.equal(pool.state.documents.length, 1);
  assert.equal(pool.state.documents[0].classification, 'no-attachment');
  assert.equal(pool.state.processed.has('tc05-unmatched-empty'), true);
});

test('(h) unmatched staff FW with In-Reply-To and no attachment becomes a queue document, not a processed skip', async () => {
  const pool = pipelinePool(); let downloads = 0;
  const incoming = email({ id: 'h-staff-fw-empty', hasAttachments: false, conversationId: 'staff-outlook-thread',
    subject: 'FW: Question about last invoice', from: { emailAddress: { address: 'pm@northwindcg.example' } },
    body: { contentType: 'HTML', content: '<p>Please look at this.</p>' },
    internetMessageHeaders: [{ name: 'In-Reply-To', value: '<vendor-original@vendor.example>' }] });
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({ postProcess: false, dependencies: {
      fetchEmailList: async () => [incoming],
      downloadAttachments: async () => { downloads++; throw new Error('attachmentless forward downloaded'); }, getQueueCount: async () => 0,
    } });
    assert.equal(result.errors, 0); assert.equal(result.queued, 1); assert.equal(result.threadSkipped, 0);
  });
  assert.equal(downloads, 0);
  assert.equal(pool.state.inboundRows.length, 0, 'unmatched forward must not be parked in document_email_messages');
  assert.equal(pool.state.documents.length, 1);
  const [doc] = pool.state.documents;
  assert.equal(doc.classification, 'no-attachment');
  assert.equal(doc.status, 'pending');
  assert.equal(doc.email_subject, 'FW: Question about last invoice');
  assert.equal(pool.state.processed.has('h-staff-fw-empty'), true);
});

test('TC-06 plain email without IDs, headers, or attachment queues its body document', async () => {
  const pool = pipelinePool(); let downloads = 0;
  const incoming = email({ id: 'tc06-body-only', internetMessageId: null, conversationId: null,
    internetMessageHeaders: undefined, hasAttachments: false, subject: 'Monthly vendor note' });
  assert.equal(shouldInspectInbound(incoming), false);
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({ postProcess: false, dependencies: {
      fetchEmailList: async () => [incoming], downloadAttachments: async () => { downloads++; throw new Error('body email downloaded'); }, getQueueCount: async () => 0,
    } });
    assert.equal(result.queued, 1);
  });
  assert.equal(downloads, 0);
  assert.equal(pool.state.inboundRows.length, 0);
  assert.equal(pool.state.documents.length, 1);
  assert.equal(pool.state.documents[0].classification, 'no-attachment');
});

test('TC-07 (b) unmatched FW with In-Reply-To and a real attachment ingests normally with no inbound row', async () => {
  const pool = pipelinePool();
  const pdf = syntheticPdf();
  let downloaded = false;
  try {
    await withPipelinePool(pool, async ({ runPipeline }) => {
      const result = await runPipeline({
        postProcess: false,
        dependencies: {
          fetchEmailList: async () => [email({ id: 'tc07-unmatched', hasAttachments: true,
            subject: 'FW: Unmatched invoice', internetMessageHeaders: [{ name: 'In-Reply-To', value: '<missing-outbound>' }] })],
          downloadAttachments: async () => { downloaded = true; return { files: [{ path: pdf.filePath, filename: 'reply.pdf', attachmentId: 'att-tc07' }] }; },
          classifyAndExtract: async () => ({ classification: 'receipt', confidence: 0.9 }),
          getQueueCount: async () => 0,
        },
      });
      assert.equal(result.errors, 0);
      assert.equal(result.queued, 1);
      assert.equal(pool.state.inboundRows.length, 0);
      assert.equal(pool.state.documents.length, 1);
      const [document] = pool.state.documents;
      assert.ok(document, 'the synthetic PDF must pass through normal document insertion');
      assert.equal(document.classification, 'receipt');
      assert.equal(document.source_document_id ?? null, null);
      assert.equal(document.source_email_message_id ?? null, null);
      assert.equal(downloaded, true);
    });
  } finally {
    fs.rmSync(pdf.directory, { recursive: true, force: true });
  }
});

test('only Toolbox-tied replies divert: matched captured, ambiguous held, every unmatched shape is normal', async () => {
  const config = { mailbox: 'invoices@northwindcg.example', internalDomains: ['northwindcg.example'] };
  const matched = await divertInboundEmail({ email: email({ hasAttachments: false,
    internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] }),
  db: lookupPool([{ id: 'doc-1', split_from: null, email_from: 'billing@vendor.example' }]), config });
  assert.deepEqual([matched.action, matched.documentId, matched.correlationState], ['captured', 'doc-1', 'matched']);

  const ambiguous = await divertInboundEmail({ email: email({ hasAttachments: false,
    internetMessageHeaders: [{ name: 'References', value: '<a> <b>' }] }),
  db: lookupPool([{ id: 'doc-a', split_from: null }, { id: 'doc-b', split_from: null }]), config });
  assert.deepEqual([ambiguous.action, ambiguous.correlationState], ['held', 'ambiguous']);

  const unmatchedShapes = [
    ['(a) staff FW with In-Reply-To, no attachment', email({ subject: 'FW: Invoice', hasAttachments: false,
      from: { emailAddress: { address: 'pm@northwindcg.example' } }, internetMessageHeaders: [{ name: 'In-Reply-To', value: '<vendor-thread>' }] }), false],
    ['(b) staff FW with In-Reply-To and a real attachment', email({ subject: 'FW: Invoice', hasAttachments: true,
      from: { emailAddress: { address: 'pm@northwindcg.example' } }, internetMessageHeaders: [{ name: 'In-Reply-To', value: '<vendor-thread>' }] }), true],
    ['(c) RE vendor reply, no Toolbox match', email({ subject: 'RE: Unknown invoice', internetMessageHeaders: [] }), false],
    ['FW subject without headers and a real attachment', email({ subject: 'FW: Invoice', hasAttachments: true, internetMessageHeaders: [] }), true],
  ];
  for (const [label, incoming, hasRealAttachments] of unmatchedShapes) {
    const pool = lookupPool();
    assert.deepEqual(await divertInboundEmail({ email: incoming, db: pool, config, hasRealAttachments }), { action: 'normal' }, label);
    assert.equal(pool.calls.some(call => call.sql.startsWith('INSERT INTO document_email_messages')), false, `${label} persists no row`);
  }
});

test('(d) reply carrying a valid [Ref:xxxx] tag is captured on its document', async () => {
  const calls = [];
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM documents WHERE id ILIKE $1')) {
      return { rows: params[0] === '%-mi6h' ? [{ id: 'doc-1789775848361-mi6h', split_from: null, email_from: 'billing@vendor.example' }] : [] };
    }
    if (sql.startsWith('SELECT id FROM document_email_messages')) return { rows: [] };
    if (sql.startsWith('INSERT INTO document_email_messages')) return { rows: [{ id: params[0] }] };
    return { rows: [] };
  } };
  const result = await divertInboundEmail({ email: email({ subject: 'RE: Test Invoice [Ref:mi6h]', conversationId: 'fresh-conversation',
    internetMessageHeaders: [] }), db: pool, config: { mailbox: 'invoices@northwindcg.example', internalDomains: ['northwindcg.example'] } });
  assert.deepEqual([result.action, result.documentId, result.correlationState, result.correlationReason],
    ['captured', 'doc-1789775848361-mi6h', 'matched', 'tier-ref-tag']);
  assert.equal(calls.some(call => call.sql.startsWith('INSERT INTO document_email_messages')), true);
});

test('(e) reply whose In-Reply-To matches a Toolbox outbound is captured', async () => {
  const pool = lookupPool([{ id: 'doc-outbound', split_from: null, email_from: 'billing@vendor.example' }]);
  const result = await divertInboundEmail({ email: email({ subject: 'RE: Invoice 1',
    internetMessageHeaders: [{ name: 'In-Reply-To', value: '<toolbox-outbound@northwindcg.example>' }] }), db: pool, config: {} });
  assert.deepEqual([result.action, result.documentId, result.correlationState, result.correlationReason],
    ['captured', 'doc-outbound', 'matched', 'tier-0']);
  const lookup = pool.calls.find(call => call.sql.includes('internet_message_id = ANY'));
  assert.deepEqual(lookup.params[0], ['<toolbox-outbound@northwindcg.example>']);
});

test('unmatched FW invoice already in Toolbox is flagged as a duplicate of the original and stays pending', async () => {
  const pool = pipelinePool({ duplicateRows: [{ id: 'doc-original-505', status: 'submitted' }] });
  const pdf = syntheticPdf('invoice-505.pdf');
  try {
    await withPipelinePool(pool, async ({ runPipeline }) => {
      const result = await runPipeline({ postProcess: false, dependencies: {
        fetchEmailList: async () => [email({ id: 'fw-dup-505', hasAttachments: true, conversationId: 'fresh-fw-conversation',
          subject: 'FW: Invoice #505 from Palmetto', from: { emailAddress: { address: 'pm@northwindcg.example' } },
          internetMessageHeaders: [{ name: 'In-Reply-To', value: '<palmetto-original@vendor.example>' }] })],
        downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'invoice-505.pdf', attachmentId: 'att-505' }] }),
        classifyAndExtract: async () => ({ classification: 'invoice', confidence: 0.95,
          extracted: { invoiceNumber: 'INV 505', vendorName: 'Palmetto', amount: 1200 } }),
        matchInvoiceData: async () => ({ vendor: { vendorCode: 'ZPAL91', confidence: 0.95 }, overallConfidence: 0.9 }),
        getQueueCount: async () => 0,
      } });
      assert.equal(result.errors, 0);
      assert.equal(result.queued, 1);
    });
    assert.equal(pool.state.inboundRows.length, 0, 'unmatched forward ingests normally without an inbound row');
    const duplicateLookup = pool.state.calls.find(call => /SELECT id, status FROM documents/.test(call.sql)
      && /invoice_number/.test(call.sql));
    assert.ok(duplicateLookup, 'forwarded invoice must run the invoice-number duplicate check');
    assert.deepEqual(duplicateLookup.params.slice(0, 2), ['505', 'ZPAL91']);
    assert.equal(pool.state.documents.length, 1);
    const [document] = pool.state.documents;
    assert.equal(document.classification, 'invoice');
    assert.equal(document.duplicate_of, 'doc-original-505');
    assert.equal(document.flagged, true);
    assert.equal(document.status, 'pending');
    assert.match(document.notes, /Possible duplicate of doc-original-505/);
    assert.equal(document.source_email_message_id ?? null, null);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-08 matched non-waiver invoice reply is classified and promoted; TC-30 Promote sees reservation', async () => {
  const pool = pipelinePool({ referenceRows: [{ id: 'doc-source', split_from: null, email_from: 'billing@vendor.example' }] });
  const pdf = syntheticPdf();
  let classifications = 0;
  try {
    await withPipelinePool(pool, async ({ runPipeline }) => {
      const result = await runPipeline({
        postProcess: false,
        dependencies: {
          fetchEmailList: async () => [email({ id: 'tc08-matched', hasAttachments: true,
            internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] })],
          downloadAttachments: async () => ({ files: [{ path: pdf.filePath, filename: 'reply.pdf', attachmentId: 'att-1' }] }),
          classifyAndExtract: async () => { classifications++; return { classification: 'invoice', confidence: 0.9,
            extracted: { invoiceNumber: 'INV-08', vendorName: 'Vendor', amount: 10 } }; },
          matchInvoiceData: async () => ({ vendor: null, overallConfidence: 0 }),
          getQueueCount: async () => 0,
        },
      });
      assert.equal(result.queued, 1);
    });
    const message = pool.state.inboundRows[0];
    assert.equal(message.state, 'matched');
    assert.equal(message.documentId, 'doc-source');
    assert.equal(message.attachmentReviewed, true);
    assert.equal(classifications, 1);
    assert.equal(pool.state.documents.length, 1);
    assert.equal(pool.state.documents[0].classification, 'invoice');
    const [document] = pool.state.documents;
    assert.equal(document.source_document_id, 'doc-source');
    assert.equal(document.source_email_message_id, message.id);
    assert.equal(document.source_attachment_id, 'att-1');
    const promotion = pool.state.promotions.get(`${message.id}:att-1`);
    assert.deepEqual(promotion, { id: `promotion-${message.id}-att-1`, sourceDocumentId: 'doc-source',
      sourceEmailMessageId: message.id, sourceAttachmentId: 'att-1', status: 'completed', actorUserId: 'pipeline', resultingDocumentId: document.id });
    assert.equal(pool.state.promotions.size, 1);
    const docInsertIndex = pool.state.calls.reduce((last, call, index) => /INSERT INTO documents/.test(call.sql) ? index : last, -1);
    const replyAuditIndex = pool.state.calls.findIndex(call => /INSERT INTO audit_events/.test(call.sql)
      && call.params[1] === 'invoice.email_reply_received');
    assert.ok(replyAuditIndex > docInsertIndex, 'reply audit follows the attachment document insert');
    const commitIndex = pool.state.calls.findIndex(call => call.sql === 'COMMIT');
    assert.ok(commitIndex > replyAuditIndex, 'reply audit commits with the attachment rows');
    const promotionService = require('../../modules/invoices/services/inboundAttachmentPromotionService');
    const { pipeline: promotionPipeline } = require('./inbound-promotion-fixtures');
    const mailbox = {
      async getAttachments() { return ['att-1', 'att-2'].map(id => ({ id, name: `${id}.pdf`, contentType: 'application/pdf', size: 40, '@odata.type': '#microsoft.graph.fileAttachment' })); },
      async downloadAttachment(_mailbox, _message, id) { return { id, name: `${id}.pdf`, '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: Buffer.from('%PDF-1.4 synthetic').toString('base64') }; },
    };
    const promoted = await promotionService.promoteAttachment('doc-source', 'att-1', { userId: 'reviewer' }, {
      db: pool, mailbox, dependencies: {
        pipeline: promotionPipeline({}),
        insertDocument: async (entry, db) => db.query('INSERT INTO documents (id) VALUES ($1)', [entry.id]),
        resolveActor: async () => ({ userId: 'reviewer', name: 'Reviewer', role: 'ap' }),
        insertAuditEvent: async () => {},
      },
    });
    assert.equal(promoted.duplicate, true);
    assert.equal(promoted.documentId, pool.state.promotions.get(`${pool.state.inboundRows[0].id}:att-1`)?.resultingDocumentId);
  } finally {
    fs.rmSync(pdf.directory, { recursive: true, force: true });
  }
});

async function withWaiverPool(pool, fn) {
  const supabasePath = require.resolve('../../modules/invoices/services/supabase');
  const servicePath = require.resolve('../../modules/invoices/services/waiverAutoLinkService');
  const beforeSupabase = require.cache[supabasePath];
  const beforeService = require.cache[servicePath];
  delete require.cache[servicePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { pool } };
  try {
    return await fn(require('../../modules/invoices/services/waiverAutoLinkService'));
  } finally {
    if (beforeSupabase) require.cache[supabasePath] = beforeSupabase;
    else delete require.cache[supabasePath];
    if (beforeService) require.cache[servicePath] = beforeService;
    else delete require.cache[servicePath];
  }
}

test('TC-27b exhausted unmatched FW reply reaches the body placeholder through the normal path', async () => {
  const id = 'tc27b-exhausted-fw-reply';
  const pool = pipelinePool({ exhaustedError: {
    retry_count: 3, max_retries: 3, error_stage: 'download', error_message: 'synthetic Graph outage',
  } });
  let graphCalls = 3;
  const incoming = email({ id, internetMessageId: '<fw-retry@example.test>', conversationId: null,
    subject: 'FW: Forwarded invoice details', hasAttachments: true,
    body: { contentType: 'HTML', content: '<p>Forwarded invoice details; please process.</p>' },
    internetMessageHeaders: [{ name: 'In-Reply-To', value: '<unmatched-source@example.test>' }] });

  const result = await withPipelinePool(pool, async ({ runPipeline }) => runPipeline({
    postProcess: false,
    dependencies: {
      fetchEmailList: async () => [incoming],
      downloadAttachments: async () => { graphCalls++; throw new Error('unexpected fourth Graph call'); },
      getQueueCount: async () => 0,
    },
  }));

  assert.equal(graphCalls, 3);
  assert.equal(result.errors, 0);
  assert.equal(result.processed, 1);
  assert.equal(result.queued, 1);
  assert.equal(pool.state.processed.has(id), true);
  assert.equal(pool.state.inboundRows.length, 0);
  assert.equal(pool.state.documents.length, 1);
  const [placeholder] = pool.state.documents;
  assert.equal(placeholder.classification, 'no-attachment');
  assert.equal(placeholder.email_body, incoming.body.content);
});

test('References route an exact split child and conversation fallback returns one parent root', async () => {
  const child = await correlateInbound(email({ internetMessageHeaders: [{ name: 'References', value: '<out-child>' }] }),
    lookupPool([{ id: 'child-2', split_from: 'parent-1', email_from: 'billing@vendor.example' }]));
  assert.deepEqual([child.documentId, child.tier], ['child-2', 0]);
  const parent = await correlateInbound(email({ internetMessageHeaders: [] }), lookupPool([], [
    { id: 'child-1', split_from: 'parent-1', email_from: 'billing@vendor.example' },
    { id: 'child-2', split_from: 'parent-1', email_from: 'billing@vendor.example' },
  ]));
  assert.deepEqual([parent.documentId, parent.parentFallback], ['parent-1', true]);
});

test('ambiguous references and conversations never select a document', async () => {
  const refs = await correlateInbound(email({ internetMessageHeaders: [{ name: 'References', value: '<one> <two>' }] }), lookupPool([
    { id: 'doc-a', split_from: null, email_from: 'a@example.com' }, { id: 'doc-b', split_from: null, email_from: 'b@example.com' },
  ]));
  assert.equal(refs.ambiguous, true); assert.equal(refs.documentId, undefined);
  const conversations = await correlateInbound(email({ internetMessageHeaders: [], conversationId: 'shared' }), lookupPool([], [
    { id: 'doc-a', split_from: 'parent-a' }, { id: 'doc-b', split_from: 'parent-b' },
  ]));
  assert.equal(conversations.ambiguous, true); assert.equal(conversations.documentId, undefined);
});

test('automatic replies drop before lookup and unmatched mail remains normal ingestion', async () => {
  const pool = lookupPool();
  assert.deepEqual(await divertInboundEmail({ email: email({ subject: 'Automatic reply: OOO' }), db: pool, config: {} }),
    { action: 'drop', reason: 'automatic-reply' });
  assert.equal(pool.calls.length, 0);
  assert.deepEqual(await divertInboundEmail({ email: email({ subject: 'Invoice 1', conversationId: null, internetMessageId: null, internetMessageHeaders: [] }), db: pool, config: {} }),
    { action: 'normal' });
  assert.deepEqual(await divertInboundEmail({ email: email({ subject: 'Invoice 1', conversationId: 'unknown', internetMessageHeaders: [] }), db: lookupPool([], []), config: {} }),
    { action: 'normal' });
  assert.equal(isAutomaticReply(email({ internetMessageHeaders: [{ name: 'Precedence', value: 'bulk' }] })), true);
});

test('(g) default pipeline diversion holds ambiguity, preserves unmatched normal flow, and drops automatic replies', async () => {
  const heldPool = pipelinePool({
    referenceRows: [{ id: 'doc-a', split_from: null, email_from: 'billing@vendor.example' }, { id: 'doc-b', split_from: null, email_from: 'billing@vendor.example' }],
  });
  let downloads = 0;
  await withPipelinePool(heldPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'ambiguous-pipeline', internetMessageHeaders: [{ name: 'References', value: '<out-a> <out-b>' }] })],
        downloadAttachments: async () => { downloads++; return { files: [] }; },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.processed, 1); assert.equal(result.errors, 0); assert.equal(downloads, 0);
    assert.deepEqual(heldPool.state.inbound, [{ documentId: null, state: 'ambiguous', reason: 'ambiguous-references' }]);
    assert.equal(heldPool.state.processed.has('ambiguous-pipeline'), true);
    assert.equal(heldPool.state.commits, 1); assert.equal(heldPool.state.rollbacks, 0);
  });

  const conversationPool = pipelinePool({
    conversationRows: [{ id: 'doc-a', split_from: 'parent-a' }, { id: 'doc-b', split_from: 'parent-b' }],
  });
  await withPipelinePool(conversationPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'ambiguous-conversation-pipeline', internetMessageHeaders: [] })],
        downloadAttachments: async () => { assert.fail('ambiguous conversation downloaded an attachment'); },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.processed, 1); assert.equal(conversationPool.state.inbound[0].state, 'ambiguous');
    assert.equal(conversationPool.state.inbound[0].reason, 'ambiguous-conversation');
    assert.equal(conversationPool.state.processed.has('ambiguous-conversation-pipeline'), true);
  });

  const normalPool = pipelinePool();
  await withPipelinePool(normalPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'unmatched-pipeline', hasAttachments: true, subject: 'Vendor invoice INV-1', internetMessageHeaders: [{ name: 'References', value: '<unknown>' }] })],
        downloadAttachments: async () => { downloads++; throw new Error('normal download reached'); },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.errors, 1); assert.equal(downloads, 1); assert.equal(normalPool.state.inbound.length, 0);
  });

  const unmatchedReplyPool = pipelinePool();
  await withPipelinePool(unmatchedReplyPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'unmatched-reply-pipeline', conversationId: 'fresh-conversation',
          subject: 'Re: Unknown invoice', internetMessageHeaders: [] })],
        downloadAttachments: async () => { assert.fail('unmatched reply reached attachment download'); },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.errors, 0); assert.equal(result.queued, 1); assert.equal(result.threadSkipped, 0);
    assert.deepEqual(unmatchedReplyPool.state.inbound, []);
    assert.equal(unmatchedReplyPool.state.documents.length, 1);
    assert.equal(unmatchedReplyPool.state.documents[0].classification, 'no-attachment');
    assert.equal(unmatchedReplyPool.state.processed.has('unmatched-reply-pipeline'), true);
  });

  const dropPool = pipelinePool();
  let automaticDownloads = 0;
  await withPipelinePool(dropPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'auto-pipeline', subject: 'Automatic reply: OOO' })],
        downloadAttachments: async () => { automaticDownloads++; throw new Error('automatic reply downloaded'); },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.errors, 0); assert.equal(result.threadSkipped, 1); assert.equal(automaticDownloads, 0);
    assert.equal(dropPool.state.processed.has('auto-pipeline'), true);
  });
});

test('default attachmentless matched reply commits capture and rolls back on audit failure', async () => {
  const capturedPool = pipelinePool({
    referenceRows: [{ id: 'doc-1', split_from: null, email_from: 'billing@vendor.example' }],
  });
  let downloads = 0;
  await withPipelinePool(capturedPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'attachmentless-capture', hasAttachments: false, internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] })],
        downloadAttachments: async () => { downloads++; return { files: [] }; },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.processed, 1); assert.equal(result.errors, 0); assert.equal(downloads, 0);
    assert.deepEqual(capturedPool.state.inbound, [{ documentId: 'doc-1', state: 'matched', reason: 'tier-0' }]);
    assert.equal(capturedPool.state.processed.has('attachmentless-capture'), true);
    assert.equal(capturedPool.state.commits, 1); assert.equal(capturedPool.state.rollbacks, 0);
  });

  const failedPool = pipelinePool({
    referenceRows: [{ id: 'doc-1', split_from: null, email_from: 'billing@vendor.example' }], failAudit: true,
  });
  await withPipelinePool(failedPool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email({ id: 'attachmentless-rollback', internetMessageHeaders: [{ name: 'References', value: '<outbound>' }] })],
        downloadAttachments: async () => { assert.fail('attachmentless capture downloaded an attachment'); },
        getQueueCount: async () => 0,
      },
    });
    assert.equal(result.errors, 1); assert.deepEqual(failedPool.state.inbound, []);
    assert.equal(failedPool.state.processed.has('attachmentless-rollback'), false);
    assert.equal(failedPool.state.commits, 0); assert.equal(failedPool.state.rollbacks, 1);
  });
});

test('waiver auto-link executes tier-zero identity match and refuses ambiguous identities', async () => {
  function waiverPool(rows) {
    const state = { commits: 0, rollbacks: 0, updates: [] };
    const client = { async query(sql, params = []) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') { state.commits++; return { rows: [] }; }
      if (sql === 'ROLLBACK') { state.rollbacks++; return { rows: [] }; }
      if (/FROM documents WHERE id = \$1/.test(sql)) return { rows: [{ id: 'waiver-1', linked_lien_waiver_id: null, classification: 'lien-waiver', email_subject: 'Re: Invoice 1', vendor_code: 'VEND' }] };
      if (/FROM document_email_messages/.test(sql)) return { rows };
      if (/^UPDATE documents/.test(sql)) { state.updates.push({ sql, params }); return { rows: [] }; }
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected waiver query: ${sql}`);
    }, release() {} };
    return { state, async connect() { return client; } };
  }
  const invoice = { id: 'invoice-1', invoice_number: 'INV-1', status: 'pending', email_conversation_id: 'other', waiver_request_conversation_id: 'other' };
  const one = waiverPool([invoice]);
  await withWaiverPool(one, async ({ autoLinkWaiver }) => {
    const result = await autoLinkWaiver({ id: 'waiver-1', email: { internetMessageId: '<inbound-1>' }, email_conversation_id: 'different' });
    assert.deepEqual(result, { linked: true, invoiceId: 'invoice-1' });
    assert.equal(one.state.updates[0].params[1], 'email-reference');
    assert.equal(one.state.commits, 1); assert.equal(one.state.rollbacks, 0);
  });
  const two = waiverPool([invoice, { ...invoice, id: 'invoice-2' }]);
  await withWaiverPool(two, async ({ autoLinkWaiver }) => {
    const result = await autoLinkWaiver({ id: 'waiver-1', email: { internetMessageId: '<inbound-1>' } });
    assert.deepEqual(result, { linked: false, reason: 'ambiguous-email-reference-2-eligible-invoices' });
    assert.equal(two.state.updates.length, 0); assert.equal(two.state.commits, 0); assert.equal(two.state.rollbacks, 1);
  });
});

test('forged References attach unverified and only sanitized HTML is stored', async () => {
  const pool = lookupPool([{ id: 'doc-1', split_from: null, email_from: 'billing@vendor.example' }]);
  const result = await divertInboundEmail({ email: email({
    from: { emailAddress: { address: 'attacker@evil.example' } },
    internetMessageHeaders: [{ name: 'References', value: '<outbound@example.com>' }], hasAttachments: true,
    body: { contentType: 'HTML', content: '<p>Hi</p><script>fetch("/steal")</script><img src="https://tracker.invalid/x" onerror="alert(1)">' },
  }), db: pool, config: { mailbox: 'invoices@northwindcg.example', internalDomains: ['northwindcg.example'] } });
  assert.deepEqual([result.documentId, result.verifiedParticipant, result.hasAttachments], ['doc-1', false, true]);
  const insert = pool.calls.find(call => call.sql.startsWith('INSERT INTO document_email_messages'));
  assert.doesNotMatch(insert.params[11], /script|img|tracker|onerror|fetch/i);
  assert.match(insert.params[11], /<p>Hi<\/p>/); assert.equal(insert.params[12], true);
});

test('subject-recency holds a cross-sender reply and never promotes it to a matched correlation', async () => {
  const pool = lookupPool([], [], new Set(), [{ id: 'doc-1', split_from: null, email_from: 'billing@vendor.example', subject: 'TEST INVOICE' }]);
  const result = await divertInboundEmail({
    email: email({ conversationId: 'fresh-conversation', subject: 'RE:   TEST   INVOICE',
      from: { emailAddress: { address: 'employee@othervendor.example' } }, internetMessageHeaders: [] }),
    db: pool, config: { mailbox: 'invoices@northwindcg.example', internalDomains: ['northwindcg.example'] },
  });
  assert.deepEqual({ action: result.action, documentId: result.documentId, state: result.correlationState,
    reason: result.correlationReason, verified: result.verifiedParticipant }, {
    action: 'held', documentId: 'doc-1', state: 'ambiguous', reason: 'subject-recency', verified: false,
  });
});

test('(f) subject-recency refuses multiple document candidates; unmatched attachmentless replies stay normal', async () => {
  const ambiguous = await divertInboundEmail({
    email: email({ conversationId: 'fresh-conversation', subject: 'Fwd: Re: TEST INVOICE', internetMessageHeaders: [] }),
    db: lookupPool([], [], new Set(), [
      { id: 'doc-1', split_from: null, email_from: 'a@example.com', subject: 'Test invoice' },
      { id: 'doc-2', split_from: null, email_from: 'b@example.com', subject: 'TEST INVOICE' },
    ]), config: {},
  });
  assert.deepEqual([ambiguous.action, ambiguous.documentId, ambiguous.correlationState, ambiguous.correlationReason],
    ['held', undefined, 'ambiguous', 'ambiguous-subject']);

  const unmatchedPool = lookupPool();
  const unmatched = await divertInboundEmail({
    email: email({ conversationId: 'fresh-conversation', subject: 'Re: Unknown invoice', internetMessageHeaders: [] }),
    db: unmatchedPool, config: {},
  });
  assert.deepEqual(unmatched, { action: 'normal' });
  assert.equal(unmatchedPool.calls.some(call => call.sql.startsWith('INSERT INTO document_email_messages')), false);
});

test('plain vendor mail and unmatched NDRs stay on normal ingestion', async () => {
  const pool = lookupPool();
  assert.deepEqual(await divertInboundEmail({
    email: email({ subject: 'Invoice INV-1', conversationId: 'fresh-conversation', internetMessageHeaders: [] }), db: pool, config: {},
  }), { action: 'normal' });
  const ndr = await divertInboundEmail({
    email: email({ subject: 'Delivery Status Notification (Failure)', conversationId: null, internetMessageHeaders: [] }), db: pool, config: {},
  });
  assert.deepEqual(ndr, { action: 'normal' });
  assert.equal(pool.calls.some(call => call.sql.startsWith('INSERT INTO document_email_messages')), false);
});

test('NDRs are retained, attachmentless replies are captured, and replay is deduplicated', async () => {
  const pool = lookupPool([], [{ id: 'doc-1', split_from: null, email_from: 'billing@vendor.example' }]);
  const config = { mailbox: 'invoices@northwindcg.example', internalDomains: ['northwindcg.example'] };
  const ndr = await divertInboundEmail({ email: email({ subject: 'Delivery Status Notification (Failure)', from: { emailAddress: { address: 'mailer-daemon@northwindcg.example' } }, internetMessageHeaders: [{ name: 'Status', value: '5.1.1' }] }), db: pool, config });
  assert.equal(isNdr(email({ subject: 'Failure notice' })), true); assert.equal(ndr.kind, 'ndr');
  const reply = await divertInboundEmail({ email: email({ internetMessageId: '<in-2@example.com>', id: 'graph-in-2' }), db: pool, config });
  assert.equal(reply.action, 'captured');
  const replay = await divertInboundEmail({ email: email({ internetMessageId: '<in-2@example.com>', id: 'graph-in-3' }), db: pool, config });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(messageIds(email({ internetMessageHeaders: [{ name: 'References', value: '<a> <b>' }, { name: 'In-Reply-To', value: '<b>' }] })), ['<a>', '<b>']);
});

test('sanitizer escapes text and removes active, remote, and event-bearing markup', () => {
  const html = sanitizeInboundHtml('<style>x</style><svg><script>x</script></svg><a href="javascript:alert(1)" onclick="evil()">safe</a>');
  assert.doesNotMatch(html, /style|svg|script|javascript|onclick/i);
  assert.equal(sanitizeInboundHtml('<b><unsafe>text</unsafe></b>', 'text'), '&lt;b&gt;&lt;unsafe&gt;text&lt;\/unsafe&gt;&lt;\/b&gt;');
});

test('migration, pipeline order, activity projection, and test enumeration preserve the scope fence', () => {
  const root = path.resolve(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'migrations/2026-09-16_document_email_messages.sql'), 'utf8');
  const correlationMigration = fs.readFileSync(path.join(root, 'migrations/2026-09-17_document_email_correlation.sql'), 'utf8');
  const pipeline = fs.readFileSync(path.join(root, 'modules/invoices/services/pipeline.js'), 'utf8');
  const activity = fs.readFileSync(path.join(root, 'modules/invoices/services/activityService.js'), 'utf8');
  const waiver = fs.readFileSync(path.join(root, 'modules/invoices/services/waiverAutoLinkService.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(migration, /in_reply_to TEXT|correlation_state|inbound_internet_uidx/);
  assert.match(correlationMigration, /in_reply_to TEXT/);
  assert.match(correlationMigration, /correlation_state TEXT/); assert.match(correlationMigration, /correlation_reason TEXT/);
  assert.match(correlationMigration, /UNIQUE INDEX.*inbound_internet_uidx/s);
  assert.ok(pipeline.indexOf('const inboundEarly') < pipeline.indexOf('const downloadResult ='), 'auto-reply and NDR inspection stays before download');
  assert.ok(pipeline.indexOf('const preFilterReasons') < pipeline.indexOf('if (!inbound)'), 'other route choices follow the real-file prefilter');
  assert.match(pipeline, /finishEmailIngestionTransaction\(persistenceDb, msgId/);
  assert.match(activity, /sanitizedBodyHtml/); assert.match(activity, /correlationState/);
  assert.match(pkg.scripts.test, /inbound-correlation\.test\.js/);
  assert.match(waiver, /document_email_messages/); assert.match(waiver, /m\.internet_message_id = ANY/);
  assert.match(waiver, /email-reference/); assert.match(waiver, /email-thread/); assert.match(waiver, /subject-vendor/);
});

test('activity serialization exposes sanitized inbound HTML and correlation state without raw bodies', () => {
  const entry = serializeEmail({
    direction: 'in', id: 'in-1', document_id: 'doc-1', kind: 'inbound', status: 'confirmed',
    body_preview: 'safe preview', sanitized_body_html: '<p>safe</p>',
    correlation_state: 'ambiguous', correlation_reason: 'ambiguous-references',
    in_reply_to: '<outbound@example.com>', conversation_id: 'conv-1',
    received_at: '2026-09-16T12:00:00Z', has_attachments: true,
    attachment_reviewed: false, verified_participant: false,
  });
  assert.equal(entry.sanitizedBodyHtml, '<p>safe</p>');
  assert.equal(entry.correlationState, 'ambiguous');
  assert.equal(entry.correlationReason, 'ambiguous-references');
  assert.equal(Object.hasOwn(entry, 'body'), false);
});
