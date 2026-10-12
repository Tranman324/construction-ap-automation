'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { documentDestinationsWriteSchema } = require('../../lib/schemas');

const root = path.resolve(__dirname, '..', '..');

function freshRequire(relativePath) {
  const resolvedPath = require.resolve(path.join(root, relativePath));
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('destination write schema accepts an optional effectiveFrom without loosening config strictness', () => {
  const valid = {
    rootLabel: 'root',
    tree: [],
    defaults: { subcontract: 's', warranty: 'w', 'lien-waiver': 'l', other: 'o' },
    effectiveFrom: '2026-12-01T00:00:00.000Z',
  };
  assert.equal(documentDestinationsWriteSchema.safeParse(valid).success, true);
  assert.equal(documentDestinationsWriteSchema.safeParse({ ...valid, unexpected: true }).success, false);
});

test('document destination versions migration is additive, effective-dated, and backfills singleton v1', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations', '2026-07-31_document_destination_versions.sql'),
    'utf8',
  );
  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS document_destination_versions/i);
  assert.match(sql, /id TEXT PRIMARY KEY/i);
  assert.match(sql, /version INTEGER NOT NULL/i);
  assert.match(sql, /effective_from TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /config JSONB NOT NULL/i);
  assert.match(sql, /author TEXT NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS document_destination_versions_version_key[\s\S]*ON document_destination_versions \(version\)/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS document_destination_versions_effective_order[\s\S]*effective_from DESC, created_at DESC, id DESC/i);
  assert.match(sql, /INSERT INTO document_destination_versions[\s\S]*'v1'[\s\S]*COALESCE\(updated_at, NOW\(\)\)[\s\S]*COALESCE\(updated_by, 'seed'\)[\s\S]*FROM document_destinations[\s\S]*ON CONFLICT \(id\) DO NOTHING/i);
});

test('effective destination helper selects the latest due version with deterministic physical-id tie ordering', async () => {
  const calls = [];
  const rows = [
    { id: 'v1', config: { marker: 'old' }, effective_from: new Date('2026-07-01T00:00:00.000Z'), created_at: new Date('2026-07-01T00:00:00.000Z'), author: 'seed' },
    { id: 'v2', config: { marker: 'tie-loser' }, effective_from: new Date('2026-08-01T00:00:00.000Z'), created_at: new Date('2026-08-01T00:00:00.000Z'), author: 'admin' },
    { id: 'v3', config: { marker: 'tie-winner' }, effective_from: new Date('2026-08-01T00:00:00.000Z'), created_at: new Date('2026-08-01T00:00:00.000Z'), author: 'admin' },
    { id: 'future', config: { marker: 'future' }, effective_from: new Date('2026-09-01T00:00:00.000Z'), created_at: new Date('2026-09-01T00:00:00.000Z'), author: 'admin' },
  ];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      const now = params[0];
      return {
        rows: rows
          .filter((row) => row.effective_from <= now)
          .sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at || b.id.localeCompare(a.id))
          .slice(0, 1),
      };
    },
  };

  const supabaseMock = { pool };
  await withMockedModules({
    './supabase': supabaseMock,
    [path.join(root, 'modules/invoices/services/supabase.js')]: supabaseMock,
    '../../../lib/db': pool,
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => ({ id: 'evt' }), getRequestAuditActor: () => ({ name: 'test' }) },
  }, async () => {
    const { getEffectiveDocumentDestinations, versionShape } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    assert.equal(typeof getEffectiveDocumentDestinations, 'function');
    assert.equal(typeof versionShape, 'function');
    const effective = await getEffectiveDocumentDestinations(undefined, new Date('2026-08-01T12:00:00.000Z'));
    assert.equal(effective.id, 'v3');
    assert.deepEqual(effective.config, { marker: 'tie-winner' });
    assert.equal(effective.row.id, 'v3');
    assert.deepEqual(versionShape(rows[0]), {
      id: 'v1',
      config: { marker: 'old' },
      effectiveFrom: '2026-07-01T00:00:00.000Z',
      author: 'seed',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM document_destination_versions WHERE effective_from <= \$1 ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1/i);
});

test('current destination GET selects the server-effective version and keeps the bare config response', async () => {
  const now = new Date('2026-08-01T12:00:00.000Z');
  const rows = [
    { id: 'v1', config: { marker: 'old' }, effective_from: new Date('2026-07-01T00:00:00.000Z'), created_at: new Date('2026-07-01T00:00:00.000Z'), author: 'seed' },
    { id: 'v2', config: { marker: 'future' }, effective_from: new Date('2026-09-01T00:00:00.000Z'), created_at: new Date('2026-09-01T00:00:00.000Z'), author: 'admin' },
  ];
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM document_destination_versions/.test(sql)) {
        return { rows: rows.filter((row) => row.effective_from <= params[0]).slice(-1) };
      }
      return { rows: [{ config: { marker: 'legacy-fallback' } }] };
    },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => ({ id: 'evt' }), getRequestAuditActor: () => ({ name: 'test' }) },
  }, async () => {
    const { getDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await getDocumentDestinations({ destinationNow: now }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { marker: 'old' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [now]);
});

test('current destination GET falls back to the singleton when no version is effective', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (/FROM document_destination_versions/.test(sql)) return { rows: [] };
      return { rows: [{ config: { marker: 'legacy' } }] };
    },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => ({ id: 'evt' }), getRequestAuditActor: () => ({ name: 'test' }) },
  }, async () => {
    const { getDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await getDocumentDestinations({ destinationNow: new Date('2026-06-01T00:00:00.000Z') }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { marker: 'legacy' });
  assert.equal(calls.length, 2);
});

test('current destination GET preserves legacy compatibility when the version table is not yet present', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (/FROM document_destination_versions/.test(sql)) {
        const error = new Error('relation does not exist');
        error.code = '42P01';
        throw error;
      }
      return { rows: [{ config: { marker: 'legacy-before-migration' } }] };
    },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => ({ id: 'evt' }), getRequestAuditActor: () => ({ name: 'test' }) },
  }, async () => {
    const { getDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await getDocumentDestinations({}, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { marker: 'legacy-before-migration' });
  assert.equal(calls.length, 2);
});

test('destination history list is bounded, deterministic, and exposes physical ids', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/COUNT/.test(sql)) return { rows: [{ count: 3 }] };
      return {
        rows: [{
          id: 'v3',
          config: { marker: 'latest' },
          effective_from: new Date('2026-08-03T00:00:00.000Z'),
          author: 'admin',
          created_at: new Date('2026-08-03T00:00:00.000Z'),
        }],
      };
    },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => ({ id: 'evt' }), getRequestAuditActor: () => ({ name: 'test' }) },
  }, async () => {
    const { listDocumentDestinationVersions } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await listDocumentDestinationVersions({ query: { limit: '201', offset: '-4' } }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['limit', 'offset', 'total', 'versions']);
  assert.equal(res.body.limit, 200);
  assert.equal(res.body.offset, 0);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.versions[0].id, 'v3');
  assert.equal(res.body.versions[0].effectiveFrom, '2026-08-03T00:00:00.000Z');
  assert.deepEqual(calls.find((call) => /ORDER BY effective_from DESC/.test(call.sql)).params, [200, 0]);
});

test('destination version detail preserves the physical id and returns canonical 404 for a miss', async () => {
  const pool = {
    async query(_sql, params) {
      return params[0] === 'v2'
        ? { rows: [{ id: 'v2', config: { marker: 'x' }, effective_from: new Date('2026-08-02T00:00:00.000Z'), author: 'admin', created_at: new Date('2026-08-01T00:00:00.000Z') }] }
        : { rows: [] };
    },
  };
  const hit = makeRes();
  const miss = makeRes();

  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => ({ id: 'evt' }), getRequestAuditActor: () => ({ name: 'test' }) },
  }, async () => {
    const { getDocumentDestinationVersion } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await getDocumentDestinationVersion({ params: { id: 'v2' } }, hit);
    await getDocumentDestinationVersion({ params: { id: 'missing' } }, miss);
  });

  assert.equal(hit.statusCode, 200);
  assert.equal(hit.body.id, 'v2');
  assert.equal(miss.statusCode, 404);
  assert.equal(miss.body.code, 'DOCUMENT_DESTINATION_VERSION_NOT_FOUND');
});

test('a future-effective destination write appends one version, audits in the transaction, and keeps the current config', async () => {
  const future = '2026-12-01T00:00:00.000Z';
  const oldConfig = { marker: 'current' };
  const calls = [];
  const captured = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/SELECT config FROM document_destinations/.test(sql)) return { rows: [{ config: oldConfig }] };
      if (/FROM document_destination_versions WHERE effective_from <=/.test(sql)) return { rows: [{ id: 'v1', config: oldConfig, effective_from: new Date('2026-07-01T00:00:00.000Z'), created_at: new Date('2026-07-01T00:00:00.000Z'), author: 'seed' }] };
      if (/COALESCE\(MAX\(version\)/.test(sql)) return { rows: [{ version: 2 }] };
      if (/INSERT INTO document_destination_versions/.test(sql)) return { rows: [{ id: 'physical-v3', config: JSON.parse(params[3]), effective_from: params[2], author: params[5], created_at: params[4] }] };
      if (/INSERT INTO document_destinations/.test(sql)) return { rows: [{ config: JSON.parse(params[0]) }] };
      return { rows: [] };
    },
  };
  client.release = () => {};
  const pool = { async connect() { return client; } };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ name: 'admin@northwindcg.example', userId: 'admin', role: 'admin' }),
      emitPlatformAuditEvent: async (_req, _res, options) => { captured.push(options); return { id: 'evt-1' }; },
    },
  }, async () => {
    const { updateDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await updateDocumentDestinations({ body: { rootLabel: 'root', tree: [], defaults: { subcontract: 's', warranty: 'w', 'lien-waiver': 'l', other: 'o' }, effectiveFrom: future }, user: { email: 'admin@northwindcg.example' }, destinationNow: new Date('2026-08-01T00:00:00.000Z') }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.version, 'future-effective writes return version metadata');
  assert.equal(res.body.version.id, 'physical-v3');
  assert.equal(res.body.version.effectiveFrom, future);
  assert.deepEqual(res.body.config, oldConfig);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].client, client);
  assert.equal(captured[0].targetId, 'physical-v3');
  assert.match(calls.find((call) => /INSERT INTO document_destination_versions/.test(call.sql)).sql, /INSERT INTO document_destination_versions/);
  assert.ok(calls.indexOf(calls.find((call) => /SELECT config FROM document_destinations/.test(call.sql))) < calls.findIndex((call) => /INSERT INTO document_destination_versions/.test(call.sql)));
});

test('an invalid effectiveFrom is refused before any destination query or append', async () => {
  const calls = [];
  const pool = { async query(sql) { calls.push(sql); return { rows: [] }; } };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { getRequestAuditActor: () => ({ name: 'admin' }), emitPlatformAuditEvent: async () => ({ id: 'evt' }) },
  }, async () => {
    const { updateDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await updateDocumentDestinations({ body: { rootLabel: 'root', tree: [], defaults: { subcontract: 's', warranty: 'w', 'lien-waiver': 'l', other: 'o' }, effectiveFrom: '2026-02-30T00:00:00.000Z' }, user: { email: 'admin' } }, res);
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'INVALID_DOCUMENT_DESTINATIONS_CONFIG');
  assert.equal(calls.length, 0);
});

test('destination audit failure rolls back the appended version', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
      if (/SELECT config FROM document_destinations/.test(sql)) return { rows: [{ config: { marker: 'current' } }] };
      if (/FROM document_destination_versions WHERE effective_from <=/.test(sql)) return { rows: [{ id: 'v1', config: { marker: 'current' }, effective_from: new Date('2026-07-01T00:00:00.000Z'), created_at: new Date('2026-07-01T00:00:00.000Z'), author: 'seed' }] };
      if (/COALESCE\(MAX\(version\)/.test(sql)) return { rows: [{ version: 1 }] };
      if (/INSERT INTO document_destination_versions/.test(sql)) return { rows: [{ id: 'v2', config: JSON.parse(params[3]), effective_from: params[2], created_at: params[4], author: params[5] }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ name: 'admin' }),
      emitPlatformAuditEvent: async () => { throw new Error('audit unavailable'); },
    },
  }, async () => {
    const { updateDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await updateDocumentDestinations({ body: { rootLabel: 'root', tree: [], defaults: { subcontract: 's', warranty: 'w', 'lien-waiver': 'l', other: 'o' }, effectiveFrom: '2026-12-01T00:00:00.000Z' }, user: { email: 'admin' } }, res);
  });
  assert.equal(res.statusCode, 500);
  assert.equal(calls.filter((call) => call.sql === 'COMMIT').length, 0);
  assert.equal(calls.filter((call) => call.sql === 'ROLLBACK').length, 1);
});
