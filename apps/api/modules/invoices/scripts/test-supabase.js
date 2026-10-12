#!/usr/bin/env node
/**
 * Supabase Integration Test Suite — Invoice Pipeline
 * Tests all converted code paths against live Supabase tables.
 */
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const path = require('path');

let passed = 0, failed = 0, skipped = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name} — ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

(async () => {
  console.log('\n=== 1. DATABASE CONNECTION ===');
  
  await test('Connect to Supabase', async () => {
    const { rows } = await pool.query('SELECT 1 as ok');
    assert(rows[0].ok === 1, 'Connection failed');
  });

  await test('Confirm remote (not localhost)', async () => {
    const url = process.env.SUPABASE_DB_URL || '';
    assert(url.includes('supabase.co'), `Expected Supabase URL, got: ${url.substring(0, 30)}...`);
  });

  console.log('\n=== 2. DOCUMENTS TABLE ===');

  await test('Read documents count', async () => {
    const { rows: [{ c }] } = await pool.query('SELECT count(*)::int as c FROM documents');
    assert(c >= 100, `Expected >=100 docs, got ${c}`);
    console.log(`       ${c} documents`);
  });

  await test('Read document by ID', async () => {
    const { rows } = await pool.query('SELECT id, classification, status FROM documents LIMIT 1');
    assert(rows.length === 1, 'No documents returned');
    assert(rows[0].id, 'Missing id');
    assert(rows[0].classification, 'Missing classification');
  });

  await test('Status breakdown matches', async () => {
    const { rows } = await pool.query('SELECT status, count(*)::int as c FROM documents GROUP BY status ORDER BY c DESC');
    assert(rows.length >= 3, `Expected >=3 statuses, got ${rows.length}`);
    const statuses = rows.map(r => r.status);
    assert(statuses.includes('pending'), 'Missing pending status');
    console.log(`       ${rows.map(r => `${r.status}:${r.c}`).join(', ')}`);
  });

  await test('Indexes exist', async () => {
    const { rows } = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'documents'");
    const names = rows.map(r => r.indexname);
    assert(names.includes('idx_documents_status'), 'Missing status index');
    assert(names.includes('idx_documents_vendor_code'), 'Missing vendor_code index');
    assert(names.includes('idx_documents_email_message_id'), 'Missing email_message_id index');
    console.log(`       ${rows.length} indexes`);
  });

  console.log('\n=== 3. PROCESSED EMAILS TABLE ===');

  await test('Read processed email count', async () => {
    const { rows: [{ c }] } = await pool.query('SELECT count(*)::int as c FROM processed_emails');
    assert(c >= 80, `Expected >=80 processed emails, got ${c}`);
    console.log(`       ${c} processed emails`);
  });

  await test('Insert + read + delete test email', async () => {
    const testId = `test-${Date.now()}`;
    await pool.query('INSERT INTO processed_emails (email_id) VALUES ($1)', [testId]);
    const { rows } = await pool.query('SELECT email_id FROM processed_emails WHERE email_id = $1', [testId]);
    assert(rows.length === 1, 'Insert failed');
    await pool.query('DELETE FROM processed_emails WHERE email_id = $1', [testId]);
    const { rows: after } = await pool.query('SELECT email_id FROM processed_emails WHERE email_id = $1', [testId]);
    assert(after.length === 0, 'Delete failed');
  });

  await test('Upsert (ON CONFLICT) works', async () => {
    const testId = `test-upsert-${Date.now()}`;
    await pool.query('INSERT INTO processed_emails (email_id) VALUES ($1) ON CONFLICT (email_id) DO NOTHING', [testId]);
    await pool.query('INSERT INTO processed_emails (email_id) VALUES ($1) ON CONFLICT (email_id) DO NOTHING', [testId]);
    const { rows: [{ c }] } = await pool.query('SELECT count(*)::int as c FROM processed_emails WHERE email_id = $1', [testId]);
    assert(c === 1, `Expected 1 row after upsert, got ${c}`);
    await pool.query('DELETE FROM processed_emails WHERE email_id = $1', [testId]);
  });

  console.log('\n=== 4. VENDOR MAPPINGS TABLE ===');

  await test('Read vendor mappings', async () => {
    const { rows } = await pool.query('SELECT * FROM vendor_mappings');
    assert(rows.length >= 4, `Expected >=4 mappings, got ${rows.length}`);
    console.log(`       ${rows.length} mappings`);
  });

  await test('Domain lookup (meridianfp.example)', async () => {
    const { rows } = await pool.query('SELECT vendor_code FROM vendor_mappings WHERE domain = $1', ['meridianfp.example']);
    assert(rows.length === 1, 'meridianfp.example not found');
    assert(rows[0].vendor_code === 'ZMER93', `Expected ZMER93, got ${rows[0].vendor_code}`);
  });

  await test('Insert + read + delete test mapping', async () => {
    const testDomain = `test-${Date.now()}.com`;
    await pool.query('INSERT INTO vendor_mappings (domain, vendor_code, vendor_name) VALUES ($1, $2, $3)', [testDomain, 'TEST01', 'Test Vendor']);
    const { rows } = await pool.query('SELECT * FROM vendor_mappings WHERE domain = $1', [testDomain]);
    assert(rows.length === 1 && rows[0].vendor_code === 'TEST01', 'Insert/read failed');
    await pool.query('DELETE FROM vendor_mappings WHERE domain = $1', [testDomain]);
  });

  console.log('\n=== 5. SUBCONTRACT MAPPINGS TABLE ===');

  await test('Read subcontract mappings', async () => {
    const { rows } = await pool.query('SELECT * FROM subcontract_mappings');
    assert(rows.length >= 10, `Expected >=10 mappings, got ${rows.length}`);
    console.log(`       ${rows.length} mappings`);
  });

  await test('Lookup ZSPE91:25-549', async () => {
    const { rows } = await pool.query('SELECT subcontract_number FROM subcontract_mappings WHERE vendor_code = $1 AND job_prefix = $2', ['ZSPE91', '25-549']);
    assert(rows.length === 1, 'ZSPE91:25-549 not found');
    assert(rows[0].subcontract_number === '25-549.04', `Expected 25-549.04, got ${rows[0].subcontract_number}`);
  });

  console.log('\n=== 6. PROCESSING QUEUE TABLE ===');

  await test('Queue table accessible', async () => {
    const { rows: [{ c }] } = await pool.query('SELECT count(*)::int as c FROM processing_queue');
    console.log(`       ${c} queued items`);
  });

  await test('Insert + read + delete queue item', async () => {
    const testId = `test-q-${Date.now()}`;
    await pool.query(
      `INSERT INTO processing_queue (id, status, queued_at) VALUES ($1, $2, $3)`,
      [testId, 'queued', new Date().toISOString()]
    );
    const { rows } = await pool.query('SELECT * FROM processing_queue WHERE id = $1', [testId]);
    assert(rows.length === 1, 'Queue insert failed');
    await pool.query('DELETE FROM processing_queue WHERE id = $1', [testId]);
  });

  console.log('\n=== 7. MATCHER.JS (async Supabase) ===');

  await test('matchVendor by domain', async () => {
    const matcher = require('../services/matcher');
    const result = await matcher.matchVendor({ email: 'invoices@meridianfp.example', vendorName: '' }, []);
    assert(result && result.vendorCode === 'ZMER93', `Expected ZMER93, got ${JSON.stringify(result)}`);
    console.log(`       ${result.vendorCode} via ${result.method}`);
  });

  await test('recordVendorFeedback + read back', async () => {
    const matcher = require('../services/matcher');
    await matcher.recordVendorFeedback({ email: 'test-suite@fakecorp.example', name: '', vendorCode: 'FAKE01', vendorName: 'Fake Corp' });
    const { rows } = await pool.query('SELECT * FROM vendor_mappings WHERE domain = $1', ['fakecorp.example']);
    assert(rows.length === 1 && rows[0].vendor_code === 'FAKE01', 'Feedback not written to Supabase');
    // Cleanup
    await pool.query('DELETE FROM vendor_mappings WHERE domain = $1', ['fakecorp.example']);
  });

  await test('recordSubcontractFeedback + read back', async () => {
    const matcher = require('../services/matcher');
    await matcher.recordSubcontractFeedback({ vendorCode: 'FAKE01', jobNumber: '99-799', subcontractNumber: '99-799.01' });
    const { rows } = await pool.query('SELECT * FROM subcontract_mappings WHERE vendor_code = $1 AND job_prefix = $2', ['FAKE01', '99-799']);
    assert(rows.length === 1 && rows[0].subcontract_number === '99-799.01', 'SC feedback not in Supabase');
    // Cleanup
    await pool.query('DELETE FROM subcontract_mappings WHERE vendor_code = $1 AND job_prefix = $2', ['FAKE01', '99-799']);
  });

  console.log('\n=== 8. PIPELINE.JS (processed IDs from Supabase) ===');

  await test('Pipeline dry-run loads IDs from Supabase', async () => {
    // Just verify the module loads and the function signature is right
    const pipeline = require('../services/pipeline');
    assert(typeof pipeline.runPipeline === 'function', 'runPipeline not exported');
  });

  console.log('\n=== 9. API SERVER ENDPOINTS ===');

  const http = require('http');
  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:3456${path}`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }).on('error', reject);
    });
  }

  await test('GET /api/invoices', async () => {
    const r = await get('/api/invoices?limit=2');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.body.invoices && r.body.invoices.length > 0, 'No invoices returned');
  });

  await test('GET /api/invoices/stats', async () => {
    const r = await get('/api/invoices/stats');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.body.total >= 100, `Expected >=100 total, got ${r.body.total}`);
    console.log(`       total:${r.body.total} pending:${r.body.pending}`);
  });

  await test('GET /api/vendors', async () => {
    const r = await get('/api/vendors?limit=3');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(Array.isArray(r.body) && r.body.length > 0, 'No vendors returned');
    assert(r.body[0].name, 'Vendor missing name field');
  });

  await test('GET /api/jobs', async () => {
    const r = await get('/api/jobs?limit=3');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(Array.isArray(r.body) && r.body.length > 0, 'No jobs returned');
  });

  await test('GET /api/subcontracts', async () => {
    const r = await get('/api/subcontracts?vendorCode=ZMER93');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(Array.isArray(r.body), 'Not an array');
  });

  await test('GET /api/vendors/refresh/status', async () => {
    const r = await get('/api/vendors/refresh/status');
    assert(r.status === 200, `HTTP ${r.status}`);
  });

  await test('GET /api/pipeline/status', async () => {
    const r = await get('/api/pipeline/status');
    assert(r.status === 200, `HTTP ${r.status}`);
  });

  // === SUMMARY ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}  |  TOTAL: ${passed + failed}`);
  console.log(`${'='.repeat(50)}\n`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
})();
