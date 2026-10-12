'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const root = path.resolve(__dirname, '..', '..');

function resolved(relativePath) {
  return require.resolve(path.join(root, relativePath));
}

function snapshotCache(paths) {
  return new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
}

function restoreCache(snapshot) {
  for (const [modulePath, cached] of snapshot.entries()) {
    if (cached) {
      require.cache[modulePath] = cached;
    } else {
      delete require.cache[modulePath];
    }
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function withSyntheticMatcherData({ jobs = [], vendors = [], subcontracts = [] }, fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-per-type-matching-'));
  writeJSON(path.join(tempDir, 'spectrum_jobs_rest.json'), jobs);
  writeJSON(path.join(tempDir, 'spectrum_vendors.json'), vendors);
  writeJSON(path.join(tempDir, 'spectrum_subcontracts.json'), subcontracts);
  writeJSON(path.join(tempDir, 'vendor-cache.json'), { domains: {}, names: {} });
  writeJSON(path.join(tempDir, 'subcontract-cache.json'), {});

  const modulePaths = [
    resolved('config.js'),
    resolved('lib/db.js'),
    resolved('modules/invoices/services/matcher.js'),
    resolved('modules/invoices/services/pipeline.js'),
  ];
  const cache = snapshotCache(modulePaths);
  const oldDataDir = process.env.INVOICES_DATA_DIR;

  process.env.INVOICES_DATA_DIR = tempDir;
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  require.cache[resolved('lib/db.js')] = {
    id: resolved('lib/db.js'),
    filename: resolved('lib/db.js'),
    loaded: true,
    exports: {
      async query() {
        throw new Error('unit test DB boundary');
      },
    },
  };

  try {
    return await fn(require('../../modules/invoices/services/pipeline'));
  } finally {
    if (oldDataDir === undefined) {
      delete process.env.INVOICES_DATA_DIR;
    } else {
      process.env.INVOICES_DATA_DIR = oldDataDir;
    }
    restoreCache(cache);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function withPipelinePool(pool, fn) {
  const modulePaths = [
    resolved('lib/db.js'),
    resolved('modules/invoices/services/pipeline.js'),
  ];
  const cache = snapshotCache(modulePaths);
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  require.cache[resolved('lib/db.js')] = {
    id: resolved('lib/db.js'),
    filename: resolved('lib/db.js'),
    loaded: true,
    exports: pool,
  };

  try {
    return await fn(require('../../modules/invoices/services/pipeline'));
  } finally {
    restoreCache(cache);
  }
}

function loadRowToDocWithMockPool() {
  // jobDescription serialization reads the Spectrum jobs file through
  // config.JOBS_PATH; point it at synthetic data so the assertion is
  // deterministic instead of depending on server-local job exports.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-row-to-doc-'));
  writeJSON(path.join(tempDir, 'spectrum_jobs_rest.json'), syntheticJobs);
  const modulePaths = [
    resolved('config.js'),
    resolved('lib/db.js'),
    resolved('modules/invoices/services/matching.js'),
    resolved('modules/invoices/services/supabase.js'),
  ];
  const cache = snapshotCache(modulePaths);
  const oldDataDir = process.env.INVOICES_DATA_DIR;
  process.env.INVOICES_DATA_DIR = tempDir;
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  require.cache[resolved('lib/db.js')] = {
    id: resolved('lib/db.js'),
    filename: resolved('lib/db.js'),
    loaded: true,
    exports: { query() {} },
  };

  const { rowToDoc } = require('../../modules/invoices/services/supabase');
  return {
    rowToDoc,
    cleanup() {
      if (oldDataDir === undefined) delete process.env.INVOICES_DATA_DIR;
      else process.env.INVOICES_DATA_DIR = oldDataDir;
      restoreCache(cache);
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

const syntheticJobs = [
  {
    Job_Number: '26-434',
    Job_Description: 'North Clinic Expansion',
    Address_1: '42 Clinic Drive',
    City: 'Birmingham',
    State: 'AL',
  },
  {
    Job_Number: '26-101',
    Job_Description: 'Harbor View Tower Renovation',
    Address_1: '100 River Road',
    City: 'Mobile',
    State: 'AL',
  },
];

const syntheticVendors = [
  { Vendor_Code: 'SUM01', Name: 'Summit Steel LLC' },
  { Vendor_Code: 'LARK01', Name: 'Lark Safety' },
  { Vendor_Code: 'SEND01', Name: 'Sender Only LLC', Email: 'ap@sender-only.test' },
  { Vendor_Code: 'ABDS01', Name: 'ABD Suppliers' },
];

test('receipt jobRef feeds existing invoice job matching', async () => {
  await withSyntheticMatcherData({ jobs: syntheticJobs, vendors: syntheticVendors }, async (pipeline) => {
    const matching = await pipeline.matchInvoiceData(
      {
        vendorName: null,
        amount: 128.44,
        jobRef: '26-434',
        description: 'Paint and jobsite supplies',
        lineItems: [],
      },
      '',
      'Receipt for job 26-434'
    );

    assert.equal(matching.job.jobNumber, '26-434');
    assert.equal(matching.job.method, 'extracted-verified');
    assert.equal(matching.job.confidence, 0.95);
  });
});

test('permit project address and name use existing fuzzy job matcher', async () => {
  await withSyntheticMatcherData({ jobs: syntheticJobs, vendors: syntheticVendors }, async (pipeline) => {
    const matching = await pipeline.matchPerTypeDocumentData('building-permit', {
      projectName: 'Harbor View Tower Renovation',
      projectAddress: '100 River Road, Mobile, AL',
    });

    assert.equal(matching.job.jobNumber, '26-101');
    assert.equal(matching.job.method, 'address-match');
    assert.equal(matching.job.confidence, 0.97);
    assert.equal(matching.overallConfidence, 0.97);
  });
});

test('COI insured name uses existing vendor matcher', async () => {
  await withSyntheticMatcherData({ jobs: syntheticJobs, vendors: syntheticVendors }, async (pipeline) => {
    const matching = await pipeline.matchPerTypeDocumentData('coi', {
      insuredName: 'Summit Steel LLC',
      expirationDate: '2026-12-31',
    });

    assert.equal(matching.vendor.vendorCode, 'SUM01');
    assert.equal(matching.vendor.vendorName, 'Summit Steel LLC');
    assert.equal(matching.vendor.confidence, 1);
    assert.equal(matching.vendor.method, 'fuzzy-high');
  });
});

test('statement vendor matching uses document vendor and ignores sender email', async () => {
  await withSyntheticMatcherData({ jobs: syntheticJobs, vendors: syntheticVendors }, async (pipeline) => {
    const matching = await pipeline.matchPerTypeDocumentData(
      'statement',
      {
        vendor: 'Lark Safety',
        statementPeriod: 'June 2026',
        balance: 1234.56,
      },
      { emailFrom: 'ap@sender-only.test' }
    );

    assert.equal(matching.vendor.vendorCode, 'LARK01');
    assert.equal(matching.vendor.vendorName, 'Lark Safety');
  });
});

test('lien waiver matching resolves the extracted vendor and job without a link mutation path', async () => {
  const matcherCalls = [];
  const matching = await withSyntheticMatcherData({ jobs: syntheticJobs, vendors: syntheticVendors }, async (pipeline) => pipeline.matchPerTypeDocumentData(
    'lien-waiver',
    {
      vendorName: 'Summit Steel LLC',
      amount: 4275.5,
      invoiceNumber: 'INV-900',
      jobNumber: '26-434',
    },
    { emailSubject: 'Lien waiver for 26-434' },
    {
      matchVendor: async (input) => {
        matcherCalls.push(['vendor', input]);
        return { vendorCode: 'SUM01', vendorName: 'Summit Steel LLC', confidence: 1, method: 'fuzzy-high' };
      },
      resolveJobNumber: async (input, vendorCode) => {
        matcherCalls.push(['job', input, vendorCode]);
        return { jobNumber: '26-434', confidence: 0.95, method: 'extracted-verified' };
      },
    }
  ));

  assert.deepEqual(matching.vendor, {
    vendorCode: 'SUM01', vendorName: 'Summit Steel LLC', confidence: 1, method: 'fuzzy-high',
  });
  assert.deepEqual(matching.job, {
    jobNumber: '26-434', confidence: 0.95, method: 'extracted-verified',
  });
  assert.deepEqual(matcherCalls, [
    ['vendor', { name: 'Summit Steel LLC', email: null, address: null }],
    ['job', {
      jobNumber: '26-434', projectAddress: null, projectName: null,
      emailSubject: 'Lien waiver for 26-434', description: null,
    }, 'SUM01'],
  ]);
});

test('vendor low-confidence results remain suggestion-only and no-match stays unmatched', async () => {
  await withSyntheticMatcherData({ jobs: syntheticJobs, vendors: syntheticVendors }, async (pipeline) => {
    const suggestion = await pipeline.matchPerTypeDocumentData('statement', {
      vendor: 'ABC Supply',
      statementPeriod: 'June 2026',
      balance: 10,
    });
    assert.equal(suggestion.vendor.vendorCode, null);
    assert.equal(suggestion.vendor.vendorName, 'ABD Suppliers');
    assert.equal(suggestion.vendor.confidence, 0.84);
    assert.equal(suggestion.vendor.method, 'fuzzy-low-suggestion');
    assert.deepEqual(suggestion.vendor.suggestion, {
      vendorCode: 'ABDS01',
      vendorName: 'ABD Suppliers',
      score: 0.84,
    });

    const noMatch = await pipeline.matchPerTypeDocumentData('coi', {
      insuredName: 'Zzz Irrelevant Company',
      expirationDate: '2026-12-31',
    });
    assert.equal(noMatch.vendor.vendorCode, null);
    assert.equal(noMatch.vendor.vendorName, null);
    assert.equal(noMatch.vendor.confidence, 0);
    assert.equal(noMatch.vendor.method, 'no-match');
  });
});

test('insertDocument persists per-type match fields on established document columns', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: /INSERT INTO audit_events/.test(sql) ? [{ id: params[0] }] : [] };
    },
  };

  await withPipelinePool(pool, async (pipeline) => {
    await pipeline.insertDocument({
      id: 'doc-match-1',
      classification: 'statement',
      confidence: 0.95,
      file: 'statement.pdf',
      email: {
        messageId: 'msg-1',
        from: 'sender@example.test',
        subject: 'Statement',
        receivedAt: '2026-07-02T12:00:00Z',
      },
      extracted: {
        lineItems: [],
      },
      matching: {
        vendor: {
          vendorCode: 'LARK01',
          vendorName: 'Lark Safety',
          confidence: 1,
          method: 'fuzzy-high',
        },
        job: {
          jobNumber: '26-434',
          confidence: 0.95,
          method: 'extracted-verified',
        },
        overallConfidence: 0.95,
      },
      queuedAt: '2026-07-02T12:00:00Z',
    });
  });

  const insertCall = calls.find(c => /INSERT INTO documents/.test(c.sql));
  const auditCall = calls.find(c => /INSERT INTO audit_log/.test(c.sql));
  assert.ok(insertCall, 'INSERT INTO documents query should exist');
  assert.ok(auditCall, 'INSERT INTO audit_log query should exist');
  assert.match(insertCall.sql, /vendor_code, vendor_match_confidence, vendor_match_method, matched_vendor_name/);
  assert.match(insertCall.sql, /job_match_number, job_match_confidence, job_match_method/);
  assert.equal(insertCall.params[27], 'LARK01');
  assert.equal(insertCall.params[28], 1);
  assert.equal(insertCall.params[29], 'fuzzy-high');
  assert.equal(insertCall.params[30], 'Lark Safety');
  assert.equal(insertCall.params[31], '26-434');
  assert.equal(insertCall.params[32], 0.95);
  assert.equal(insertCall.params[33], 'extracted-verified');
  assert.equal(insertCall.params[37], 0.95);
  assert.equal(auditCall.params[1], 'queued');
});

test('rowToDoc exposes persisted match fields with camelCased response shape', () => {
  const { rowToDoc, cleanup } = loadRowToDocWithMockPool();
  try {
    const doc = rowToDoc({
      id: 'doc-row-1',
      classification: 'coi',
      status: 'pending',
      confidence: '0.95',
      file_name: 'coi.pdf',
      line_items: [],
      vendor_code: 'SUM01',
      matched_vendor_name: 'Summit Steel LLC',
      vendor_match_confidence: '1',
      vendor_match_method: 'fuzzy-high',
      job_match_number: '26-434',
      job_match_confidence: '0.95',
      job_match_method: 'extracted-verified',
      needs_review: true,
    });

    assert.deepEqual(doc.matching.vendor, {
      vendorCode: 'SUM01',
      vendorName: 'Summit Steel LLC',
      confidence: 1,
      method: 'fuzzy-high',
    });
    assert.deepEqual(doc.matching.job, {
      jobNumber: '26-434',
      jobDescription: 'North Clinic Expansion',
      confidence: 0.95,
      method: 'extracted-verified',
    });

    const suggestionDoc = rowToDoc({
      id: 'doc-row-2',
      classification: 'statement',
      status: 'pending',
      file_name: 'statement.pdf',
      line_items: [],
      vendor_code: null,
      matched_vendor_name: 'ABD Suppliers',
      vendor_match_confidence: '0.84',
      vendor_match_method: 'fuzzy-low-suggestion',
      needs_review: true,
    });

    assert.deepEqual(suggestionDoc.matching.vendor, {
      vendorCode: null,
      vendorName: 'ABD Suppliers',
      confidence: 0.84,
      method: 'fuzzy-low-suggestion',
    });
    assert.equal(suggestionDoc.matching.job, null);
  } finally {
    cleanup();
  }
});
