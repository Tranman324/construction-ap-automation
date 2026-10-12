'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const childProcess = require('node:child_process');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const fixtures = require('../fixtures/invoices/per-type-extraction.json');
const {
  attachExtractedPayloadToQueueEntry,
  buildExtractionPromptForClassification,
  findJobRefInText,
  isExtractionEnabledForClassification,
  normalizeExtractedFieldsForClassification,
  shouldUseCombinedSinglePageInvoiceExtraction,
} = require('../../modules/invoices/services/pipeline');

const root = path.resolve(__dirname, '..', '..');

function resolved(relativePath) {
  return require.resolve(path.join(root, relativePath));
}

async function withClassifyAndExtractDependencies({ callHaiku, execSync = null }, fn) {
  const pipelinePath = resolved('modules/invoices/services/pipeline.js');
  const waiverDetectionPath = resolved('modules/invoices/services/waiverDetection.js');
  const moduleMocks = new Map([
    [resolved('lib/db.js'), { query: async () => ({ rows: [] }) }],
    [resolved('modules/invoices/services/vision.js'), { callHaiku }],
    [resolved('modules/invoices/services/ocr.js'), {
      collectImageText: () => ({ text: '', ocrApplied: false }),
      collectPdfText: () => ({ text: '', ocrApplied: false }),
    }],
  ]);
  const previous = new Map();
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'child_process' && execSync) return { ...childProcess, execSync };
    return originalLoad.call(this, request, parent, isMain);
  };
  for (const modulePath of [...moduleMocks.keys(), pipelinePath, waiverDetectionPath]) {
    previous.set(modulePath, require.cache[modulePath]);
    delete require.cache[modulePath];
  }
  for (const [modulePath, exports] of moduleMocks) {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  try {
    return await fn(require('../../modules/invoices/services/pipeline'));
  } finally {
    Module._load = originalLoad;
    for (const modulePath of [...moduleMocks.keys(), pipelinePath, waiverDetectionPath]) {
      if (previous.get(modulePath)) require.cache[modulePath] = previous.get(modulePath);
      else delete require.cache[modulePath];
    }
  }
}

function normalizeFixture(name) {
  const fixture = fixtures[name];
  return normalizeExtractedFieldsForClassification(
    fixture.classification,
    fixture.raw,
    fixture.context || {}
  );
}

test('per-type extraction gate includes requested document classes only', () => {
  for (const classification of ['invoice', 'receipt', 'credit-memo', 'building-permit', 'other', 'coi', 'statement', 'lien-waiver']) {
    assert.equal(isExtractionEnabledForClassification(classification), true, `${classification} should extract`);
  }

  assert.equal(isExtractionEnabledForClassification('w9'), false);
});

test('prompt builders keep non-invoice fields in separate prompts', () => {
  const invoicePrompt = buildExtractionPromptForClassification('invoice');
  const receiptPrompt = buildExtractionPromptForClassification('receipt');
  const permitPrompt = buildExtractionPromptForClassification('building-permit');
  const coiPrompt = buildExtractionPromptForClassification('coi');
  const statementPrompt = buildExtractionPromptForClassification('statement');
  const lienWaiverPrompt = buildExtractionPromptForClassification('lien-waiver');

  assert.match(invoicePrompt, /Extract invoice\/billing data/);
  assert.doesNotMatch(invoicePrompt, /insuredName/);
  assert.doesNotMatch(invoicePrompt, /statementPeriod/);
  assert.match(receiptPrompt, /extracted\.jobRef/);
  assert.match(permitPrompt, /projectName/);
  assert.match(permitPrompt, /projectAddress/);
  assert.match(coiPrompt, /insuredName/);
  assert.match(coiPrompt, /expirationDate/);
  assert.match(statementPrompt, /Vendor must come from document content only/);
  assert.match(statementPrompt, /Never use the email sender/);
  assert.match(lienWaiverPrompt, /Extract lien waiver data/);
  assert.match(lienWaiverPrompt, /invoiceNumber/);
  assert.match(lienWaiverPrompt, /jobNumber/);
});

test('single-page documents keep the combined invoice extraction attempt first', () => {
  assert.equal(shouldUseCombinedSinglePageInvoiceExtraction(1, null), true);
  assert.equal(shouldUseCombinedSinglePageInvoiceExtraction(1, 'coi'), false);
  assert.equal(shouldUseCombinedSinglePageInvoiceExtraction(2, null), false);

  const invoicePrompt = buildExtractionPromptForClassification('invoice');
  assert.match(invoicePrompt, /Extract invoice\/billing data/);
  assert.match(invoicePrompt, /"classification": "invoice"/);
  assert.match(invoicePrompt, /invoiceNumber/);
});

test('single-page statement classification reruns the statement prompt even when the combined invoice attempt returns extracted data', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-statement-extraction-'));
  const filePath = path.join(tempDir, 'attachment.png');
  fs.writeFileSync(filePath, Buffer.alloc(16_000, 1));
  const prompts = [];

  try {
    await withClassifyAndExtractDependencies({
      callHaiku: async (_images, prompt) => {
        prompts.push(prompt);
        const response = prompts.length === 1
          ? {
            classification: 'statement',
            confidence: 0.98,
            extracted: { vendorName: 'Generic invoice attempt', lineItems: [] },
          }
          : {
            classification: 'statement',
            confidence: 0.98,
            extracted: {
              vendor: 'Statement Vendor',
              balance: 42.5,
              lines: [{ invoiceNumber: 'ST-100', date: '2026-08-01', amount: 42.5 }],
            },
          };
        return { text: JSON.stringify(response), usage: { input_tokens: 1, output_tokens: 1 } };
      },
    }, async ({ classifyAndExtract }) => {
      const result = await classifyAndExtract(filePath);
      assert.equal(result.classification, 'statement');
      assert.equal(result.extracted.vendor, 'Statement Vendor');
      assert.deepEqual(result.extracted.statementLines, [{
        id: 'ST-100', invoiceNumber: 'ST-100', date: '2026-08-01', amount: 42.5, status: 'not_received', source: 'extracted',
      }]);
    });

    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /Extract invoice\/billing data/);
    assert.match(prompts[1], /Extract statement data/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('single-page lien waiver classification reruns the lien-waiver prompt before persisting extracted fields', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-lien-waiver-extraction-'));
  const filePath = path.join(tempDir, 'attachment.png');
  fs.writeFileSync(filePath, Buffer.alloc(16_000, 1));
  const prompts = [];

  try {
    await withClassifyAndExtractDependencies({
      callHaiku: async (_images, prompt) => {
        prompts.push(prompt);
        const response = prompts.length === 1
          ? {
            classification: 'lien-waiver', confidence: 0.98,
            extracted: { vendorName: 'Generic invoice attempt', lineItems: [] },
          }
          : {
            classification: 'lien-waiver', confidence: 0.98,
            extracted: {
              claimantName: 'Summit Steel LLC', amountReleased: '$4,275.50',
              invoiceReference: 'INV-900', projectNumber: '26-434',
            },
          };
        return { text: JSON.stringify(response), usage: { input_tokens: 1, output_tokens: 1 } };
      },
    }, async ({ classifyAndExtract }) => {
      const result = await classifyAndExtract(filePath);
      assert.equal(result.classification, 'lien-waiver');
      assert.deepEqual(result.extracted, fixtures.lienWaiver.expected);
    });

    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /Extract invoice\/billing data/);
    assert.match(prompts[1], /Extract lien waiver data/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('multi-page other-plus-waiver classification selects lien-waiver extraction', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-multipage-lien-waiver-'));
  const filePath = path.join(tempDir, 'attachment.pdf');
  fs.writeFileSync(filePath, Buffer.alloc(16_000, 1));
  const prompts = [];

  try {
    await withClassifyAndExtractDependencies({
      execSync: (command) => {
        if (command.includes('identify ')) return Buffer.from('2\n');
        const outputPath = command.match(/"([^"\n]+\.png)"\s*$/)?.[1];
        if (outputPath) fs.writeFileSync(outputPath, Buffer.alloc(16_000, 1));
        return Buffer.alloc(0);
      },
      callHaiku: async (_images, prompt) => {
        prompts.push(prompt);
        const response = prompts.length === 1
          ? { classification: 'other', confidence: 0.9 }
          : prompts.length === 2
            ? { classification: 'lien-waiver', confidence: 0.98 }
            : {
              classification: 'lien-waiver', confidence: 0.98,
              extracted: {
                claimantName: 'Summit Steel LLC', amountReleased: '$4,275.50',
                invoiceReference: 'INV-900', projectNumber: '26-434',
              },
            };
        return { text: JSON.stringify(response), usage: { input_tokens: 1, output_tokens: 1 } };
      },
    }, async ({ classifyAndExtract }) => {
      const result = await classifyAndExtract(filePath);
      assert.equal(result.classification, 'lien-waiver');
      assert.deepEqual(result.extracted, fixtures.lienWaiver.expected);
      assert.deepEqual(result.pageClassifications, ['other', 'lien-waiver']);
    });

    assert.equal(prompts.length, 3);
    assert.match(prompts[2], /Extract lien waiver data/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('multi-page invoice-plus-waiver classification retains invoice priority', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-multipage-invoice-waiver-'));
  const filePath = path.join(tempDir, 'attachment.pdf');
  fs.writeFileSync(filePath, Buffer.alloc(16_000, 1));
  const prompts = [];

  try {
    await withClassifyAndExtractDependencies({
      execSync: (command) => {
        if (command.includes('identify ')) return Buffer.from('2\n');
        const outputPath = command.match(/"([^"\n]+\.png)"\s*$/)?.[1];
        if (outputPath) fs.writeFileSync(outputPath, Buffer.alloc(16_000, 1));
        return Buffer.alloc(0);
      },
      callHaiku: async (_images, prompt) => {
        prompts.push(prompt);
        const response = prompts.length === 1
          ? { classification: 'invoice', confidence: 0.98 }
          : prompts.length === 2
            ? { classification: 'lien-waiver', confidence: 0.98 }
            : {
              classification: 'invoice', confidence: 0.98,
              extracted: { vendorName: 'Summit Steel LLC', invoiceNumber: 'INV-900', amount: 4275.5, lineItems: [] },
            };
        return { text: JSON.stringify(response), usage: { input_tokens: 1, output_tokens: 1 } };
      },
    }, async ({ classifyAndExtract }) => {
      const result = await classifyAndExtract(filePath);
      assert.equal(result.classification, 'invoice');
      assert.equal(result.extracted.invoiceNumber, 'INV-900');
      assert.deepEqual(result.pageClassifications, ['invoice', 'lien-waiver']);
    });

    assert.equal(prompts.length, 3);
    assert.match(prompts[2], /Extract invoice\/billing data/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── Details unreadable after the type is decided: keep the type ──
const DETAILS_UNREADABLE_NOTE = 'Details could not be read automatically - review and enter details';
const waiverA = { classification: 'lien-waiver', confidence: 0.98, extracted: { claimantName: 'Northwind Drywall', amountReleased: '$12,000.00', invoiceReference: 'CD-101', projectNumber: '26-434' } };
const waiverB = { classification: 'lien-waiver', confidence: 0.98, extracted: { claimantName: 'Northwind Drywall', amountReleased: '$8,500.00', invoiceReference: 'CD-102', projectNumber: '26-441' } };

// Two-page waiver PDF; both pages classify lien-waiver, then `extractionReply`
// (a string, or a function that throws) answers the details-extraction call.
async function classifyTwoPageWaiver(extractionReply) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-waiver-keep-type-'));
  const filePath = path.join(tempDir, 'September Northwind Waivers.pdf');
  fs.writeFileSync(filePath, Buffer.alloc(16_000, 1));
  let calls = 0;
  try {
    return await withClassifyAndExtractDependencies({
      execSync: (command) => {
        if (command.includes('identify ')) return Buffer.from('2\n');
        const outputPath = command.match(/"([^"\n]+\.png)"\s*$/)?.[1];
        if (outputPath) fs.writeFileSync(outputPath, Buffer.alloc(16_000, 1));
        return Buffer.alloc(0);
      },
      callHaiku: async () => {
        calls++;
        if (calls <= 2) return { text: JSON.stringify({ classification: 'lien-waiver', confidence: 0.97 }), usage: { input_tokens: 10, output_tokens: 2 } };
        if (typeof extractionReply === 'function') return extractionReply();
        return { text: extractionReply, usage: { input_tokens: 100, output_tokens: 50 } };
      },
    }, ({ classifyAndExtract }) => classifyAndExtract(filePath));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertKeptTypeWithoutDetails(result) {
  assert.equal(result.classification, 'lien-waiver');
  assert.equal(result.extracted, null);
  assert.equal(result.notes, DETAILS_UNREADABLE_NOTE);
  assert.equal(result.stage, undefined);
  assert.deepEqual(result.pageClassifications, ['lien-waiver', 'lien-waiver']);
  assert.deepEqual(result.tokensUsed, { input: 120, output: 54 });
}

test('multi-waiver reply (JSON array of 2 waivers) keeps lien-waiver with blank details and a review note', async () => {
  const result = await classifyTwoPageWaiver(JSON.stringify([waiverA, waiverB], null, 2));
  assertKeptTypeWithoutDetails(result);
});

test('prose-wrapped waiver array and a truncated waiver array also keep lien-waiver with blank details', async () => {
  const prose = `This PDF contains two lien waivers:\n${JSON.stringify([waiverA, waiverB], null, 2)}\nLet me know if you need more.`;
  assertKeptTypeWithoutDetails(await classifyTwoPageWaiver(prose));
  // Max-token cutoff mid-way through a longer array (here inside record 3).
  const waiverC = { ...waiverB, extracted: { ...waiverB.extracted, invoiceReference: 'CD-103' } };
  const full = JSON.stringify([waiverA, waiverB, waiverC], null, 2);
  const truncated = full.slice(0, full.lastIndexOf('CD-103'));
  assertKeptTypeWithoutDetails(await classifyTwoPageWaiver(truncated));
});

test('a single waiver object still extracts details unchanged', async () => {
  const result = await classifyTwoPageWaiver(JSON.stringify(waiverA));
  assert.equal(result.classification, 'lien-waiver');
  assert.equal(result.notes, undefined);
  assert.equal(result.extracted.vendorName, 'Northwind Drywall');
  assert.equal(result.extracted.invoiceNumber, 'CD-101');
  assert.equal(result.extracted.jobNumber, '26-434');
});

test('a Haiku API failure on the details call is still an error at stage haiku-api', async () => {
  const result = await classifyTwoPageWaiver(() => { throw new Error('overloaded_error'); });
  assert.equal(result.classification, 'error');
  assert.equal(result.stage, 'haiku-api');
  assert.match(result.reason, /Haiku API: overloaded_error/);
  assert.equal(result.notes, undefined);
});

test('building permit extraction normalizes project fields', () => {
  assert.deepEqual(normalizeFixture('buildingPermit'), fixtures.buildingPermit.expected);
});

test('other project document extraction normalizes project fields', () => {
  assert.deepEqual(normalizeFixture('otherProjectDocument'), fixtures.otherProjectDocument.expected);
});

test('receipt extraction preserves existing fields and adds jobRef from PO or subject text', () => {
  assert.deepEqual(normalizeFixture('receipt'), fixtures.receipt.expected);
});

test('receipt jobRef survives in the queued extracted payload', () => {
  const extracted = normalizeFixture('receipt');
  const queueEntry = attachExtractedPayloadToQueueEntry(
    { classification: 'receipt' },
    { classification: 'receipt', extracted }
  );

  assert.equal(queueEntry.extracted.jobRef, '26-434');
});

test('receipt jobRef finder captures service and standard job references', () => {
  assert.equal(findJobRefInText('PO 26-434'), '26-434');
  assert.equal(findJobRefInText('service ticket 25-SVC403'), '25-SVC403');
});

test('COI extraction normalizes insured and expiration fields', () => {
  assert.deepEqual(normalizeFixture('coi'), fixtures.coi.expected);
});

test('COI limits marked "Included" inherit the occurrence-level limit', () => {
  const normalized = normalizeExtractedFieldsForClassification('coi', {
    insuredName: 'Steadfast Engineering, LLC',
    coverageLines: [
      {
        type: 'general-liability',
        policyNumber: 'PSB0005638',
        limits: { eachOccurrence: 2000000, generalAggregate: 4000000, personalAdvInjury: 'Included' },
      },
      {
        type: 'automobile',
        policyNumber: 'PSA0002086',
        limits: { combinedSingleLimit: 1000000, bodilyInjury: 'Incl.' },
      },
    ],
  });

  const [gl, auto] = normalized._coiData.coverageLines;
  assert.equal(gl.limits.personalAdvInjury, 2000000);
  assert.deepEqual(gl.includedLimits, ['personalAdvInjury']);
  assert.equal(auto.limits.bodilyInjury, 1000000);
  assert.deepEqual(auto.includedLimits, ['bodilyInjury']);
});

test('COI "Included" limits without an occurrence-level limit stay absent', () => {
  const normalized = normalizeExtractedFieldsForClassification('coi', {
    insuredName: 'Example Sub, LLC',
    coverageLines: [
      { type: 'general-liability', limits: { generalAggregate: 4000000, personalAdvInjury: 'Included' } },
    ],
  });

  const [gl] = normalized._coiData.coverageLines;
  assert.equal('personalAdvInjury' in gl.limits, false);
  assert.equal('includedLimits' in gl, false);
});

test('statement extraction normalizes document vendor, period, and balance', () => {
  assert.deepEqual(normalizeFixture('statement'), fixtures.statement.expected);
});

test('statement extraction never falls back to email sender for vendor', () => {
  assert.deepEqual(
    normalizeFixture('statementWithoutDocumentVendor'),
    fixtures.statementWithoutDocumentVendor.expected
  );
});

test('lien waiver extraction normalizes vendor, amount, invoice reference, and job', () => {
  assert.deepEqual(normalizeFixture('lienWaiver'), fixtures.lienWaiver.expected);
});

test('non-invoice extracted fields are carried into the queued payload', () => {
  for (const fixtureName of ['buildingPermit', 'coi', 'statement', 'lienWaiver']) {
    const fixture = fixtures[fixtureName];
    const extracted = normalizeFixture(fixtureName);
    const queueEntry = attachExtractedPayloadToQueueEntry(
      { classification: fixture.classification },
      { classification: fixture.classification, extracted }
    );

    assert.deepEqual(queueEntry.extracted, fixture.expected, `${fixture.classification} extracted payload should be kept`);
  }
});

test('warranty uses light project extraction and preserves document-visible title fields', () => {
  const extracted = normalizeExtractedFieldsForClassification('warranty', {
    project: 'Brightwater North',
    siteAddress: '100 Main Street',
    heading: 'Roofing Warranty Certificate',
  });

  assert.deepEqual(extracted, {
    projectName: 'Brightwater North',
    projectAddress: '100 Main Street',
    docTitle: 'Roofing Warranty Certificate',
  });
});

test('invoice extraction post-processing remains unchanged', () => {
  const { classification, raw } = fixtures.invoiceRegression;
  assert.deepEqual(
    normalizeExtractedFieldsForClassification(classification, raw, {
      emailSubject: 'Receipt 26-434',
      supplementalText: 'PO 26-434',
    }),
    raw
  );
});

test('credit memo extraction post-processing remains unchanged', () => {
  const { classification, raw } = fixtures.creditMemoRegression;
  assert.deepEqual(
    normalizeExtractedFieldsForClassification(classification, raw, {
      emailSubject: 'Credit 26-434',
      supplementalText: 'PO 26-434',
    }),
    raw
  );
});
