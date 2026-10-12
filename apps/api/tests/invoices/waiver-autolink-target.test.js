'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { syntheticPdf, targetPool, withAutoLink, withPipelinePool } = require('./inbound-routing-fixtures');

function invoice(id, overrides = {}) {
  return { id, classification: 'invoice', status: 'pending', lien_waiver_required: true,
    linked_lien_waiver_id: null, waiver_requested_at: '2026-10-01T12:00:00Z',
    email_from: 'ap@coreroofing.example', email_subject: 'Core Roofing Invoice 100', vendor_code: 'CORE',
    email_conversation_id: 'core-thread', waiver_request_conversation_id: 'request-thread',
    waiver_request_recipient: 'ap@coreroofing.example', waiver_request_subject: 'Core Roofing — Lien Waiver Request',
    split_from: null, ...overrides };
}
function inbound(subject, overrides = {}) {
  return { id: 'waiver-reply', internetMessageId: '<waiver-reply@example.test>', conversationId: 'core-thread',
    subject, from: { emailAddress: { address: 'ap@coreroofing.example' } }, receivedDateTime: null,
    body: { contentType: 'HTML', content: '<p>Attached.</p>' }, hasAttachments: true, ...overrides };
}
function requestReply(code, { subjectTag = false, headers = false } = {}) {
  const tag = subjectTag ? ` [Ref:${code}]` : '';
  return inbound(`RE: Core Roofing Invoice 100 — Lien Waiver Request${tag}`, {
    body: { contentType: 'HTML', content: `Attached release.<!-- toolbox-ref:${code} -->` },
    ...(headers ? { internetMessageHeaders: [{ name: 'In-Reply-To', value: '<source@example.test>' }] } : {}),
  });
}

async function runReply({ targets, conversations = targets, referenceRows = targets, email, files, classify,
  beforeAutoLink, autoLinkFailure = false }) {
  const pool = targetPool(targets, { conversations, referenceRows });
  const classifyCalls = [], autoLinkCalls = [], logs = [];
  const result = await withAutoLink(pool, autoLinkWaiver => withPipelinePool(pool, ({ runPipeline }) => runPipeline({ postProcess: false, dependencies: {
    fetchEmailList: async () => [email],
    downloadAttachments: async () => ({ files }),
    classifyAndExtract: async (file, context) => { classifyCalls.push({ file, context }); return classify(context); },
    autoLinkWaiver: async (waiver, opts) => { autoLinkCalls.push({ waiver, opts, commits: pool.state.commits });
      if (beforeAutoLink) await beforeAutoLink({ waiver, opts, pool });
      if (autoLinkFailure) throw new Error('synthetic post-commit auto-link failure');
      return autoLinkWaiver(waiver, opts); },
    log: message => logs.push(message),
    getQueueCount: async () => 0,
  } })));
  return { pool, result, classifyCalls, autoLinkCalls, logs };
}

function tempImage(name, size) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'waiver-target-'));
  const filePath = path.join(directory, name); fs.writeFileSync(filePath, Buffer.alloc(size, 1));
  return { directory, filePath };
}

async function exercise(spec) {
  const files = [], cleanup = [];
  for (const [index, item] of (spec.attachments || [[spec.fileName || 'reply.pdf']]).entries()) {
    const [name, size, isInline] = Array.isArray(item) ? item : [item, null, false];
    const generated = name.endsWith('.pdf') ? syntheticPdf(name) : tempImage(name, size || 4096);
    cleanup.push(generated.directory);
    files.push({ path: generated.filePath, filename: name, attachmentId: `attachment-${index}`, ...(isInline ? { isInline: true } : {}) });
  }
  try {
    return await runReply({ ...spec, files, classify: spec.classify || (context => ({
      classification: context.forceClassification || 'invoice', pageClassifications: spec.pageClasses || ['invoice'], extracted: null,
    })) });
  } finally { cleanup.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); }
}

test('TC-09 synthetic Core Roofing waiver request forces one PDF and targets the correlated invoice after commit', async () => {
  const target = invoice('doc-core-r009'), pdf = syntheticPdf('release.pdf'), image = tempImage('image001.png', 4096);
  try {
    const run = await runReply({ targets: [target], email: inbound('RE: Core Roofing Invoice 100 — Lien Waiver Request [Ref:r009]', {
      internetMessageHeaders: [{ name: 'In-Reply-To', value: '<request@example.test>' }],
      body: { contentType: 'HTML', content: '<p>Completed release</p><!-- toolbox-ref:r009 -->' },
    }), files: [{ path: pdf.filePath, filename: 'release.pdf', attachmentId: 'pdf-9' },
      { path: image.filePath, filename: 'image001.png', attachmentId: 'img-9', isInline: true }],
    classify: context => ({ classification: context.forceClassification || 'invoice', pageClassifications: ['invoice'], extracted: null }) });
    const waiverDocuments = run.pool.state.documents.filter(row => row.classification === 'lien-waiver');
    const [document] = waiverDocuments;
    assert.equal(document.classification, 'lien-waiver');
    assert.equal(waiverDocuments.length, 1);
    assert.equal(run.classifyCalls.length, 1, 'the filtered inline image must not reach classification');
    assert.equal(path.basename(run.classifyCalls[0].file), 'release.pdf');
    const imageSkip = run.pool.state.calls.find(call => /INSERT INTO attachment_skip_log/.test(call.sql)
      && call.params[0] === 'image001.png');
    assert.ok(imageSkip, 'the real-file prefilter must record image001.png as skipped');
    assert.equal(imageSkip.params[1], 4096);
    assert.match(imageSkip.params[3], /Too small/);
    assert.equal(document.source_document_id, target.id);
    assert.equal(run.autoLinkCalls.length, 1);
    assert.equal(run.autoLinkCalls[0].opts.targetInvoiceId, target.id);
    assert.ok(run.autoLinkCalls[0].commits > 0, 'auto-link starts after the ingestion commit');
    assert.equal(target.linked_lien_waiver_id, null);
    assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, document.id);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); fs.rmSync(image.directory, { recursive: true, force: true }); }
});

test('TC-14 non-waiver outbound forward subject does not force R9', async () => {
  const target = invoice('doc-core-r014');
  const pdf = syntheticPdf('invoice.pdf');
  try {
    const run = await runReply({ targets: [target], email: inbound('FW: Core Roofing Invoice 100 — Invoice copy [Ref:r014]'),
      files: [{ path: pdf.filePath, filename: 'invoice.pdf', attachmentId: 'pdf-14' }],
      classify: context => ({ classification: context.forceClassification || 'invoice', extracted: null }) });
    assert.equal(run.pool.state.documents.find(row => row.file_name === 'invoice.pdf')?.classification, 'invoice');
    assert.equal(run.classifyCalls[0].context.forceClassification, null);
    assert.equal(run.autoLinkCalls.length, 0);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-15c stale waiver ref does not force a waiver or link to the vendor next invoice', async () => {
  const stale = invoice('doc-core-s009', { status: 'submitted' });
  const next = invoice('doc-core-n010', { id: 'doc-core-n010', email_conversation_id: 'core-thread', waiver_request_conversation_id: null });
  const pdf = syntheticPdf('next-invoice.pdf');
  try {
    const run = await runReply({ targets: [stale, next], conversations: [next],
      email: inbound('RE: Core Roofing Invoice 101 — Lien Waiver Request [Ref:s009]'),
      files: [{ path: pdf.filePath, filename: 'next-invoice.pdf', attachmentId: 'pdf-15c' }],
      classify: context => ({ classification: context.forceClassification === null ? 'invoice' : 'lien-waiver', extracted: null }) });
    const doc = run.pool.state.documents.find(row => row.id !== stale.id && row.id !== next.id);
    assert.equal(doc.classification, 'invoice');
    assert.equal(run.autoLinkCalls.length, 0);
    assert.equal(run.pool.state.documents.find(row => row.id === next.id).linked_lien_waiver_id, null);
    assert.equal(run.result.errors, 0);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-16c one six-page stacked waiver PDF stays unlinked with the multi-waiver-bundle reason', async () => {
  const target = invoice('doc-core-r16c'), pdf = syntheticPdf('stacked-waiver.pdf');
  try {
    const run = await runReply({ targets: [target], email: inbound('RE: Core Roofing Invoice 100 — Lien Waiver Request [Ref:r16c]'),
      files: [{ path: pdf.filePath, filename: 'stacked-waiver.pdf', attachmentId: 'pdf-16c' }],
      classify: context => ({ classification: context.forceClassification || 'invoice',
        pageClassifications: Array(6).fill('lien-waiver'), extracted: null }) });
    const document = run.pool.state.documents.find(row => row.id !== target.id);
    assert.equal(document.classification, 'lien-waiver');
    assert.equal(run.autoLinkCalls.length, 1, 'the persisted waiver must reach the real auto-link service');
    assert.deepEqual(run.autoLinkCalls[0].waiver.pageClassifications, Array(6).fill('lien-waiver'));
    assert.equal(document.waiver_auto_link_skip_reason, 'multi-waiver-bundle');
    assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, null);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

test('TC-17c recorded recipientOverride sender is trusted for the targeted invoice', async () => {
  const target = invoice('doc-core-r17c', { waiver_request_recipient: 'releases@waiver-vendor.example' });
  const pdf = syntheticPdf('release.pdf');
  try {
    const run = await runReply({ targets: [target], email: inbound('RE: Core Roofing Invoice 100 — Lien Waiver Request [Ref:r17c]', {
      from: { emailAddress: { address: 'releases@waiver-vendor.example' } },
    }), files: [{ path: pdf.filePath, filename: 'release.pdf', attachmentId: 'pdf-17c' }],
    classify: context => ({ classification: context.forceClassification || 'invoice', pageClassifications: ['lien-waiver'] }) });
    const waiver = run.pool.state.documents.find(row => row.classification === 'lien-waiver');
    assert.ok(waiver);
    assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, waiver.id);
    assert.equal(waiver.waiver_auto_link_skip_reason || null, null);
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
});

const identificationCases = [
  { name: 'TC-11 body ref only identifies the waiver request', targets: [invoice('doc-core-r011')], email: requestReply('r011'), expected: 'lien-waiver' },
  { name: 'TC-13 zero ref matches do not force R9', targets: [invoice('doc-core-c013')], referenceRows: [invoice('doc-core-c013')], email: requestReply('z013', { headers: true }), expected: 'invoice' },
  { name: 'TC-13 multiple ref matches do not force R9', targets: [invoice('doc-core-c013'), invoice('doc-a-m013'), invoice('doc-b-m013')], referenceRows: [invoice('doc-core-c013')], email: requestReply('m013', { headers: true }), expected: 'invoice' },
  { name: 'TC-13b body ref to a promoted body document does not force R9', targets: [invoice('doc-core-c013'), invoice('doc-core-b013', { classification: 'no-attachment' })], referenceRows: [invoice('doc-core-c013')], email: requestReply('b013', { headers: true }), expected: 'invoice' },
  { name: 'TC-13c body ref to a sibling split child does not force R9', targets: [invoice('doc-core-c113', { split_from: 'doc-core-root' }), invoice('doc-vendor-b013', { split_from: 'doc-core-root' })], referenceRows: [invoice('doc-core-c113', { split_from: 'doc-core-root' })], email: requestReply('b013', { headers: true }), expected: 'invoice' },
  { name: 'TC-15 request subject without waiver_requested_at falls back to AI', targets: [invoice('doc-core-r015', { waiver_requested_at: null })], email: requestReply('r015', { subjectTag: true }), expected: 'invoice' },
  { name: 'TC-15b exact waiver-request subject with no ref stays unmatched R7 and ingests normally', targets: [], referenceRows: [], conversations: [],
    email: inbound('RE: Core Roofing Invoice 100 — Lien Waiver Request'), expected: 'invoice' },
  { name: 'TC-15d lowercase body ref resolves case-insensitively', targets: [invoice('doc-core-R15D')], email: requestReply('r15d'), expected: 'lien-waiver' },
];

for (const scenario of identificationCases) test(scenario.name, async () => {
  const run = await exercise(scenario), document = run.pool.state.documents.find(row => row.file_name === 'reply.pdf');
  assert.equal(document.classification, scenario.expected);
  assert.equal(run.classifyCalls[0].context.forceClassification, scenario.expected === 'lien-waiver' ? 'lien-waiver' : null);
  assert.equal(run.autoLinkCalls.length, scenario.expected === 'lien-waiver' ? 1 : 0);
  // Unmatched mail now takes the normal path, so no inbound review row is written.
  if (scenario.name.startsWith('TC-15b')) assert.equal(run.pool.state.inboundRows.length, 0);
});
