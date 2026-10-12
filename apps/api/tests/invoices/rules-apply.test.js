'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ruleActionSchema, ruleApplySchema } = require('../../lib/schemas');
const {
  buildPatchUpdate,
  computePatches,
  evaluateDoc,
} = require('../../modules/invoices/scripts/rules-engine');
const { buildRulesApplyDocumentQuery } = require('../../modules/invoices/services/rulesApplyService');

test('rule apply schema preserves existing caller defaults', () => {
  const result = ruleApplySchema.parse({ ruleIds: ['rule-1'] });

  assert.deepEqual(result, {
    ruleIds: ['rule-1'],
    scope: 'pending',
    includeScope: true,
  });
});

test('rule apply schema is strict and requires ids for target-only mode', () => {
  assert.equal(ruleApplySchema.safeParse({ includeScope: false }).success, false);
  assert.equal(ruleApplySchema.safeParse({ includeScope: false, documentIds: [] }).success, false);
  assert.equal(ruleApplySchema.safeParse({ includeScope: true, unknown: true }).success, false);
  assert.equal(ruleApplySchema.safeParse({ scope: 'discarded' }).success, false);
});

test('target-only apply selects explicit documents regardless of status', () => {
  const query = buildRulesApplyDocumentQuery({
    scope: 'pending',
    documentIds: ['doc-current'],
    includeScope: false,
  });

  assert.match(query.text, /FROM documents WHERE \(id = ANY\(\$1\)\)/);
  assert.doesNotMatch(query.text, /SELECT \*/);
  assert.deepEqual(query.params, [['doc-current']]);
});

test('scoped apply unions explicit documents in one deduplicated SELECT', () => {
  const query = buildRulesApplyDocumentQuery({
    scope: 'pending',
    documentIds: ['doc-current', 'doc-current'],
    includeScope: true,
  });

  assert.match(
    query.text,
    /FROM documents WHERE \(status = 'pending' OR id = ANY\(\$1\)\)/
  );
  assert.doesNotMatch(query.text, /SELECT \*/);
  assert.deepEqual(query.params, [['doc-current', 'doc-current']]);
});

test('queue scope retains pending semantics and all excludes trash', () => {
  const queueQuery = buildRulesApplyDocumentQuery({
    scope: 'queue',
    includeScope: true,
  });
  const allQuery = buildRulesApplyDocumentQuery({
    scope: 'all',
    documentIds: ['doc-explicit'],
    includeScope: true,
  });

  assert.match(queueQuery.text, /FROM documents WHERE \(status = 'pending'\)/);
  assert.doesNotMatch(queueQuery.text, /SELECT \*/);
  assert.deepEqual(queueQuery.params, []);
  assert.match(
    allQuery.text,
    /FROM documents WHERE \(status NOT IN \('discarded', 'duplicate'\) OR id = ANY\(\$1\)\)/
  );
});

test('clearable rule setters require either a nonempty value or clear true', () => {
  assert.equal(ruleActionSchema.safeParse({ type: 'set_phase_code', value: '09600' }).success, true);
  assert.equal(ruleActionSchema.safeParse({ type: 'set_phase_code', clear: true }).success, true);
  assert.equal(ruleActionSchema.safeParse({ type: 'set_phase_code' }).success, false);
  assert.equal(ruleActionSchema.safeParse({ type: 'set_phase_code', value: '   ' }).success, false);
  assert.equal(
    ruleActionSchema.safeParse({ type: 'set_phase_code', value: '09600', clear: true }).success,
    false
  );
});

test('clear true is rejected for classification and non-setter actions', () => {
  assert.equal(ruleActionSchema.safeParse({ type: 'set_classification', clear: true }).success, false);
  assert.equal(ruleActionSchema.safeParse({ type: 'auto_approve', clear: true }).success, false);
  assert.equal(ruleActionSchema.safeParse({ type: 'set_classification', value: 'invoice' }).success, true);
});

test('computePatches emits a persisted null for phase-code clearing', () => {
  const patches = computePatches(
    { phase_code: '09600' },
    [{ type: 'set_phase_code', clear: true }]
  );
  const update = buildPatchUpdate(patches);

  assert.deepEqual(patches, { phase_code: null });
  assert.equal(update.setClauses, 'phase_code = $2');
  assert.deepEqual(update.values, [null]);
});

test('auto-discard removes a linked lien waiver from the document shelf', () => {
  const patches = computePatches(
    { classification: 'lien-waiver', linked_lien_waiver_id: 'invoice-1' },
    [{ type: 'auto_discard' }]
  );
  const update = buildPatchUpdate(patches);

  assert.equal(patches.status, 'discarded');
  assert.equal(patches.filed, undefined);
  assert.equal(patches.filed_at, undefined);
  assert.doesNotMatch(update.setClauses, /filed/);
});

test('classification rules do not emit a type change for a linked document', () => {
  const patches = computePatches(
    { classification: 'lien-waiver', linked_lien_waiver_id: 'invoice-1' },
    [{ type: 'set_classification', value: 'invoice' }]
  );

  assert.deepEqual(patches, {});
});

test('evaluateDoc emits a vendor null patch while preserving rule matching', () => {
  const result = evaluateDoc(
    { status: 'pending', vendor_code: 'VENDOR01' },
    [{
      id: 'rule-clear-vendor',
      is_active: true,
      stop_on_match: false,
      criteria: [{ field: 'status', operator: 'equals', values: ['pending'] }],
      actions: [{ type: 'set_vendor', clear: true }],
    }]
  );

  assert.deepEqual(result, {
    patches: { vendor_code: null },
    matchedRules: ['rule-clear-vendor'],
  });
});

test('legacy setter actions continue to emit their value', () => {
  assert.deepEqual(
    computePatches({}, [{ type: 'set_vendor', value: 'VENDOR02' }]),
    { vendor_code: 'VENDOR02' }
  );
});

test('negative string operators require every configured value to miss', () => {
  const doc = { vendor_name: 'Acme Concrete' };

  assert.equal(evaluateDoc(doc, [{
    id: 'not-contains',
    is_active: true,
    stop_on_match: false,
    criteria: [{ field: 'vendor_name', operator: 'not_contains', values: ['Acme', 'Stone'] }],
    actions: [{ type: 'flag' }],
  }]).matchedRules.length, 0);

  assert.equal(evaluateDoc(doc, [{
    id: 'not-equals',
    is_active: true,
    stop_on_match: false,
    criteria: [{ field: 'vendor_name', operator: 'not_equals', values: ['Acme Concrete', 'Other Vendor'] }],
    actions: [{ type: 'flag' }],
  }]).matchedRules.length, 0);

  assert.deepEqual(evaluateDoc(doc, [{
    id: 'all-miss',
    is_active: true,
    stop_on_match: false,
    criteria: [{ field: 'vendor_name', operator: 'not_contains', values: ['Stone', 'Steel'] }],
    actions: [{ type: 'flag' }],
  }]), {
    patches: { flagged: true },
    matchedRules: ['all-miss'],
  });
});
