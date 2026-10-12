'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function resolved(relativePath) {
  return require.resolve(path.join(root, relativePath));
}

// Load invoiceCollectionService with a fake pool but the REAL rowToDoc, by
// injecting the fake pool as lib/db (which supabase.js re-exports as its pool).
// Using the real rowToDoc is deliberate: a passthrough rowToDoc would false-green
// the flagged_at -> flaggedAt serialization claim.
async function loadCollectionService(pool, fn) {
  const dbPath = resolved('lib/db.js');
  const auditPath = resolved('lib/auditEvents.js');
  const activityPath = resolved('modules/invoices/services/activityService.js');
  const supabasePath = resolved('modules/invoices/services/supabase.js');
  const collPath = resolved('modules/invoices/services/invoiceCollectionService.js');
  const before = {
    db: require.cache[dbPath],
    audit: require.cache[auditPath],
    activity: require.cache[activityPath],
    supabase: require.cache[supabasePath],
    coll: require.cache[collPath],
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  delete require.cache[auditPath];
  require.cache[activityPath] = {
    id: activityPath,
    filename: activityPath,
    loaded: true,
    exports: { getUnreadAggregates: async () => ({ unreadReplies: 0, unreadComments: 0 }) },
  };
  delete require.cache[supabasePath];
  delete require.cache[collPath];
  try {
    return await fn(require(collPath));
  } finally {
    for (const [key, p] of [['db', dbPath], ['audit', auditPath], ['activity', activityPath], ['supabase', supabasePath], ['coll', collPath]]) {
      if (before[key]) require.cache[p] = before[key];
      else delete require.cache[p];
    }
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

// Fake pool that (a) applies the flag dimension of the WHERE clause so a
// flagged=true query returns exactly the flagged rows, and (b) PROJECTS only the
// columns the SELECT names — so an incomplete LIST_COLUMNS yields a row missing
// the flag fields and the serialization test fails without the column fix (real
// behavioral fail-without-fix, not just a source-shape check).
function makeListPool(docs) {
  const calls = [];
  function applyFlag(sql) {
    if (/flagged_at IS NOT NULL/.test(sql)) return docs.filter((d) => d.flagged_at != null);
    if (/flagged_at IS NULL/.test(sql)) return docs.filter((d) => d.flagged_at == null);
    return docs;
  }
  // Project each row to only the columns the SELECT names (word-boundary match
  // on the column name). If LIST_COLUMNS omits flagged_at, the projected row has
  // no flagged_at, so rowToDoc yields flaggedAt:null and the value assertion
  // fails — a real behavioral fail-without-fix, not a source-shape check.
  function project(sql, rows) {
    if (/^\s*SELECT COUNT/i.test(sql)) return rows;
    return rows.map((d) => {
      const projected = {};
      for (const key of Object.keys(d)) {
        if (new RegExp(`\\b${key}\\b`).test(sql)) projected[key] = d[key];
      }
      return projected;
    });
  }
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT COUNT/.test(sql)) return { rows: [{ count: String(applyFlag(sql).length) }] };
      if (/FROM documents/.test(sql)) return { rows: project(sql, applyFlag(sql)) };
      return { rows: [] };
    },
    dataQuery() { return this.calls.find((c) => /FROM documents/.test(c.sql) && !/^\s*SELECT COUNT/.test(c.sql)); },
  };
}

function flaggedDoc(overrides = {}) {
  return {
    id: 'doc-flagged',
    classification: 'invoice',
    status: 'pending',
    file_name: 'inv.pdf',
    flagged: false,
    flagged_at: new Date('2026-07-18T15:30:00.000Z'),
    flagged_by: 'dana@northwindcg.example',
    flag_reason: 'Needs a closer look',
    ...overrides,
  };
}

function unflaggedDoc(overrides = {}) {
  return {
    id: 'doc-plain',
    classification: 'invoice',
    status: 'pending',
    file_name: 'plain.pdf',
    flagged: false,
    flagged_at: null,
    flagged_by: null,
    flag_reason: null,
    ...overrides,
  };
}

test('GET /api/invoices list rows serialize the flag fields from non-null DB values', async () => {
  const pool = makeListPool([flaggedDoc()]);
  const res = makeRes();
  await loadCollectionService(pool, async (mod) => {
    await mod.listInvoices({ query: {} }, res);
  });

  assert.equal(res.statusCode, 200);
  const row = res.body.invoices[0];
  assert.equal(row.flaggedAt, '2026-07-18T15:30:00.000Z');
  assert.equal(row.flaggedBy, 'dana@northwindcg.example');
  assert.equal(row.flagReason, 'Needs a closer look');
  // The list SELECT actually pulls the columns (fails without the LIST_COLUMNS fix).
  const data = pool.dataQuery();
  assert.match(data.sql, /flagged_at, flagged_by, flag_reason/);
});

test('flagged=true returns exactly the flagged set (a non-flagged row is excluded)', async () => {
  const pool = makeListPool([flaggedDoc(), unflaggedDoc()]);
  const res = makeRes();
  await loadCollectionService(pool, async (mod) => {
    await mod.listInvoices({ query: { flagged: 'true' } }, res);
  });

  assert.equal(res.body.total, 1);
  assert.equal(res.body.invoices.length, 1);
  assert.equal(res.body.invoices[0].id, 'doc-flagged');
  assert.match(pool.dataQuery().sql, /flagged_at IS NOT NULL/);
});

test('flagged=false returns exactly the un-flagged set', async () => {
  const pool = makeListPool([flaggedDoc(), unflaggedDoc()]);
  const res = makeRes();
  await loadCollectionService(pool, async (mod) => {
    await mod.listInvoices({ query: { flagged: 'false' } }, res);
  });

  assert.equal(res.body.invoices.length, 1);
  assert.equal(res.body.invoices[0].id, 'doc-plain');
  assert.match(pool.dataQuery().sql, /flagged_at IS NULL/);
});

test('flagged composes with status and filed filters without altering them', async () => {
  const pool = makeListPool([flaggedDoc()]);
  const res = makeRes();
  await loadCollectionService(pool, async (mod) => {
    await mod.listInvoices({ query: { status: 'pending', filed: 'false', flagged: 'true' } }, res);
  });

  const sql = pool.dataQuery().sql;
  // All three conditions present and AND-composed; existing filters unchanged.
  assert.match(sql, /flagged_at IS NOT NULL/);
  assert.match(sql, /status IN \('pending', 'modified'\)/);
  assert.match(sql, /COALESCE\(filed, false\) = false/);
});

test('omitting flagged adds no flag condition (existing list behavior unchanged)', async () => {
  const pool = makeListPool([flaggedDoc(), unflaggedDoc()]);
  const res = makeRes();
  await loadCollectionService(pool, async (mod) => {
    await mod.listInvoices({ query: {} }, res);
  });

  const sql = pool.dataQuery().sql;
  assert.doesNotMatch(sql, /flagged_at IS (NOT )?NULL/);
  assert.equal(res.body.invoices.length, 2); // no flag filtering applied
});
