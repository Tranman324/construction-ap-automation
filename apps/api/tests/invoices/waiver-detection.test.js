'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { syntheticPdf, targetPool, withAutoLink, withPipelinePool } = require('./inbound-routing-fixtures');

const {
  WAIVER_REGEX,
  INVOICE_STRONG_REGEX,
  applyWaiverPrePass,
} = require('../../modules/invoices/services/waiverDetection');

function targetInvoice(id, overrides = {}) {
  return { id, classification: 'invoice', status: 'pending', lien_waiver_required: true,
    linked_lien_waiver_id: null, waiver_requested_at: '2026-10-01T12:00:00Z', email_from: 'ap@coreroofing.example',
    email_subject: 'Core Roofing Invoice 100', vendor_code: 'CORE', email_conversation_id: 'core-thread',
    waiver_request_conversation_id: 'request-thread', waiver_request_recipient: 'ap@coreroofing.example',
    waiver_request_subject: 'Core Roofing — Lien Waiver Request', split_from: null, ...overrides };
}

function replyEmail(subject, { from = 'ap@coreroofing.example', body = 'Attached.', headers = false } = {}) {
  return { id: `message-${Math.random()}`, internetMessageId: '<reply@example.test>', conversationId: 'core-thread',
    subject, from: { emailAddress: { address: from } }, body: { contentType: 'HTML', content: body }, hasAttachments: true,
    ...(headers ? { internetMessageHeaders: [{ name: 'In-Reply-To', value: '<source@example.test>' }] } : {}) };
}

async function runTargetReply({ targets, referenceRows = targets, conversations = targets, email, files, classify,
  beforeAutoLink, autoLinkFailure = false, visionResponses, ocrStub, graphAttachments }) {
  const pool = targetPool(targets, { referenceRows, conversations }), autoLinks = [], logs = [], classifyCalls = [];
  let graphCalls = 0;
  const visionPath = require.resolve('../../modules/invoices/services/vision'), previousVision = require.cache[visionPath];
  const ocrPath = require.resolve('../../modules/invoices/services/ocr'), previousOcr = require.cache[ocrPath];
  const graphPath = require.resolve('../../lib/graph'), previousGraph = require.cache[graphPath];
  if (visionResponses) require.cache[visionPath] = { id: visionPath, filename: visionPath, loaded: true,
    exports: { callHaiku: async (...args) => visionResponses(...args) } };
  if (ocrStub) require.cache[ocrPath] = { id: ocrPath, filename: ocrPath, loaded: true, exports: ocrStub };
  if (graphAttachments) require.cache[graphPath] = { id: graphPath, filename: graphPath, loaded: true,
    exports: { graphFetch: async () => { graphCalls++; return { value: graphAttachments }; } } };
  try {
    const result = await withAutoLink(pool, service => withPipelinePool(pool, ({ runPipeline }) => {
      const dependencies = { fetchEmailList: async () => [email],
      autoLinkWaiver: async (waiver, opts) => { autoLinks.push({ waiver, opts, commits: pool.state.commits });
        if (beforeAutoLink) await beforeAutoLink({ waiver, opts, pool });
        if (autoLinkFailure) throw new Error('synthetic post-commit auto-link failure');
        return service(waiver, opts); }, log: message => logs.push(message), getQueueCount: async () => 0 };
      if (!graphAttachments) dependencies.downloadAttachments = async () => ({ files });
      if (classify) dependencies.classifyAndExtract = async (file, context) => {
        classifyCalls.push({ file, context }); return classify(context, file);
      };
      return runPipeline({ postProcess: false, dependencies });
    }));
    return { pool, result, autoLinks, logs, classifyCalls, graphCalls };
  } finally {
    if (previousVision) require.cache[visionPath] = previousVision; else delete require.cache[visionPath];
    if (previousOcr) require.cache[ocrPath] = previousOcr; else delete require.cache[ocrPath];
    if (previousGraph) require.cache[graphPath] = previousGraph; else delete require.cache[graphPath];
  }
}

function syntheticImage(name, size) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waiver-contract-'));
  const filePath = path.join(directory, name); fs.writeFileSync(filePath, Buffer.alloc(size, 1));
  return { directory, filePath };
}

async function runOnePdf(options) {
  const pdf = syntheticPdf(options.fileName || 'reply.pdf');
  try {
    return await runTargetReply({ ...options, files: [{ path: pdf.filePath, filename: path.basename(pdf.filePath), attachmentId: 'synthetic-pdf' }] });
  } finally { fs.rmSync(pdf.directory, { recursive: true, force: true }); }
}

async function runAttachments(options) {
  const generated = [], files = [];
  for (const [index, [name, size, inline = false]] of options.attachments.entries()) {
    const item = name.endsWith('.pdf') ? syntheticPdf(name) : syntheticImage(name, size);
    generated.push(item.directory); files.push({ path: item.filePath, filename: name, attachmentId: `att-${index}`, ...(inline ? { isInline: true } : {}) });
  }
  try { return await runTargetReply({ ...options, files }); }
  finally { generated.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); }
}

function requestEmail(code, { from = 'ap@coreroofing.example', prefix = 'RE' } = {}) {
  return replyEmail(`${prefix}: Core Roofing Invoice 100 — Lien Waiver Request [Ref:${code}]`, {
    from, body: `Completed release <!-- toolbox-ref:${code} -->`, headers: prefix === 'FW',
  });
}

// --- WAIVER_REGEX hits ---

test('WAIVER_REGEX matches "Waiver and Release of Lien"', () => {
  assert.ok(WAIVER_REGEX.test('WAIVER AND RELEASE OF LIEN'));
});

test('WAIVER_REGEX matches "Release of Lien" standalone', () => {
  assert.ok(WAIVER_REGEX.test('Some text with Release of Lien buried in it'));
});

test('WAIVER_REGEX matches "Payment Bond Rights"', () => {
  assert.ok(WAIVER_REGEX.test('PAYMENT BOND RIGHTS'));
});

test('WAIVER_REGEX matches "Waiver and Release Upon Final Payment"', () => {
  assert.ok(WAIVER_REGEX.test('WAIVER AND RELEASE UPON FINAL PAYMENT'));
});

test('WAIVER_REGEX matches "Waiver and Release Upon Progress Payment"', () => {
  assert.ok(WAIVER_REGEX.test('Waiver and Release Upon Progress Payment'));
});

test('WAIVER_REGEX matches "Unconditional Waiver"', () => {
  assert.ok(WAIVER_REGEX.test('UNCONDITIONAL WAIVER AND RELEASE'));
});

test('WAIVER_REGEX matches "Conditional Waiver"', () => {
  assert.ok(WAIVER_REGEX.test('CONDITIONAL WAIVER'));
});

test('WAIVER_REGEX matches "Waiver ... Upon Final Payment" with intervening text', () => {
  assert.ok(WAIVER_REGEX.test('WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT'));
});

// --- WAIVER_REGEX non-hits ---

test('WAIVER_REGEX does not match plain invoice text', () => {
  assert.ok(!WAIVER_REGEX.test('Invoice Number: 12345\nAmount Due: $5,000.00'));
});

test('WAIVER_REGEX does not match random text', () => {
  assert.ok(!WAIVER_REGEX.test('Concrete pouring work at 123 Main St'));
});

test('WAIVER_REGEX does not match "warranty"', () => {
  assert.ok(!WAIVER_REGEX.test('This product comes with a warranty'));
});

// --- applyWaiverPrePass ---

test('applyWaiverPrePass reclassifies page 2 from other to lien-waiver', () => {
  const classes = ['invoice', 'other'];
  const texts = [
    'Invoice Number: 12345 Amount Due: $5,000',
    'WAIVER AND RELEASE OF LIEN AND PAYMENT BOND RIGHTS UPON FINAL PAYMENT',
  ];
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 1);
  assert.equal(classes[0], 'invoice');
  assert.equal(classes[1], 'lien-waiver');
});

test('applyWaiverPrePass reclassifies page 2 from invoice to lien-waiver', () => {
  const classes = ['invoice', 'invoice'];
  const texts = [
    'Invoice Number: 12345 Amount Due: $5,000',
    'UNCONDITIONAL WAIVER AND RELEASE UPON PROGRESS PAYMENT signed and notarized',
  ];
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 1);
  assert.equal(classes[0], 'invoice');
  assert.equal(classes[1], 'lien-waiver');
});

test('applyWaiverPrePass does NOT reclassify page 1 when ambiguous (invoice signals + waiver)', () => {
  const classes = ['invoice'];
  const texts = [
    'Invoice Number: 12345 Amount Due: $500.00 WAIVER AND RELEASE OF LIEN',
  ];
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 0);
  assert.equal(classes[0], 'invoice'); // kept Haiku's call
});

test('applyWaiverPrePass DOES reclassify page 1 if waiver only (no invoice signals)', () => {
  const classes = ['other'];
  const texts = [
    'WAIVER AND RELEASE OF LIEN AND PAYMENT BOND RIGHTS UPON FINAL PAYMENT signed by contractor',
  ];
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 1);
  assert.equal(classes[0], 'lien-waiver');
});

test('applyWaiverPrePass skips pages with null text', () => {
  const classes = ['invoice', 'other'];
  const texts = ['Invoice text here', null]; // null = OCR, no per-page text
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 0);
  assert.equal(classes[1], 'other'); // unchanged
});

test('applyWaiverPrePass handles 3-page doc with waiver on page 3', () => {
  const classes = ['invoice', 'other', 'other'];
  const texts = [
    'Invoice for concrete work',
    'Summary of charges',
    'CONDITIONAL WAIVER AND RELEASE UPON PROGRESS PAYMENT',
  ];
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 1);
  assert.equal(classes[2], 'lien-waiver');
});

test('applyWaiverPrePass does not reclassify already-classified lien-waiver', () => {
  const classes = ['invoice', 'lien-waiver'];
  const texts = [
    'Invoice text',
    'WAIVER AND RELEASE OF LIEN',
  ];
  const count = applyWaiverPrePass(classes, texts);
  assert.equal(count, 0); // already correct
});

const targetLinkCases = [
  { name: 'TC-16 multiple PDFs each persist multiple-attachments-on-waiver-reply', code: 'r016', attachments: [['one.pdf'], ['two.pdf']], expect: 'multiple-attachments-on-waiver-reply' },
  { name: 'TC-16b filtered small non-inline image leaves one PDF linkable', code: 'r16b', attachments: [['release.pdf'], ['image001.png', 4096]], expect: 'linked' },
  { name: 'TC-17 unrelated sender domain persists unverified-sender', code: 'r017', from: 'vendor@unrelated.example', expect: 'unverified-sender' },
  { name: 'TC-17b allowed freemail domain still requires the exact request address', code: 'r17b', from: 'other@gmail.com', recipient: 'waiver@gmail.com', expect: 'unverified-sender' },
  { name: 'TC-18 eligibility lost before link persists invoice-not-eligible', code: 'r018', expect: 'invoice-not-eligible', race: true },
  { name: 'TC-19 second eligible conversation invoice cannot displace the ref target', code: 'r019', second: true, expect: 'linked' },
  { name: 'TC-20 internal staff forward with target ref links only the target invoice', code: 'r020', from: 'staff@northwindcg.example', prefix: 'FW', expect: 'linked' },
];

for (const scenario of targetLinkCases) test(scenario.name, async () => {
  const targetId = `doc-core-${scenario.code}`;
  const target = targetInvoice(targetId, scenario.recipient ? { waiver_request_recipient: scenario.recipient } : {});
  const targets = [target, ...(scenario.second ? [targetInvoice('doc-core-other019')] : [])];
  const run = await runAttachments({ targets, email: requestEmail(scenario.code, scenario),
    attachments: scenario.attachments || [['release.pdf']],
    classify: context => ({ classification: context.forceClassification || 'invoice', pageClassifications: ['lien-waiver'], extracted: null }),
    beforeAutoLink: scenario.race ? ({ pool }) => { pool.state.documents.find(row => row.id === targetId).status = 'submitted'; } : null });
  const waivers = run.pool.state.documents.filter(row => row.classification === 'lien-waiver');
  if (scenario.code === 'r016') {
    assert.equal(waivers.length, 2);
    assert.deepEqual(waivers.map(row => row.waiver_auto_link_skip_reason), [scenario.expect, scenario.expect]);
  } else if (scenario.expect === 'linked') {
    assert.equal(waivers.length, 1);
    assert.equal(run.pool.state.documents.find(row => row.id === targetId).linked_lien_waiver_id, waivers[0].id);
    if (scenario.second) assert.equal(run.pool.state.documents.find(row => row.id === 'doc-core-other019').linked_lien_waiver_id, null);
    if (scenario.code === 'r16b') {
      assert.equal(run.classifyCalls.length, 1);
      assert.equal(path.basename(run.classifyCalls[0].file), 'release.pdf');
    }
  } else {
    assert.equal(waivers.length, 1);
    assert.equal(waivers[0].waiver_auto_link_skip_reason, scenario.expect);
    assert.equal(run.pool.state.documents.find(row => row.id === targetId).linked_lien_waiver_id, null);
  }
});

test('TC-21 thrown detail extraction keeps lien-waiver, flags blank details, and skips auto-link', async () => {
  const image = syntheticImage('release.png', 16000), target = targetInvoice('doc-core-r021');
  let visionCalls = 0;
  try {
    const run = await runTargetReply({ targets: [target], email: requestEmail('r021'),
      files: [{ path: image.filePath, filename: 'release.png', attachmentId: 'image-21' }],
      visionResponses: async () => {
        visionCalls++;
        if (visionCalls === 1) return { text: '{"classification":"lien-waiver","confidence":0.99}', usage: { input_tokens: 1, output_tokens: 1 } };
        throw new Error('synthetic detail extraction failure');
      }, ocrStub: { collectImageText: () => ({ text: '', ocrApplied: false }), collectPdfText: () => ({ text: '', ocrApplied: false }) },
    });
    const waiver = run.pool.state.documents.find(row => row.classification === 'lien-waiver');
    assert.equal(visionCalls, 2);
    assert.ok(waiver);
    assert.equal(waiver.flagged, true);
    for (const field of ['vendor_name', 'vendor_address', 'invoice_number', 'amount']) assert.equal(waiver[field], null);
    assert.match(waiver.notes, /Details could not be read automatically/);
    assert.equal(run.result.errors, 0);
    assert.deepEqual(run.autoLinks, []);
  } finally { fs.rmSync(image.directory, { recursive: true, force: true }); }
});

test('TC-23 15 KB inline image is normally classified without force and keeps the R9 link target', async () => {
  const target = targetInvoice('doc-core-r023'), contexts = [], attachment = {
    id: 'image-23', name: 'inline.png', size: 15000, contentType: 'image/png', isInline: true,
    contentId: 'image-23',
    '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: Buffer.alloc(15000, 1).toString('base64'),
  };
  const incoming = requestEmail('r023');
  incoming.hasAttachments = false;
  incoming.body = { contentType: 'HTML', content: '<html><body><img src="cid:image-23"></body></html>' };
  const run = await runTargetReply({ targets: [target], email: incoming, graphAttachments: [attachment],
    classify: context => { contexts.push(context); return { classification: 'lien-waiver', pageClassifications: ['lien-waiver'], extracted: null }; } });
  assert.equal(run.graphCalls, 1);
  assert.equal(run.result.inlineRescued, 1);
  const waiver = run.pool.state.documents.find(row => row.file_name === 'inline.png');
  assert.equal(waiver.classification, 'lien-waiver');
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].forceClassification, null);
  assert.equal(run.autoLinks[0].opts.targetInvoiceId, target.id);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, waiver.id);
});

test('the product owner 3-page stacked waiver stays unlinked and persists multi-waiver-bundle', async () => {
  const target = targetInvoice('doc-core-owner-three-page');
  const run = await runOnePdf({ targets: [target], email: requestEmail('owner-three-page'),
    classify: context => ({ classification: context.forceClassification || 'lien-waiver',
      pageClassifications: ['lien-waiver', 'lien-waiver', 'lien-waiver'], extracted: null }) });
  const waiver = run.pool.state.documents.find(row => row.id !== target.id);
  assert.ok(waiver);
  assert.equal(run.autoLinks.length, 1, 'the waiver must reach the real auto-link service');
  assert.equal(waiver.waiver_auto_link_skip_reason, 'multi-waiver-bundle');
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, null);
});

test('the product owner 2-page waiver (both pages read as waiver) still auto-links', async () => {
  const target = targetInvoice('doc-core-owner-two-page');
  const run = await runOnePdf({ targets: [target], email: requestEmail('owner-two-page'),
    classify: context => ({ classification: context.forceClassification || 'lien-waiver',
      pageClassifications: ['lien-waiver', 'lien-waiver'], extracted: null }) });
  const waiver = run.pool.state.documents.find(row => row.id !== target.id);
  assert.ok(waiver);
  assert.equal(run.autoLinks.length, 1);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, waiver.id);
  assert.notEqual(waiver.waiver_auto_link_skip_reason, 'multi-waiver-bundle');
});

test('the product owner 1-page waiver continues to link through auto-link persistence', async () => {
  const target = targetInvoice('doc-core-owner-one-page');
  const run = await runOnePdf({ targets: [target], email: requestEmail('owner-one-page'),
    classify: context => ({ classification: context.forceClassification || 'lien-waiver',
      pageClassifications: ['lien-waiver'], extracted: null }) });
  const waiver = run.pool.state.documents.find(row => row.id !== target.id);
  assert.ok(waiver);
  assert.equal(run.autoLinks.length, 1);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, waiver.id);
  assert.notEqual(waiver.waiver_auto_link_skip_reason, 'multi-waiver-bundle');
});

test('TC-31 post-commit auto-link error retains ingested document and processed email with warning', async () => {
  const target = targetInvoice('doc-core-r031'), email = requestEmail('r031');
  const run = await runOnePdf({ targets: [target], email, autoLinkFailure: true,
    classify: context => ({ classification: context.forceClassification || 'invoice', pageClassifications: ['lien-waiver'], extracted: null }) });
  assert.ok(run.pool.state.commits > 0);
  assert.ok(run.pool.state.processed.has(email.id));
  assert.equal(run.result.errors, 0);
  assert.equal(run.pool.state.documents.filter(row => row.classification === 'lien-waiver').length, 1);
  assert.ok(run.logs.some(message => /Waiver auto-link error/.test(message)));
});

test('TC-12 edited-subject waiver reply uses body-token auto-link without R9 force', async () => {
  const target = targetInvoice('doc-core-r012'), contexts = [];
  const email = replyEmail('RE: Revised invoice 100', { body: 'Release text <!-- toolbox-ref:r012 -->' });
  const run = await runOnePdf({ targets: [target], referenceRows: [], conversations: [], email,
    classify: context => { contexts.push(context); return { classification: 'lien-waiver', pageClassifications: ['lien-waiver'] }; } });
  const waiver = run.pool.state.documents.find(row => row.classification === 'lien-waiver');
  assert.equal(contexts[0].forceClassification, null);
  assert.equal(typeof run.autoLinks[0].waiver.email.body, 'string');
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, waiver.id);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).waiver_link_source, 'body-token');
});

test('TC-34 body-token auto-link reads the string body from the real pipeline queue', async () => {
  const target = targetInvoice('doc-core-r034'), contexts = [];
  const email = { ...replyEmail('RE: Edited invoice reply', { body: 'Release text <!-- toolbox-ref:r034 -->' }),
    internetMessageId: '<body-token-inbound@example.test>', internetMessageHeaders: [{ name: 'References', value: '<unrelated@example.test>' }] };
  const run = await runOnePdf({ targets: [target], referenceRows: [], conversations: [], email,
    classify: context => { contexts.push(context); return { classification: 'lien-waiver', pageClassifications: ['lien-waiver'] }; } });
  const queuedEmail = run.autoLinks[0].waiver.email;
  const waiver = run.pool.state.documents.find(row => row.classification === 'lien-waiver');
  assert.equal(typeof queuedEmail.body, 'string');
  assert.equal(contexts[0].forceClassification, null);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id, waiver.id);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).waiver_link_source, 'body-token');
  assert.equal(queuedEmail.internetMessageId, email.internetMessageId);
  assert.deepEqual(queuedEmail.internetMessageHeaders, email.internetMessageHeaders);
});

test('TC-34 tier-zero auto-link uses queued message ID and parsed headers independently of body-token', async () => {
  const target = targetInvoice('doc-core-tz34');
  const email = { ...replyEmail('RE: Edited invoice reply', { body: 'No reference token in this body.' }),
    conversationId: null, internetMessageId: '<tier-zero-inbound@example.test>',
    internetMessageHeaders: [{ name: 'In-Reply-To', value: '<outbound-invoice@example.test>' }] };
  const run = await runOnePdf({ targets: [target], referenceRows: [target], conversations: [], email,
    classify: () => ({ classification: 'lien-waiver', pageClassifications: ['lien-waiver'] }) });
  const queuedEmail = run.autoLinks[0].waiver.email;
  const tierZero = run.pool.state.calls.find(call => /FROM document_email_messages m\s+JOIN documents d[\s\S]*m\.internet_message_id = ANY\(\$1\)[\s\S]*ORDER BY d\.queued_at DESC/.test(call.sql));
  assert.ok(tierZero, `auto-link should query tier-zero message identity correlation: ${JSON.stringify(run.pool.state.calls.map(call => call.sql.slice(0, 110)))}`);
  assert.equal(queuedEmail.internetMessageId, email.internetMessageId);
  assert.deepEqual(queuedEmail.internetMessageHeaders, email.internetMessageHeaders);
  assert.ok(tierZero.params[0].includes('<tier-zero-inbound@example.test>'), JSON.stringify(tierZero.params[0]));
  assert.ok(tierZero.params[0].includes('<outbound-invoice@example.test>'), JSON.stringify(tierZero.params[0]));
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).linked_lien_waiver_id,
    run.pool.state.documents.find(row => row.classification === 'lien-waiver').id);
  assert.equal(run.pool.state.documents.find(row => row.id === target.id).waiver_link_source, 'email-reference');
});
