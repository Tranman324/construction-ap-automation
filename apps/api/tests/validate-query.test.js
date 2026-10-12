'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { z } = require('zod');

const {
  invoiceListQuerySchema,
  invoiceStatsQuerySchema,
  invoiceTrashQuerySchema,
} = require('../lib/schemas');
const { validate } = require('../middleware/validate');

test('query validation works when req.query is a read-only getter', () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    type: z.string().trim().min(1).optional(),
  }).strict();

  const req = {
    body: {},
    originalUrl: '/api/audit/events?type=invoice.approved',
    requestId: 'test-request',
  };

  Object.defineProperty(req, 'query', {
    get() {
      return { type: ' invoice.approved ' };
    },
    enumerable: true,
    configurable: true,
  });

  const res = {};
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  validate(schema, 'query')(req, res, next);

  assert.equal(nextCalled, true);
  assert.deepEqual(req.query, {
    page: 1,
    limit: 50,
    type: 'invoice.approved',
  });
});

test('strict invoice list queries preserve public panels and established lifecycle/sort values', () => {
  const allowed = ['invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other'];
  for (const panel of allowed) {
    assert.equal(invoiceListQuerySchema.safeParse({ panel }).success, true, panel);
  }

  for (const panel of ['subcontract', 'warranty', 'building-permit', 'Invoice', 'unknown']) {
    assert.equal(invoiceListQuerySchema.safeParse({ panel }).success, false, panel);
  }

  for (const status of [
    'documents', 'modified', 'retry-pending', 'duplicate', 'reviewed',
    'needs-split', 'split-processing', 'split',
  ]) {
    assert.equal(invoiceListQuerySchema.safeParse({ status }).success, true, status);
  }
  for (const sort of ['classification', 'waivers-first']) {
    assert.equal(invoiceListQuerySchema.safeParse({ sort }).success, true, sort);
  }
});

test('global invoice search requires a nonblank search term', () => {
  const valid = runQueryMiddleware(invoiceListQuerySchema, { scope: 'global', search: 'acme' });
  assert.equal(valid.nextCalled, true);
  assert.equal(valid.req.query.scope, 'global');

  const invalid = runQueryMiddleware(invoiceListQuerySchema, { scope: 'global', search: '   ' });
  assert.equal(invalid.nextCalled, false);
  assert.equal(invalid.res.statusCode, 400);
});

test('global search keeps the existing invoice-list and Trash view permission boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules/invoices/routes/invoices.js'), 'utf8');

  assert.match(source, /router\.get\('\/', requirePermission\('accounting\.invoices\.view'\), validate\(invoiceListQuerySchema, 'query'\)/);
  assert.match(source, /router\.get\('\/trash', requirePermission\('accounting\.invoices\.view'\), validate\(invoiceTrashQuerySchema, 'query'\)/);
});

function runQueryMiddleware(schema, query) {
  const req = {
    query,
    originalUrl: '/api/invoices',
    log: { warn() {} },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let nextCalled = false;

  validate(schema, 'query')(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

test('strict invoice route query middleware rejects invalid, oversized, and unknown inputs before handlers', () => {
  for (const [schema, query, field] of [
    [invoiceListQuerySchema, { panel: 'warranty' }, 'panel'],
    [invoiceListQuerySchema, { limit: '201' }, 'limit'],
    [invoiceListQuerySchema, { unexpected: 'value' }, '_errors'],
    [invoiceStatsQuerySchema, { limit: '1' }, '_errors'],
    [invoiceTrashQuerySchema, { offset: '-1' }, 'offset'],
  ]) {
    const { res, nextCalled } = runQueryMiddleware(schema, query);
    assert.equal(nextCalled, false, JSON.stringify(query));
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.body.error, 'Validation failed', JSON.stringify(query));
    assert.ok(res.body.details[field], JSON.stringify(query));
  }
});

test('invoice list validation preserves omitted-offset page semantics and explicit offset', () => {
  const pageOnly = runQueryMiddleware(invoiceListQuerySchema, { page: '2', limit: '25' });
  assert.equal(pageOnly.nextCalled, true);
  assert.equal(Object.hasOwn(pageOnly.req.query, 'offset'), false);
  assert.deepEqual(pageOnly.req.query, {
    status: 'all', page: 2, limit: 25, sort: 'date', sortDir: 'asc', search: '',
  });

  const explicitOffset = runQueryMiddleware(invoiceListQuerySchema, { page: '2', limit: '25', offset: '0' });
  assert.equal(explicitOffset.nextCalled, true);
  assert.equal(explicitOffset.req.query.offset, 0);
});

test('invoice collection routes use their strict route-specific query validators', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules/invoices/routes/invoices.js'), 'utf8');
  for (const [route, schema] of [
    ['/', 'invoiceListQuerySchema'],
    ['/stats', 'invoiceStatsQuerySchema'],
    ['/trash', 'invoiceTrashQuerySchema'],
  ]) {
    const escapedRoute = route.replace('/', '\\/');
    assert.match(
      source,
      new RegExp(`router\\.get\\('${escapedRoute}', requirePermission\\('accounting\\.invoices\\.view'\\), validate\\(${schema}, 'query'\\)`),
      route
    );
  }
});
