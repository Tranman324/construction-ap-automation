#!/usr/bin/env node
/**
 * Invoice Pipeline — Regression Test Runner
 * Tests classification + extraction against known sample PDFs.
 * 
 * Usage: ANTHROPIC_API_KEY=... node tests/run-tests.js [--file moreno*]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load API key from .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.+)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const SAMPLES_DIR = path.join(__dirname, 'samples');
const EXPECTED_PATH = path.join(__dirname, 'expected.json');
const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));

const fileFilter = process.argv.find(a => a.startsWith('--file='))?.split('=')[1];

// Classification priority (same as pipeline)
const CLASSIFICATION_PRIORITY = ['invoice', 'receipt', 'pay-application', 'credit-memo'];

async function classifyPage(apiKey, imageData) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
        { type: 'text', text: 'Classify this SINGLE PAGE as one of: invoice, receipt, pay-application, credit-memo, statement, coi, w9, lien-waiver, contract, change-order, purchase-order, image, other\nA billing recap or payment summary IS an invoice.\nReturn ONLY JSON: {"classification": "type", "confidence": 0.95}' },
      ]}],
    }),
  });
  const result = await resp.json();
  const text = result.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*?\}/);
  return match ? JSON.parse(match[0]) : { classification: 'error' };
}

async function extractInvoice(apiKey, imageDataList, classification) {
  const prompt = `Extract invoice/billing data from this document. Return ONLY valid JSON:
{
  "classification": "${classification}",
  "confidence": 0.95,
  "extracted": {
    "vendorName": "string", "vendorAddress": "string or null",
    "invoiceNumber": "string or null", "invoiceDate": "YYYY-MM-DD or null",
    "dueDate": "YYYY-MM-DD or null", "amount": 0.00,
    "jobNumber": "string or null", "projectName": "string or null",
    "projectAddress": "string or null", "description": "string",
    "lineItems": [{"description":"","amount":0,"jobRef":"","subcontractRef":""}]
  }
}
Extract from INVOICE/BILLING pages only. Ignore lien waivers. Use null for missing fields. Amounts as numbers.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: [
        ...imageDataList.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })),
        { type: 'text', text: imageDataList.length > 1 ? `${imageDataList.length}-page document.\n\n${prompt}` : prompt },
      ]}],
    }),
  });
  const result = await resp.json();
  const text = result.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

async function testFile(testCase) {
  const filePath = path.join(SAMPLES_DIR, testCase.file);
  if (!fs.existsSync(filePath)) {
    return { file: testCase.file, status: 'SKIP', reason: 'file not found' };
  }

  const ext = path.extname(filePath).toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Convert PDF to images
  let imagePaths = [];
  if (ext === '.pdf') {
    for (let p = 0; p < 5; p++) {
      const img = `/tmp/test_${Date.now()}_p${p}.png`;
      try {
        execSync(`convert -density 200 "${filePath}"[${p}] -quality 95 "${img}" 2>/dev/null`, { timeout: 30000 });
        imagePaths.push(img);
      } catch { break; }
    }
  } else {
    imagePaths = [filePath];
  }

  const imageDataList = imagePaths.map(p => fs.readFileSync(p).toString('base64'));

  // Per-page classification for multi-page
  let pageClasses = [];
  let winningClass = null;

  if (imagePaths.length > 1) {
    for (let p = 0; p < imageDataList.length; p++) {
      const pc = await classifyPage(apiKey, imageDataList[p]);
      pageClasses.push(pc.classification);
    }
    for (const pri of CLASSIFICATION_PRIORITY) {
      if (pageClasses.includes(pri)) { winningClass = pri; break; }
    }
    if (!winningClass) {
      const counts = {};
      pageClasses.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
      winningClass = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  // Extract if extractable type (or single page)
  let result;
  if (imagePaths.length === 1 || CLASSIFICATION_PRIORITY.includes(winningClass)) {
    result = await extractInvoice(apiKey, imageDataList, winningClass || 'invoice');
    if (imagePaths.length === 1 && result) {
      winningClass = result.classification;
    }
  } else {
    result = { classification: winningClass, extracted: null };
  }

  if (winningClass && result) result.classification = winningClass;

  // Normalize classification (underscores → hyphens, trim whitespace)
  if (result?.classification) {
    result.classification = result.classification.replace(/_/g, '-').trim().toLowerCase();
  }

  // Cleanup temp files
  imagePaths.forEach(p => { if (p.startsWith('/tmp/')) try { fs.unlinkSync(p); } catch {} });

  // Validate against expected
  const exp = testCase.expected;
  const failures = [];

  if (exp.classification && result.classification !== exp.classification) {
    failures.push(`classification: expected "${exp.classification}", got "${result.classification}"`);
  }
  if (exp.classificationOneOf && !exp.classificationOneOf.includes(result.classification)) {
    failures.push(`classification: expected one of [${exp.classificationOneOf.join(', ')}], got "${result.classification}"`);
  }
  if (exp.vendorName && result.extracted) {
    if (!result.extracted.vendorName?.toLowerCase().includes(exp.vendorName.toLowerCase())) {
      failures.push(`vendorName: expected to contain "${exp.vendorName}", got "${result.extracted?.vendorName}"`);
    }
  }
  if (exp.hasAmount && (!result.extracted || !result.extracted.amount)) {
    failures.push(`hasAmount: expected amount but got ${result.extracted?.amount}`);
  }
  if (exp.hasInvoiceNumber && (!result.extracted || !result.extracted.invoiceNumber)) {
    failures.push(`hasInvoiceNumber: expected invoice number but got ${result.extracted?.invoiceNumber}`);
  }
  if (exp.hasLineItems && (!result.extracted?.lineItems || result.extracted.lineItems.length === 0)) {
    failures.push(`hasLineItems: expected line items but got ${result.extracted?.lineItems?.length || 0}`);
  }
  if (exp.minLineItems && (result.extracted?.lineItems?.length || 0) < exp.minLineItems) {
    failures.push(`minLineItems: expected ≥${exp.minLineItems}, got ${result.extracted?.lineItems?.length || 0}`);
  }

  return {
    file: testCase.file,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    classification: result.classification,
    pageClasses: pageClasses.length > 0 ? pageClasses : undefined,
    amount: result.extracted?.amount,
    invoiceNumber: result.extracted?.invoiceNumber,
    vendorName: result.extracted?.vendorName,
    failures: failures.length > 0 ? failures : undefined,
  };
}

async function main() {
  const tests = fileFilter ? expected.filter(t => t.file.includes(fileFilter)) : expected;
  console.log(`\n🧪 Invoice Pipeline Regression Tests`);
  console.log(`   Running ${tests.length} test(s)...\n`);

  let passed = 0, failed = 0, skipped = 0;

  for (const testCase of tests) {
    const result = await testFile(testCase);
    const icon = result.status === 'PASS' ? '✅' : result.status === 'SKIP' ? '⏭️' : '❌';
    console.log(`${icon} ${result.file}`);
    if (result.pageClasses) console.log(`   Pages: ${result.pageClasses.join(', ')}`);
    console.log(`   Class: ${result.classification}  |  Vendor: ${result.vendorName || 'n/a'}  |  Amount: ${result.amount || 'n/a'}  |  Inv#: ${result.invoiceNumber || 'n/a'}`);
    if (result.failures) {
      result.failures.forEach(f => console.log(`   ⚠️  ${f}`));
    }
    console.log();

    if (result.status === 'PASS') passed++;
    else if (result.status === 'FAIL') failed++;
    else skipped++;
  }

  console.log(`\n────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`────────────────────────────────\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
