'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
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
  const resolvedPath = require.resolve(path.join(root, relativePath));
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

// ── A faithful in-memory evaluator for the exact SQL these endpoints generate, so
// the fake pool truly EXECUTES the WHERE + ORDER BY the impl builds (the keyset
// predicate, the filter from buildInvoiceListFilter, and the ORDER BY from
// getInvoiceOrder). This is what makes sequence-identity and the ORDER-BY red-run
// meaningful rather than tautological. ──
function tokenize(s) {
  const re = /\s+|('(?:[^']|'')*')|(\$\d+)|(>=|<=|<>|=|>|<)|([(),])|([A-Za-z_][A-Za-z0-9_]*)|(-?\d+\.?\d*)/g;
  const toks = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    if (/^\s+$/.test(m[0])) continue;
    if (m[1]) toks.push({ t: 'str', v: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2]) toks.push({ t: 'param', v: parseInt(m[2].slice(1), 10) });
    else if (m[3]) toks.push({ t: 'op', v: m[3] });
    else if (m[4]) toks.push({ t: 'punct', v: m[4] });
    else if (m[5]) toks.push({ t: 'word', v: m[5] });
    else if (m[6]) toks.push({ t: 'num', v: parseFloat(m[6]) });
  }
  return toks;
}

function makePredicate(whereSql) {
  const toks = tokenize(whereSql);
  let pos = 0;
  const peek = () => toks[pos];
  const nextTok = () => toks[pos++];
  const isWord = (w) => peek() && peek().t === 'word' && peek().v.toUpperCase() === w;
  const expectPunct = (v) => { const t = nextTok(); if (!t || t.v !== v) throw new Error('expected ' + v); };

  function parseOr() {
    let left = parseAnd();
    while (isWord('OR')) { nextTok(); const r = parseAnd(); const l = left; left = (row, p) => l(row, p) || r(row, p); }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (isWord('AND')) { nextTok(); const r = parseNot(); const l = left; left = (row, p) => l(row, p) && r(row, p); }
    return left;
  }
  function parseNot() {
    if (isWord('NOT') && !(toks[pos + 1] && toks[pos + 1].t === 'word' && toks[pos + 1].v.toUpperCase() === 'IN')) {
      nextTok(); const inner = parsePrimary(); return (row, p) => !inner(row, p);
    }
    return parsePrimary();
  }
  function parsePrimary() {
    if (peek() && peek().t === 'punct' && peek().v === '(') { nextTok(); const e = parseOr(); expectPunct(')'); return e; }
    return parseComparison();
  }
  function resolveOperand() {
    const t = nextTok();
    if (t.t === 'param') return (row, p) => p[t.v - 1];
    if (t.t === 'str') return () => t.v;
    if (t.t === 'num') return () => t.v;
    if (t.t === 'word') {
      const col = t.v;
      return (row) => (row[col] === undefined ? null : row[col]);
    }
    throw new Error('bad operand ' + JSON.stringify(t));
  }
  function parseComparison() {
    const left = resolveOperand();
    if (isWord('IS')) {
      nextTok();
      let negate = false;
      if (isWord('NOT')) { nextTok(); negate = true; }
      if (!isWord('NULL')) throw new Error('expected NULL');
      nextTok();
      return (row, p) => { const v = left(row, p); const nul = v === null || v === undefined; return negate ? !nul : nul; };
    }
    let negateIn = false;
    if (isWord('NOT')) { nextTok(); negateIn = true; }
    if (isWord('IN')) {
      nextTok(); expectPunct('(');
      const vals = [resolveOperand()];
      while (peek() && peek().v === ',') { nextTok(); vals.push(resolveOperand()); }
      expectPunct(')');
      return (row, p) => {
        const v = left(row, p);
        if (v === null || v === undefined) return false;
        const hit = vals.some((fn) => fn(row, p) === v);
        return negateIn ? !hit : hit;
      };
    }
    if (isWord('ILIKE')) {
      nextTok(); const right = resolveOperand();
      return (row, p) => {
        const v = left(row, p); const pat = right(row, p);
        if (v === null || v === undefined || pat == null) return false;
        const rx = new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return rx.test(String(v));
      };
    }
    const t = peek();
    if (t && t.t === 'op') {
      nextTok(); const right = resolveOperand(); const op = t.v;
      return (row, p) => {
        const a = left(row, p); const b = right(row, p);
        if (a === null || a === undefined || b === null || b === undefined) return false; // NULL comparison → unknown → excluded
        if (op === '=') return a === b || String(a) === String(b);
        if (op === '>') return a > b;
        if (op === '<') return a < b;
        if (op === '>=') return a >= b;
        if (op === '<=') return a <= b;
        if (op === '<>') return a !== b;
        return false;
      };
    }
    throw new Error('bad comparison near ' + JSON.stringify(peek()));
  }
  return parseOr();
}

function makeComparator(orderBySql) {
  const terms = orderBySql.split(',').map((term) => {
    const parts = term.trim().split(/\s+/);
    const col = parts[0];
    const dir = (parts[1] || 'ASC').toUpperCase();
    const nIdx = parts.findIndex((x) => x.toUpperCase() === 'NULLS');
    const nulls = nIdx >= 0 ? parts[nIdx + 1].toUpperCase() : (dir === 'ASC' ? 'LAST' : 'FIRST');
    return { col, dir, nulls };
  });
  return (a, b) => {
    for (const { col, dir, nulls } of terms) {
      const va = a[col] === undefined ? null : a[col];
      const vb = b[col] === undefined ? null : b[col];
      const na = va === null; const nb = vb === null;
      if (na && nb) continue;
      if (na || nb) return (na ? (nulls === 'FIRST' ? -1 : 1) : (nulls === 'FIRST' ? 1 : -1));
      if (va < vb) return dir === 'DESC' ? 1 : -1;
      if (va > vb) return dir === 'DESC' ? -1 : 1;
    }
    return 0;
  };
}

function makePool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      // Anchor fetch — the impl selects the key as ::text (the exact wire value;
      // see the microsecond-truncation regression test). Mirror Postgres by
      // stringifying non-null keys.
      const anchorM = sql.match(/^SELECT id, (\w+)::text AS sort_key FROM documents WHERE id = \$1/);
      if (anchorM) {
        const col = anchorM[1];
        const row = rows.find((r) => r.id === params[0]);
        const key = row && row[col] !== undefined && row[col] !== null ? String(row[col]) : null;
        return { rows: row ? [{ id: row.id, sort_key: key }] : [] };
      }
      if (/FROM documents/.test(sql)) {
        let result = rows.slice();
        const whereM = sql.match(/FROM documents\s+WHERE ([\s\S]+?)(?: ORDER BY| GROUP BY| LIMIT|$)/);
        if (whereM) {
          const pred = makePredicate(whereM[1]);
          result = result.filter((r) => pred(r, params));
        }
        if (/^\s*SELECT COUNT/i.test(sql)) return { rows: [{ count: String(result.length) }] };
        const orderM = sql.match(/ORDER BY ([\s\S]+?)(?: LIMIT|$)/);
        if (orderM) result = result.sort(makeComparator(orderM[1]));
        const limitParamM = sql.match(/LIMIT \$(\d+)/);
        const limitLitM = sql.match(/LIMIT (\d+)/);
        const offsetParamM = sql.match(/OFFSET \$(\d+)/);
        const offset = offsetParamM ? Number(params[Number(offsetParamM[1]) - 1]) : 0;
        const limit = limitParamM ? Number(params[Number(limitParamM[1]) - 1]) : (limitLitM ? Number(limitLitM[1]) : Infinity);
        result = result.slice(offset, offset + limit);
        return { rows: result.map((r) => ({ ...r })) };
      }
      return { rows: [] };
    },
  };
}

function loadService(pool) {
  return withMockedModules({
    './supabase': { pool, rowToDoc: (v) => v },
    './activityService': { getUnreadAggregates: async () => ({ unreadReplies: 0, unreadComments: 0 }) },
  }, async () => freshRequire('modules/invoices/services/invoiceCollectionService.js'));
}

function makeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

async function listOrder(mod, query) {
  const res = makeRes();
  await mod.listInvoices({ query }, res);
  return res.body.invoices.map((invoice) => invoice.id);
}

async function neighbors(mod, id, query = {}) {
  const res = makeRes();
  await mod.getInvoiceNeighbors({ params: { id }, query }, res);
  return res;
}

// Walk the whole set forward via `next` from the first list item; assert it
// reproduces the list order exactly, every `prev` points back, and — the 4.9
// additive extension — `position` equals the list index + 1 and `total` equals
// the filtered set size at every anchor.
async function assertSequenceIdentity(mod, rows, query) {
  const order = await listOrder(mod, query);
  assert.ok(order.length >= 3, 'need a non-trivial sequence');
  const walk = [order[0]];
  for (let i = 0; i < order.length; i++) {
    const res = await neighbors(mod, order[i], query);
    assert.equal(res.statusCode, 200);
    // prev points at the previous list item (null at the head).
    assert.equal(res.body.prev, i === 0 ? null : order[i - 1], `prev @${i}`);
    // next points at the following list item (null at the tail).
    assert.equal(res.body.next, i === order.length - 1 ? null : order[i + 1], `next @${i}`);
    // position == 1-based list index; total == filtered set size (N of M).
    assert.equal(res.body.position, i + 1, `position @${i}`);
    assert.equal(res.body.total, order.length, `total @${i}`);
    if (res.body.next !== null) walk.push(res.body.next);
  }
  assert.deepEqual(walk, order, 'forward walk via next == list order');
  return order;
}

function doc(id, over = {}) {
  return {
    id, status: 'pending', deleted_at: null, filed: false, flagged: false, flagged_at: null,
    classification: 'invoice', vendor_name: null, invoice_number: null, job_match_number: null,
    amount: null, queued_at: null, ...over,
  };
}

// Fixtures with distinct queued_at (the default `date` sort key).
const SET = [
  doc('d1', { queued_at: '2026-07-01T00:00:00.000Z', amount: 300 }),
  doc('d2', { queued_at: '2026-07-02T00:00:00.000Z', amount: 100 }),
  doc('d3', { queued_at: '2026-07-03T00:00:00.000Z', amount: 100 }), // dup amount → id tiebreak
  doc('d4', { queued_at: '2026-07-04T00:00:00.000Z', amount: null }), // null amount → NULLS positioning
  doc('d5', { queued_at: '2026-07-05T00:00:00.000Z', amount: 500 }),
];

test('sequence identity vs the list — default date sort, ASC and DESC', async () => {
  const mod = await loadService(makePool(SET));
  await assertSequenceIdentity(mod, SET, { status: 'pending' });
  await assertSequenceIdentity(mod, SET, { status: 'pending', sortDir: 'desc' });
});

test('sequence identity vs the list — amount sort exercises NULLS + id tiebreak, both directions', async () => {
  const mod = await loadService(makePool(SET));
  await assertSequenceIdentity(mod, SET, { status: 'pending', sort: 'amount' });
  await assertSequenceIdentity(mod, SET, { status: 'pending', sort: 'amount', sortDir: 'desc' });
});

test('filter composition — search + flagged=true narrows the walked set identically to the list', async () => {
  const rows = [
    doc('f1', { queued_at: '2026-07-01T00:00:00.000Z', vendor_name: 'ACME', flagged_at: '2026-07-01T00:00:00.000Z' }),
    doc('f2', { queued_at: '2026-07-02T00:00:00.000Z', vendor_name: 'OTHER', flagged_at: '2026-07-02T00:00:00.000Z' }),
    doc('f3', { queued_at: '2026-07-03T00:00:00.000Z', vendor_name: 'ACME', flagged_at: null }),          // not flagged
    doc('f4', { queued_at: '2026-07-04T00:00:00.000Z', vendor_name: 'ACME', flagged_at: '2026-07-04T00:00:00.000Z' }),
    doc('f5', { queued_at: '2026-07-05T00:00:00.000Z', vendor_name: 'ACME', flagged_at: '2026-07-05T00:00:00.000Z' }),
  ];
  const mod = await loadService(makePool(rows));
  const query = { status: 'pending', flagged: 'true', search: 'ACME' };
  const order = await listOrder(mod, query);
  assert.deepEqual(order, ['f1', 'f4', 'f5']); // f2 wrong vendor, f3 not flagged
  await assertSequenceIdentity(mod, rows, query);
});

test('anchor out of the filtered set still yields the correct next/prev (post-action auto-advance)', async () => {
  const rows = [
    doc('a1', { queued_at: '2026-07-01T00:00:00.000Z', status: 'pending' }),
    doc('a2', { queued_at: '2026-07-02T00:00:00.000Z', status: 'approved' }), // the just-actioned anchor
    doc('a3', { queued_at: '2026-07-03T00:00:00.000Z', status: 'pending' }),
    doc('a4', { queued_at: '2026-07-04T00:00:00.000Z', status: 'pending' }),
  ];
  const mod = await loadService(makePool(rows));
  // Filter is status=pending; anchor a2 is approved (no longer in the set) but sits
  // positionally between a1 and a3 → next must be a3, prev a1.
  const res = await neighbors(mod, 'a2', { status: 'pending' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.prev, 'a1');
  assert.equal(res.body.next, 'a3');
  // Out-of-set anchor has no rank → position null, but total still counts the
  // filtered set (a1, a3, a4).
  assert.equal(res.body.position, null);
  assert.equal(res.body.total, 3);
});

test('position/total agree with the list index+1 and count for an in-set anchor', async () => {
  const mod = await loadService(makePool(SET));
  const order = await listOrder(mod, { status: 'pending' });
  for (let i = 0; i < order.length; i++) {
    const res = await neighbors(mod, order[i], { status: 'pending' });
    assert.equal(res.body.position, i + 1);
    assert.equal(res.body.total, order.length);
  }
  // Additive regression: prev/next are still present and unchanged alongside the
  // new position/total fields.
  const mid = await neighbors(mod, order[2], { status: 'pending' });
  assert.deepEqual(Object.keys(mid.body).sort(), ['next', 'position', 'prev', 'total']);
  assert.equal(mid.body.prev, order[1]);
  assert.equal(mid.body.next, order[3]);
});

test('first item has null prev, last item has null next', async () => {
  const mod = await loadService(makePool(SET));
  const order = await listOrder(mod, { status: 'pending' });
  const first = await neighbors(mod, order[0], { status: 'pending' });
  assert.equal(first.body.prev, null);
  assert.equal(first.body.next, order[1]);
  const last = await neighbors(mod, order[order.length - 1], { status: 'pending' });
  assert.equal(last.body.next, null);
  assert.equal(last.body.prev, order[order.length - 2]);
});

test('a hard-deleted / nonexistent anchor returns 404', async () => {
  const mod = await loadService(makePool(SET));
  const res = await neighbors(mod, 'ghost', { status: 'pending' });
  assert.equal(res.statusCode, 404);
});

// ── Regression: microsecond-precision sort keys must not stall the walk ──
// Postgres stores timestamptz with microseconds; node-postgres parses it into a
// JS Date, which only carries milliseconds. The anchor key used to be fetched as
// the bare column, so a doc queued at ...15.354786 came back as ...15.354 and,
// bound into the keyset predicate, satisfied its own `col > $key` — `next`
// returned the anchor itself and Prev/Next stuck in place (prod doc
// doc-1783982415645-a6bo, 2026-07-23). The impl now selects the key as ::text.
// This pool keeps the driver's lossy behavior on the OLD SQL shape, so a
// regression to the bare-column fetch re-trips the truncation and fails the
// walk (executed red-run: reverting the ::text fetch reproduces next == anchor).
const MICRO_SET = [
  doc('m1', { queued_at: '2026-07-13 22:40:15.354786+00' }),
  doc('m2', { queued_at: '2026-07-13 22:40:15.354999+00' }),
  doc('m3', { queued_at: '2026-07-14 09:01:02.000123+00' }),
];

function makeMicrosecondPool(rows) {
  const inner = makePool(rows);
  return {
    calls: inner.calls,
    async query(sql, params = []) {
      const bareAnchor = sql.match(/^SELECT id, (\w+) AS sort_key FROM documents WHERE id = \$1/);
      if (bareAnchor) {
        // Old SQL shape → simulate the driver's Date round-trip: fractional
        // seconds truncated to milliseconds.
        const col = bareAnchor[1];
        const row = rows.find((r) => r.id === params[0]);
        const key = row && row[col] != null ? String(row[col]).replace(/(\.\d{3})\d+/, '$1') : null;
        return { rows: row ? [{ id: row.id, sort_key: key }] : [] };
      }
      return inner.query(sql, params);
    },
  };
}

test('microsecond timestamps: full walk, and next/prev never equal the anchor', async () => {
  const mod = await loadService(makeMicrosecondPool(MICRO_SET));
  await assertSequenceIdentity(mod, MICRO_SET, { status: 'pending' });
  await assertSequenceIdentity(mod, MICRO_SET, { status: 'pending', sortDir: 'desc' });
  for (const d of MICRO_SET) {
    const res = await neighbors(mod, d.id, { status: 'pending' });
    assert.notEqual(res.body.next, d.id, `next self-reference @${d.id}`);
    assert.notEqual(res.body.prev, d.id, `prev self-reference @${d.id}`);
  }
});
