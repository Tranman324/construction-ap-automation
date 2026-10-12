'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const webInvoices = path.resolve(root, '..', 'web', 'src', 'modules', 'accounting', 'modules', 'invoices');

// Regression fixture captured from the REAL response BEFORE the metadata change.
const PRE_CHANGE = JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'fixtures', 'classifications-metadata', 'pre-change.json'), 'utf8'),
);

// The custom classification row used when the fixture was captured — reused so
// the non-panel fields must match the fixture byte-for-byte.
const CUSTOM_ROW = {
  name: 'custom-type', label: 'Custom Type', action: 'view-only', opens_as: 'statement',
  status: 'active', added_at: new Date('2026-07-01T00:00:00.000Z'), updated_at: null, updated_by: null,
};

function loadSettingsWithCustom(customRows) {
  const dbPath = require.resolve('../../lib/db.js');
  // Re-require the whole chain (settings -> settingsService -> supabase -> lib/db)
  // so loadClassificationRows picks up the injected fake pool even when a prior
  // test already cached the real pool.
  const chain = [
    '../../modules/invoices/routes/settings.js',
    '../../modules/invoices/services/settingsService.js',
    '../../modules/invoices/services/supabase.js',
  ].map((rel) => require.resolve(rel));
  const before = { db: require.cache[dbPath], chain: chain.map((p) => require.cache[p]) };

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: Object.assign(async () => {}, {
      on() {}, supabase: {}, connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
      async query(sql) {
        if (/WHERE name = ANY/.test(sql)) return { rows: [] };
        if (/WHERE name <> ALL/.test(sql)) return { rows: customRows };
        if (/SELECT \* FROM custom_classifications ORDER BY/.test(sql)) return { rows: customRows };
        return { rows: [] };
      },
    }),
  };
  for (const p of chain) delete require.cache[p];
  const settings = require(chain[0]);
  const restore = () => {
    if (before.db) require.cache[dbPath] = before.db; else delete require.cache[dbPath];
    chain.forEach((p, i) => {
      if (before.chain[i]) require.cache[p] = before.chain[i]; else delete require.cache[p];
    });
  };
  return { settings, restore };
}

function extractBalanced(src, name, open, close) {
  const eq = src.indexOf('=', src.indexOf(name));
  const start = src.indexOf(open, eq);
  let depth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) break; }
  }
  // eslint-disable-next-line no-eval
  return eval(`(${src.slice(start, i + 1)})`);
}

// Mirror of documentRouting.ts getSurface; its faithfulness is asserted against
// the frontend source in the parity test so it cannot silently drift.
function expectedSurface(opensAs) {
  if (opensAs === 'invoice') return 'invoice_workflow';
  if (opensAs === 'other' || opensAs === null) return 'generic_panel';
  return 'document_panel';
}

test('additive-only: existing classification fields are byte-identical to the pre-change fixture', async () => {
  const { settings, restore } = loadSettingsWithCustom([CUSTOM_ROW]);
  try {
    const rows = await settings.getMergedClassifications({ limit: 100, offset: 0 });
    assert.equal(rows.length, PRE_CHANGE.length);
    for (let i = 0; i < rows.length; i += 1) {
      const { panel, ...existingFields } = rows[i];
      // Compare the actual wire shape (res.json serialization drops undefined
      // keys exactly like the captured fixture) — the true additive-only proof.
      const wireExisting = JSON.parse(JSON.stringify(existingFields));
      assert.deepEqual(wireExisting, PRE_CHANGE[i], `classification ${rows[i].name} existing fields drifted`);
      assert.ok(panel && typeof panel.surface === 'string' && typeof panel.filterGroup === 'string');
    }
  } finally {
    restore();
  }
});

test('custom (user-created) classifications carry complete non-null panel metadata', async () => {
  const withStatement = loadSettingsWithCustom([CUSTOM_ROW]);
  try {
    const rows = await withStatement.settings.getMergedClassifications({ limit: 100, offset: 0 });
    const custom = rows.find((c) => c.name === 'custom-type');
    assert.ok(custom, 'custom classification present');
    assert.equal(custom.builtIn, false);
    assert.equal(custom.panel.surface, 'document_panel'); // opensAs 'statement'
    assert.equal(custom.panel.filterGroup, 'statement');
  } finally {
    withStatement.restore();
  }

  // A custom classification with no opensAs still gets complete (non-null) metadata.
  const bareRow = { ...CUSTOM_ROW, name: 'bare-custom', opens_as: null };
  const withBare = loadSettingsWithCustom([bareRow]);
  try {
    const rows = await withBare.settings.getMergedClassifications({ limit: 100, offset: 0 });
    const bare = rows.find((c) => c.name === 'bare-custom');
    assert.equal(bare.opensAs, 'other');
    assert.equal(bare.panel.surface, 'generic_panel');
    assert.equal(bare.panel.filterGroup, 'other');
    assert.ok(bare.panel.surface !== null && bare.panel.filterGroup !== null);
  } finally {
    withBare.restore();
  }
});

test('panel metadata reproduces documentRouting + DashboardPanelFilters facts for every built-in', async () => {
  // Parity ground truth: assert the frontend getSurface branches match our mirror.
  const routingSrc = fs.readFileSync(path.join(webInvoices, 'lib', 'documentRouting.ts'), 'utf8');
  assert.match(routingSrc, /opensAs === "invoice"\)\s*return "invoice_workflow"/);
  assert.match(routingSrc, /opensAs === "other" \|\| opensAs === null\)\s*return "generic_panel"/);
  assert.match(routingSrc, /return "document_panel"/);

  const filtersSrc = fs.readFileSync(path.join(webInvoices, 'components', 'dashboard', 'DashboardPanelFilters.tsx'), 'utf8');
  const filterGroups = new Set(extractBalanced(filtersSrc, 'DASHBOARD_PANELS', '[', ']').map((p) => p.value));

  const { settings, restore } = loadSettingsWithCustom([]);
  try {
    const rows = await settings.getMergedClassifications({ limit: 100, offset: 0 });
    for (const c of rows) {
      assert.equal(c.panel.surface, expectedSurface(c.opensAs), `${c.name} surface`);
      assert.equal(c.panel.filterGroup, c.opensAs, `${c.name} filterGroup`);
      assert.ok(filterGroups.has(c.panel.filterGroup), `${c.name} filterGroup ${c.panel.filterGroup} is a real dashboard panel`);
    }
    // Every built-in is covered.
    assert.equal(rows.length, settings.BUILT_IN_CLASSIFICATIONS.length);
  } finally {
    restore();
  }
});
