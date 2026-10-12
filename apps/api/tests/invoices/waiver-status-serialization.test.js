'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

// Load supabase.js with a fake lib/db so the derivation helpers can be
// exercised without a real pool (same injection flag-list-serialization uses).
function loadSupabase() {
  const dbPath = require.resolve(path.join(root, 'lib/db.js'));
  const supabasePath = require.resolve(path.join(root, 'modules/invoices/services/supabase.js'));
  const before = { db: require.cache[dbPath], supabase: require.cache[supabasePath] };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };
  delete require.cache[supabasePath];
  const mod = require(supabasePath);
  if (before.db) require.cache[dbPath] = before.db; else delete require.cache[dbPath];
  if (before.supabase) require.cache[supabasePath] = before.supabase; else delete require.cache[supabasePath];
  return mod;
}

const { deriveWaiverStatus, getVendorBypassCounts, getWaiverActionState, rowToDoc } = loadSupabase();

// Baseline row where detection WOULD require a waiver (invoice, cost type S,
// job matched, non-exempt phase) and the trigger has set the flag.
function requiredRow(overrides = {}) {
  return {
    id: 'doc-1',
    classification: 'invoice',
    cost_type: 'S',
    job_match_number: '26-401',
    phase_code: '03-100',
    lien_waiver_required: true,
    lien_waiver_status: null,
    linked_lien_waiver_id: null,
    waiver_on_document: false,
    waiver_requested_at: null,
    waiver_request_conversation_id: null,
    ...overrides,
  };
}

test('waiverStatus: required when detection flag set and nothing else', () => {
  assert.equal(deriveWaiverStatus(requiredRow()), 'required');
});

test('waiverStatus: requested when a request went out (timestamp or conversation id)', () => {
  assert.equal(deriveWaiverStatus(requiredRow({ waiver_requested_at: new Date() })), 'requested');
  assert.equal(deriveWaiverStatus(requiredRow({ waiver_request_conversation_id: 'conv-1' })), 'requested');
});

test('waiverStatus: bypassed when detection says required but flag was overridden to false', () => {
  assert.equal(deriveWaiverStatus(requiredRow({ lien_waiver_required: false })), 'bypassed');
  // A bypassed invoice with an outstanding request still reads bypassed —
  // requested only applies while the requirement is live.
  assert.equal(
    deriveWaiverStatus(requiredRow({ lien_waiver_required: false, waiver_requested_at: new Date() })),
    'bypassed'
  );
});

test('waiverStatus: attached wins over every other state (the product owner ruling)', () => {
  // over required
  assert.equal(deriveWaiverStatus(requiredRow({ linked_lien_waiver_id: 'wv-1' })), 'attached');
  // over requested
  assert.equal(
    deriveWaiverStatus(requiredRow({ linked_lien_waiver_id: 'wv-1', waiver_requested_at: new Date() })),
    'attached'
  );
  // over bypassed
  assert.equal(
    deriveWaiverStatus(requiredRow({ lien_waiver_required: false, waiver_on_document: true })),
    'attached'
  );
  // pipeline-detected waiver page also counts as attached
  assert.equal(deriveWaiverStatus(requiredRow({ lien_waiver_status: 'attached' })), 'attached');
});

test('waiverStatus: not-required when no waiver expected', () => {
  // Non-S cost type — detection never required it, flag false.
  assert.equal(deriveWaiverStatus(requiredRow({ cost_type: 'M', lien_waiver_required: false })), 'not-required');
  // Exempt phase code (mirrors DB trigger exempt list).
  assert.equal(deriveWaiverStatus(requiredRow({ phase_code: '01502', lien_waiver_required: false })), 'not-required');
  // No job match.
  assert.equal(deriveWaiverStatus(requiredRow({ job_match_number: null, lien_waiver_required: false })), 'not-required');
  // Non-invoice classifications never expect one.
  assert.equal(deriveWaiverStatus(requiredRow({ classification: 'receipt', lien_waiver_required: false })), 'not-required');
});

test('waiverStatus: not-required for contradictory legacy state (production-shaped vector)', () => {
  // lien_waiver_status is "missing" (stale legacy column) but the effective
  // requirement resolved to false — canonical waiverStatus must be not-required,
  // NOT "missing" or "required".
  assert.equal(deriveWaiverStatus(requiredRow({
    lien_waiver_required: false,
    lien_waiver_status: 'missing',
    waiver_bypassed: false,
    linked_lien_waiver_id: null,
    // wouldRequire is false because cost_type is non-S
    cost_type: 'M',
  })), 'not-required');
});

test('rowToDoc serializes waiverStatus for list/detail payloads', () => {
  const doc = rowToDoc(requiredRow({ waiver_request_conversation_id: 'conv-9' }));
  assert.equal(doc.waiverStatus, 'requested');
  const attached = rowToDoc(requiredRow({ linked_lien_waiver_id: 'wv-1' }));
  assert.equal(attached.waiverStatus, 'attached');
});

test('rowToDoc deletedBy falls back to discarded_by for discarded (non-deleted) rows', () => {
  const discarded = rowToDoc(requiredRow({
    status: 'discarded',
    deleted_at: null,
    deleted_by: null,
    discarded_by: 'retro-filter',
  }));
  assert.equal(discarded.deletedBy, 'retro-filter');

  // Soft-deleted rows keep deleted_by as the primary source.
  const deleted = rowToDoc(requiredRow({
    deleted_by: 'user@northwindcg.example',
    discarded_by: 'pipeline',
  }));
  assert.equal(deleted.deletedBy, 'user@northwindcg.example');

  // Legacy rows with neither stay null (frontend renders an em dash).
  const legacy = rowToDoc(requiredRow({ deleted_by: null, discarded_by: null }));
  assert.equal(legacy.deletedBy, null);
});

test('list SELECT carries the columns waiverStatus derivation needs; trash excludes parked waivers', () => {
  const collectionSource = fs.readFileSync(
    path.join(root, 'modules/invoices/services/invoiceCollectionService.js'),
    'utf8'
  );
  // waiver_request_conversation_id must ship in LIST_COLUMNS so the list
  // serializer can derive 'requested' without the detail round-trip.
  assert.match(collectionSource, /waiver_request_conversation_id/);
  // Parked ('linked') waivers are not junk: both the Trash list membership and
  // the stats trash_count must exclude the status.
  const linkedExclusions = collectionSource.match(/status NOT IN \(\$\{ACTIVE_DASHBOARD_STATUS_SQL\}, 'linked'\)/g) || [];
  assert.equal(linkedExclusions.length, 2, 'trash membership AND stats trash_count must both exclude linked');
});

test('W4 bypassHint: precomputed count drives show at the 5+ threshold, defaults quiet', () => {
  const row = requiredRow({ vendor_code: 'ACME01' });

  // No precomputed counts — hint stays quiet (never queried inside).
  const none = getWaiverActionState(row, {});
  assert.deepEqual(none.bypassHint, { count: 0, show: false });

  const below = getWaiverActionState(row, { vendorBypassCounts: { ACME01: 4 } });
  assert.deepEqual(below.bypassHint, { count: 4, show: false });

  const at = getWaiverActionState(row, { vendorBypassCounts: { ACME01: 5 } });
  assert.deepEqual(at.bypassHint, { count: 5, show: true });

  // Counts keyed to a different vendor never leak onto this row.
  const otherVendor = getWaiverActionState(row, { vendorBypassCounts: { OTHER: 9 } });
  assert.deepEqual(otherVendor.bypassHint, { count: 0, show: false });
});

test('W4 getVendorBypassCounts: one grouped query with attached-waiver reset semantics', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ vendor_code: 'ACME01', bypass_count: 6 }] };
    },
  };

  const counts = await getVendorBypassCounts(['ACME01', 'ACME01', '', null, 'BETA02'], db);
  assert.deepEqual(counts, { ACME01: 6 });
  assert.equal(calls.length, 1, 'exactly one grouped query per request');
  assert.deepEqual(calls[0].params, [['ACME01', 'BETA02']], 'codes deduped and cleaned');
  // Only persistent bypasses count…
  assert.match(calls[0].sql, /d\.waiver_bypassed = true/);
  // …and only those received after the vendor's most recent attached waiver
  // (attaching a waiver resets the streak).
  assert.match(calls[0].sql, /MAX\(email_received_at\) AS last_attached_at/);
  assert.match(calls[0].sql, /linked_lien_waiver_id IS NOT NULL/);
  assert.match(calls[0].sql, /latest\.last_attached_at IS NULL OR d\.email_received_at > latest\.last_attached_at/);
  assert.match(calls[0].sql, /GROUP BY d\.vendor_code/);

  // No vendor codes → no query at all.
  const empty = await getVendorBypassCounts([], db);
  assert.deepEqual(empty, {});
  assert.equal(calls.length, 1);
});

test('W4 detail endpoint precomputes bypass counts outside the serializer', () => {
  const collectionSource = fs.readFileSync(
    path.join(root, 'modules/invoices/services/invoiceCollectionService.js'),
    'utf8'
  );
  assert.match(collectionSource, /getVendorBypassCounts\(row\.vendor_code \? \[row\.vendor_code\] : \[\]\)/);
  assert.match(collectionSource, /vendorBypassCounts,/);

  // Guard the M1 atomic-review ruling: getWaiverActionState stays synchronous
  // and free of queries.
  const supabaseSource = fs.readFileSync(
    path.join(root, 'modules/invoices/services/supabase.js'),
    'utf8'
  );
  const stateFn = supabaseSource.match(/function getWaiverActionState[\s\S]*?\n}\n/)?.[0] || '';
  assert.ok(stateFn.length > 0);
  assert.doesNotMatch(stateFn, /await|\.query\(/);
});

test('W13: persisted bundle skip reason ships in list columns and the serialized doc', () => {
  const collectionSource = fs.readFileSync(
    path.join(root, 'modules/invoices/services/invoiceCollectionService.js'),
    'utf8'
  );
  assert.match(collectionSource, /waiver_auto_link_skip_reason/);

  const doc = rowToDoc(requiredRow({ waiver_auto_link_skip_reason: 'multi-waiver-bundle' }));
  assert.equal(doc.waiverAutoLinkSkipReason, 'multi-waiver-bundle');
  assert.equal(rowToDoc(requiredRow()).waiverAutoLinkSkipReason, null);
});

test('link/unlink service shelves linked waivers and restores the queue on unlink', () => {
  const linkSource = fs.readFileSync(
    path.join(root, 'modules/invoices/services/lienWaiverLinkService.js'),
    'utf8'
  );
  assert.match(linkSource, /restoreLinkedWaiverPending/);
  assert.match(linkSource, /filed = true/);
  assert.match(linkSource, /filed = false/);
  assert.match(linkSource, /filed_at = NULL/);
});
