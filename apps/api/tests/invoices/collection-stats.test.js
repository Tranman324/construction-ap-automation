'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function loadInvoiceCollectionServiceWithPool(pool) {
  const modulePath = require.resolve(path.join(root, 'modules/invoices/services/invoiceCollectionService.js'));
  const supabasePath = require.resolve(path.join(root, 'modules/invoices/services/supabase.js'));
  const activityPath = require.resolve(path.join(root, 'modules/invoices/services/activityService.js'));
  const previousSupabase = require.cache[supabasePath];
  const previousActivity = require.cache[activityPath];

  delete require.cache[modulePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      pool,
      rowToDoc: (row) => row,
    },
  };
  require.cache[activityPath] = {
    id: activityPath,
    filename: activityPath,
    loaded: true,
    exports: { getUnreadAggregates: async () => ({ unreadReplies: 0, unreadComments: 0 }) },
  };

  const mod = require(modulePath);

  return {
    mod,
    cleanup() {
      delete require.cache[modulePath];
      if (previousSupabase) {
        require.cache[supabasePath] = previousSupabase;
      } else {
        delete require.cache[supabasePath];
      }
      if (previousActivity) {
        require.cache[activityPath] = previousActivity;
      } else {
        delete require.cache[activityPath];
      }
    },
  };
}

function makeRes() {
  return {
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
}

function makeStatsPool(statusRows, scalarRow = {}, dashboardRow = {}) {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/GROUP BY status/.test(sql)) {
        return { rows: statusRows };
      }
      if (/today_count/.test(sql)) {
        return {
          rows: [{
            today_count: '0',
            avg_conf: null,
            err_count: '0',
            ...scalarRow,
          }],
        };
      }
      if (/active_count/.test(sql)) {
        return {
          rows: [{
            active_count: '0',
            trash_count: '0',
            shelf_count: '0',
            ...dashboardRow,
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  return { pool, calls };
}

async function getStatsWithRows(statusRows, scalarRow, dashboardRow, query = {}) {
  const { pool, calls } = makeStatsPool(statusRows, scalarRow, dashboardRow);
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.getInvoiceStats({ query }, res);
  } finally {
    cleanup();
  }

  return { res, calls };
}

test('getInvoiceStats exposes dashboard bucket totals with modified counted as pending', async () => {
  const { res, calls } = await getStatsWithRows([
    { status: 'pending', count: '5', total_amount: '100.50' },
    { status: 'modified', count: '2', total_amount: '10.00' },
    { status: 'approved', count: '3', total_amount: '40.00' },
    { status: 'submitted', count: '2', total_amount: '80.00' },
    { status: 'discarded', count: '1', total_amount: '20.00' },
    { status: 'duplicate', count: '1', total_amount: '30.00' },
    { status: 'rejected', count: '2', total_amount: '0.00' },
  ], {
    today_count: '6',
    avg_conf: '0.91234',
    err_count: '4',
  }, {
    active_count: '12',
    trash_count: '4',
    shelf_count: '7',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 23);
  assert.equal(res.body.globalTotal, 23);
  assert.equal(res.body.activeTotal, 12);
  assert.equal(res.body.trashTotal, 4);
  assert.equal(res.body.shelfTotal, 7);
  assert.equal(res.body.discarded, 1);
  assert.equal(res.body.duplicate, 1);
  assert.equal(res.body.pending, 7);
  assert.equal(res.body.approved, 3);
  assert.equal(res.body.submitted, 2);
  assert.equal(res.body.errors, 4);
  assert.equal(res.body.todayProcessed, 6);
  assert.equal(res.body.avgConfidence, 0.91);
  assert.equal(calls.length, 3);
});

test('getInvoiceStats shelf badge counts only the statuses the Documents All list shows', async () => {
  const { calls } = await getStatsWithRows([], undefined, {});
  const dashboardSql = calls.find((c) => /shelf_count/.test(c.sql)).sql;
  const shelfClause = dashboardSql.slice(dashboardSql.lastIndexOf('COUNT(*) FILTER'), dashboardSql.indexOf('AS shelf_count'));
  assert.match(shelfClause, /filed = true/);
  assert.match(shelfClause, /status IN \('pending', 'modified', 'approved', 'submitted'\)/);
});

test('getInvoiceStats treats missing discarded and duplicate counts as zero for activeTotal', async () => {
  const { res } = await getStatsWithRows([
    { status: 'pending', count: '4', total_amount: '50.00' },
    { status: 'reviewed', count: '2', total_amount: '25.00' },
  ], undefined, {
    active_count: '4',
    trash_count: '2',
    shelf_count: '0',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 6);
  assert.equal(res.body.globalTotal, 6);
  assert.equal(res.body.activeTotal, 4);
  assert.equal(res.body.trashTotal, 2);
  assert.equal(res.body.shelfTotal, 0);
  assert.equal(res.body.discarded, 0);
  assert.equal(res.body.duplicate, 0);
});

test('getInvoiceStats scopes status and dashboard totals to a parameterized panel group', async () => {
  const { res, calls } = await getStatsWithRows([], undefined, {
    active_count: '2',
    trash_count: '3',
    shelf_count: '4',
  }, { panel: 'other' });

  assert.equal(res.body.globalTotal, 9);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.match(call.sql, /custom_classifications\.opens_as/);
    assert.match(call.sql, /= \$1/);
    assert.equal(call.params[0], 'other');
  }
  assert.match(calls[1].sql, /queued_at::date = \$2/);
  assert.equal(calls[1].params.length, 2);
});

function makeCollectionPool({ count = '3', rows = [] } = {}) {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT COUNT\(\*\)/.test(sql)) {
        return { rows: [{ count }] };
      }
      if (/SELECT\s+id, classification/.test(sql)) {
        return { rows };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  return { pool, calls };
}

test('listInvoices maps all and pending tabs to active dashboard buckets', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const allRes = makeRes();
  const pendingRes = makeRes();

  try {
    await mod.listInvoices({ query: { status: 'all', filed: 'false' } }, allRes);
    await mod.listInvoices({ query: { status: 'pending', filed: 'false' } }, pendingRes);
  } finally {
    cleanup();
  }

  assert.match(calls[0].sql, /COALESCE\(filed, false\) = false/);
  assert.match(calls[0].sql, /status IN \('pending', 'modified', 'approved', 'submitted'\)/);
  assert.match(calls[2].sql, /status IN \('pending', 'modified'\)/);
});

test('listInvoices global search ignores dashboard filters and marks Trash membership', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listInvoices({ query: {
      scope: 'global', search: 'acme', status: 'approved', filed: 'false',
      panel: 'invoice', classification: 'invoice', flagged: 'true', limit: 25,
    } }, res);
  } finally {
    cleanup();
  }

  const [countCall, dataCall] = calls;
  assert.match(countCall.sql, /WHERE \(\s*vendor_name ILIKE \$1/);
  assert.deepEqual(countCall.params, ['%acme%']);
  assert.doesNotMatch(countCall.sql, /deleted_at IS NULL/);
  assert.doesNotMatch(countCall.sql, /status = \$\d/);
  assert.doesNotMatch(countCall.sql, /COALESCE\(filed, false\) = false/);
  assert.match(dataCall.sql, /AS is_trash/);
  assert.match(dataCall.sql, /deleted_at IS NOT NULL OR/);
  assert.deepEqual(dataCall.params, ['%acme%', 25, 0]);
});

test('listInvoices retains ordinary deleted, lifecycle, shelf, and panel filters without global scope', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listInvoices({ query: {
      status: 'approved', filed: 'true', panel: 'invoice', search: 'acme', limit: 25,
    } }, res);
  } finally {
    cleanup();
  }

  const [countCall, dataCall] = calls;
  for (const call of [countCall, dataCall]) {
    assert.match(call.sql, /deleted_at IS NULL/);
    assert.match(call.sql, /filed = true/);
    assert.match(call.sql, /status = \$1/);
    assert.match(call.sql, /custom_classifications\.name = documents\.classification/);
    assert.doesNotMatch(call.sql, /AS is_trash/);
  }
  assert.deepEqual(countCall.params, ['approved', 'invoice', '%acme%']);
  assert.deepEqual(dataCall.params, ['approved', 'invoice', '%acme%', 25, 0]);
});

test('listInvoices combines exact classification and effective panel filters with count/data parity', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listInvoices({ query: { classification: 'custom-billing', panel: 'invoice' } }, res);
  } finally {
    cleanup();
  }

  assert.match(calls[0].sql, /classification = \$1/);
  assert.match(calls[0].sql, /custom_classifications\.name = documents\.classification/);
  assert.match(calls[0].sql, /custom_classifications\.opens_as IN \('invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other'\)/);
  assert.match(calls[0].sql, /ELSE 'other'/);
  assert.match(calls[0].sql, /documents\.classification IN \('invoice', 'pay-application', 'purchase-order', 'credit-memo'\) THEN 'invoice'/);
  assert.match(calls[0].sql, /= \$2/);
  assert.deepEqual(calls[0].params, ['custom-billing', 'invoice']);
  assert.deepEqual(calls[1].params, ['custom-billing', 'invoice', 50, 0]);

  const countWhere = calls[0].sql.slice(calls[0].sql.search(/FROM documents\s+WHERE/)).replace(/\s+/g, ' ').trim();
  const dataWhere = calls[1].sql.slice(calls[1].sql.search(/FROM documents\s+WHERE/), calls[1].sql.indexOf('ORDER BY')).replace(/\s+/g, ' ').trim();
  assert.equal(dataWhere, countWhere);
});

test('listInvoices computes page offsets only when offset is omitted and honors explicit offset precedence', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ count: '4' }] };
      return { rows: [] };
    },
  };
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const pageTwo = makeRes();
  const explicitOffset = makeRes();

  try {
    await mod.listInvoices({ query: { page: 2, limit: 2 } }, pageTwo);
    await mod.listInvoices({ query: { page: 2, limit: 2, offset: 0 } }, explicitOffset);
  } finally {
    cleanup();
  }

  const dataCalls = calls.filter((call) => /SELECT\s+id, classification/.test(call.sql));
  assert.deepEqual(dataCalls[0].params, [2, 2]);
  assert.deepEqual(dataCalls[1].params, [2, 0]);
  assert.equal(pageTwo.body.page, 2);
  assert.equal(explicitOffset.body.page, 1);
});

test('invoice list appends id as a stable tie-breaker across offset pages', async () => {
  const calls = [];
  const pages = {
    0: [{ id: 'doc-d', vendor_name: 'Acme', invoice_number: '4', status: 'pending', amount: '4' }, { id: 'doc-c', vendor_name: 'Acme', invoice_number: '3', status: 'pending', amount: '3' }],
    2: [{ id: 'doc-b', vendor_name: 'Acme', invoice_number: '2', status: 'pending', amount: '2' }, { id: 'doc-a', vendor_name: 'Acme', invoice_number: '1', status: 'pending', amount: '1' }],
  };
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ count: '4' }] };
      return { rows: pages[params.at(-1)] || [] };
    },
  };
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const firstList = makeRes(); const secondList = makeRes();

  try {
    await mod.listInvoices({ query: { sort: 'vendor', sortDir: 'desc', limit: '2', offset: '0' } }, firstList);
    await mod.listInvoices({ query: { sort: 'vendor', sortDir: 'desc', limit: '2', offset: '2' } }, secondList);
  } finally {
    cleanup();
  }

  const pageIds = [
    ...firstList.body.invoices.map((row) => row.id),
    ...secondList.body.invoices.map((row) => row.id),
  ];
  assert.equal(new Set(pageIds).size, 4);
  for (const call of calls.filter((call) => /ORDER BY vendor_name DESC NULLS FIRST/.test(call.sql))) {
    assert.match(call.sql, /ORDER BY vendor_name DESC NULLS FIRST, id DESC/);
  }
});

test('listDeletedInvoices treats non-active queue statuses and soft-deleted rows as trash', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listDeletedInvoices({ query: {} }, res);
  } finally {
    cleanup();
  }

  assert.equal(res.statusCode, 200);
  assert.match(calls[0].sql, /deleted_at IS NOT NULL OR/);
  assert.match(calls[0].sql, /COALESCE\(filed, false\) = false/);
  // 'linked' = parked waiver whose invoice was approved — not trash.
  assert.match(calls[0].sql, /status NOT IN \('pending', 'modified', 'approved', 'submitted', 'linked'\)/);
  assert.doesNotMatch(calls[0].sql, /ILIKE/);
  assert.deepEqual(calls[0].params, []);
  assert.match(calls[1].sql, /LIMIT \$1 OFFSET \$2/);
  assert.deepEqual(calls[1].params, [50, 0]);
  assert.equal(res.body.total, 3);
});

test('listDeletedInvoices applies trimmed parameterized search to count and data queries', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listDeletedInvoices({ query: { search: '  Acme  ', limit: '25', offset: '10' } }, res);
  } finally {
    cleanup();
  }

  const searchColumns = [
    'vendor_name',
    'vendor_code',
    'matched_vendor_name',
    'invoice_number',
    'job_number',
    'job_match_number',
    'email_from',
    'email_subject',
    'description',
  ];
  for (const column of searchColumns) {
    assert.match(calls[0].sql, new RegExp(`${column} ILIKE \\$1`));
    assert.match(calls[1].sql, new RegExp(`${column} ILIKE \\$1`));
  }
  const countWhere = calls[0].sql.slice(calls[0].sql.search(/FROM documents\s+WHERE/)).replace(/\s+/g, ' ').trim();
  const dataWhere = calls[1].sql.slice(calls[1].sql.search(/FROM documents\s+WHERE/), calls[1].sql.indexOf('ORDER BY')).replace(/\s+/g, ' ').trim();
  assert.equal(dataWhere, countWhere);
  assert.deepEqual(calls[0].params, ['%Acme%']);
  assert.deepEqual(calls[1].params, ['%Acme%', 25, 10]);
  assert.match(calls[1].sql, /LIMIT \$2 OFFSET \$3/);
});

test('listDeletedInvoices scopes count and data to panel before parameterized search', async () => {
  const { pool, calls } = makeCollectionPool();
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listDeletedInvoices({ query: { panel: 'other', search: ' legacy ' } }, res);
  } finally {
    cleanup();
  }

  assert.match(calls[0].sql, /custom_classifications\.opens_as/);
  assert.match(calls[0].sql, /= \$1/);
  assert.match(calls[0].sql, /vendor_name ILIKE \$2/);
  assert.deepEqual(calls[0].params, ['other', '%legacy%']);
  assert.deepEqual(calls[1].params, ['other', '%legacy%', 50, 0]);
  assert.match(calls[1].sql, /LIMIT \$3 OFFSET \$4/);
});

test('listDeletedInvoices returns an empty result for a search with no matches', async () => {
  const { pool } = makeCollectionPool({ count: '0' });
  const { mod, cleanup } = loadInvoiceCollectionServiceWithPool(pool);
  const res = makeRes();

  try {
    await mod.listDeletedInvoices({ query: { search: 'missing' } }, res);
  } finally {
    cleanup();
  }

  assert.deepEqual(res.body, { invoices: [], total: 0, limit: 50, offset: 0 });
});
