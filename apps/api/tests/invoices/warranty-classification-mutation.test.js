'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = originalLoad; }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makePool(initialRow, options = {}) {
  let row = initialRow;
  let transactionStart;
  const calls = [];
  let lockTail = Promise.resolve();
  const pool = {
    async connect() {
      let releaseLock;
      return {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql === 'BEGIN') { transactionStart = row; return { rows: [] }; }
          if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
            const previous = lockTail;
            lockTail = new Promise((resolve) => { releaseLock = resolve; });
            await previous;
            return { rows: [row] };
          }
          if (/UPDATE documents SET warranty_manual_values/.test(sql)) {
            if (options.failUpdate) throw new Error('update failed');
            row = { ...row, warranty_manual_values: params[1] };
            return { rows: [row] };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (sql === 'ROLLBACK' && transactionStart) row = transactionStart;
            releaseLock?.();
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  return { pool, calls, get row() { return row; } };
}

function baseRow(overrides = {}) {
  return {
    id: 'warranty-1',
    classification: 'warranty',
    file_name: 'warranty.pdf',
    vendor_name: 'Vendor',
    description: 'Workmanship warranty',
    subcontract_number: null,
    warranty_manual_values: {},
    ...overrides,
  };
}

const auditActor = { userId: 'user-1', name: 'reviewer@example.com', role: 'approver' };

function serviceMocks(database, audits, options = {}) {
  return {
    './supabase': { pool: database.pool, rowToDoc: (row) => ({ id: row.id, classification: row.classification, warrantyManualValues: row.warranty_manual_values }) },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => auditActor,
      emitInvoiceAuditEvent: async (_req, _res, event) => {
        audits.push(event);
        if (options.failAudit) throw new Error('audit failed');
      },
    },
    '../../../middleware/errorResponse': { safeError: (res, error) => res.status(500).json({ error: error.message }) },
  };
}

test('warranty patch schema accepts one string or null and rejects invalid/unknown/empty bodies', () => {
  const { warrantyClassificationPatchSchema } = require('../../lib/schemas');
  assert.deepEqual(warrantyClassificationPatchSchema.parse({ providerKind: 'Manufacturer' }), { providerKind: 'Manufacturer' });
  assert.deepEqual(warrantyClassificationPatchSchema.parse({ warrantyType: null }), { warrantyType: null });
  for (const value of [42, false, {}, [], '   ']) assert.equal(warrantyClassificationPatchSchema.safeParse({ providerKind: value }).success, false);
  assert.equal(warrantyClassificationPatchSchema.safeParse({}).success, false);
  assert.equal(warrantyClassificationPatchSchema.safeParse({ other: 'x' }).success, false);
});

test('warranty set locks latest object, writes one replacement, audits, and returns canonical invoice', async () => {
  const database = makePool(baseRow({ warranty_manual_values: { warrantyType: { value: 'Old', setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' }, untouched: { value: 'keep' } } }));
  const audits = [];
  const req = { params: { id: 'warranty-1' }, body: { providerKind: 'Manufacturer' }, user: {} };
  const res = makeResponse();
  await withMockedModules(serviceMocks(database, audits), async () => {
    const { updateWarrantyClassification } = freshRequire('modules/invoices/services/warrantyClassificationService.js');
    await updateWarrantyClassification(req, res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.id, 'warranty-1');
  assert.equal(database.row.warranty_manual_values.providerKind.value, 'Manufacturer');
  assert.equal(database.row.warranty_manual_values.warrantyType.value, 'Old');
  assert.deepEqual(database.row.warranty_manual_values.untouched, { value: 'keep' });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].type, 'document.warranty_classification_updated');
  assert.equal(audits[0].client !== database.pool, true);
  assert.deepEqual(database.calls.map(({ sql }) => sql), ['BEGIN', 'SELECT * FROM documents WHERE id = $1 FOR UPDATE', 'UPDATE documents SET warranty_manual_values = $2 WHERE id = $1 RETURNING *', 'COMMIT']);
});

test('null clear removes only selected manual slot and audit reveals current computed fallback', async () => {
  const database = makePool(baseRow({ subcontract_number: 'SC-1', warranty_manual_values: {
    providerKind: { value: 'Manufacturer', setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' },
    warrantyType: { value: 'Extended', setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' },
  } }));
  const audits = [];
  const res = makeResponse();
  await withMockedModules(serviceMocks(database, audits), async () => {
    const { updateWarrantyClassification } = freshRequire('modules/invoices/services/warrantyClassificationService.js');
    await updateWarrantyClassification({ params: { id: 'warranty-1' }, body: { providerKind: null }, user: {} }, res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(database.row.warranty_manual_values.providerKind, undefined);
  assert.equal(database.row.warranty_manual_values.warrantyType.value, 'Extended');
  assert.equal(audits[0].afterState.warrantyManualValues.resolved.providerKind.value, 'Subcontractor');
  assert.equal(audits[0].afterState.warrantyManualValues.resolved.providerKind.provenance, 'computed');
  assert.equal(audits[0].beforeState.warrantyManualValues.resolved.providerKind.value, 'Manufacturer');
  assert.equal(audits[0].beforeState.warrantyManualValues.resolved.providerKind.provenance, 'manual');
});

test('warranty type clear omits provider slot and preserves its manual audit state', async () => {
  const database = makePool(baseRow({ subcontract_number: 'SC-1', warranty_manual_values: {
    providerKind: { value: 'Manufacturer', setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' },
    warrantyType: { value: 'Extended', setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' },
  } }));
  const audits = [];
  const res = makeResponse();
  await withMockedModules(serviceMocks(database, audits), async () => {
    const { updateWarrantyClassification } = freshRequire('modules/invoices/services/warrantyClassificationService.js');
    await updateWarrantyClassification({ params: { id: 'warranty-1' }, body: { warrantyType: null }, user: {} }, res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(database.row.warranty_manual_values.warrantyType, undefined);
  assert.equal(database.row.warranty_manual_values.providerKind.value, 'Manufacturer');
  assert.equal(audits[0].beforeState.warrantyManualValues.resolved.providerKind.value, 'Manufacturer');
  assert.equal(audits[0].afterState.warrantyManualValues.resolved.providerKind.value, 'Manufacturer');
  assert.equal(audits[0].beforeState.warrantyManualValues.resolved.warrantyType.value, 'Extended');
  assert.notEqual(audits[0].afterState.warrantyManualValues.resolved.warrantyType.value, 'Extended');
});

test('recompute/source changes cannot overwrite manual state and concurrent patches serialize on locked latest row', async () => {
  const database = makePool(baseRow({ warranty_manual_values: {} }));
  const audits = [];
  const mocks = serviceMocks(database, audits);
  const req = (body) => ({ params: { id: 'warranty-1' }, body, user: {} });
  await withMockedModules(mocks, async () => {
    const { updateWarrantyClassification } = freshRequire('modules/invoices/services/warrantyClassificationService.js');
    await Promise.all([updateWarrantyClassification(req({ providerKind: 'Manufacturer' }), makeResponse()), updateWarrantyClassification(req({ warrantyType: 'Extended' }), makeResponse())]);
  });
  assert.equal(database.row.warranty_manual_values.providerKind.value, 'Manufacturer');
  assert.equal(database.row.warranty_manual_values.warrantyType.value, 'Extended');
  assert.equal(audits.length, 2);
});

test('mutation and audit failures roll back transaction together', async () => {
  for (const options of [{ failAudit: true }, { failUpdate: true }]) {
    const database = makePool(baseRow({ warranty_manual_values: {} }), options);
    const audits = [];
    const res = makeResponse();
    await withMockedModules(serviceMocks(database, audits, options), async () => {
      const { updateWarrantyClassification } = freshRequire('modules/invoices/services/warrantyClassificationService.js');
      await updateWarrantyClassification({ params: { id: 'warranty-1' }, body: { providerKind: 'Manufacturer' }, user: {} }, res);
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(database.row.warranty_manual_values, {});
    assert.ok(database.calls.some(({ sql }) => sql === 'ROLLBACK'));
  }
});

test('non-warranty documents are refused after lock without changing classification', async () => {
  const database = makePool(baseRow({ classification: 'invoice' }));
  const audits = [];
  const res = makeResponse();
  await withMockedModules(serviceMocks(database, audits), async () => {
    const { updateWarrantyClassification } = freshRequire('modules/invoices/services/warrantyClassificationService.js');
    await updateWarrantyClassification({ params: { id: 'warranty-1' }, body: { providerKind: 'Vendor' }, user: {} }, res);
  });
  assert.equal(res.statusCode, 409);
  assert.equal(audits.length, 0);
  assert.equal(database.row.classification, 'invoice');
  assert.equal(database.calls.some(({ sql }) => /UPDATE documents SET/.test(sql)), false);
});

test('invoices route registers the approve-gated warranty classification PATCH and inventory is updated', () => {
  const source = fs.readFileSync(path.join(root, 'modules/invoices/routes/invoices.js'), 'utf8');
  assert.match(source, /router\.patch\('\/:id\/warranty-classification', requirePermission\('accounting\.invoices\.approve'\), validate\(warrantyClassificationPatchSchema/);
  const security = fs.readFileSync(path.join(root, 'tests/security/endpoint-gates-and-validation.test.js'), 'utf8');
  assert.match(security, /modules\/invoices\/routes\/invoices\.js', 65/);
  assert.match(security, /assert\.equal\(total, 178/);
});

test('denied warranty mutation stops at the approve gate before service/query/audit', async () => {
  let serviceCalls = 0;
  await withMockedModules({
    '/etc/toolbox/paths.js': { BOX_SCRIPT: '/tmp/box.js', WEBHOOKS_JSON: '/tmp/webhooks.json' },
    '../services/warrantyClassificationService': {
      updateWarrantyClassification: async () => { serviceCalls += 1; },
    },
  }, async () => {
    const router = freshRequire('modules/invoices/routes/invoices.js');
    const layer = router.stack.find((entry) => entry.route?.path === '/:id/warranty-classification' && entry.route.methods.patch);
    assert.ok(layer);
    const gate = layer.route.stack[0].handle;
    const res = makeResponse();
    let nextCalled = false;
    gate({ user: { role: 'viewer', permissions: [] } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  });
  assert.equal(serviceCalls, 0);
});
