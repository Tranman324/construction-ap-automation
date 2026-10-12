'use strict';

const { emitLegacyInvoiceAuditEvent, insertAuditEvent } = require('../../../lib/auditEvents');

// Only the columns the rules engine reads (resolveField) plus `id` for the
// patch UPDATE.  SELECT * pulled ~60 columns including email_body blobs,
// turning a 100-row query into ~400KB over the Supabase pooler — 10s RTT.
const RULES_PROJECTION = [
  'id',
  'vendor_name',
  'vendor_code',
  'amount',
  'description',
  'invoice_number',
  'job_match_number',
  'classification',
  'status',
  'email_from',
  'email_subject',
].join(', ');

function buildRulesApplyDocumentQuery({ scope, documentIds, includeScope }) {
  const predicates = [];
  const params = [];

  if (includeScope) {
    predicates.push(
      scope === 'all'
        ? `status NOT IN ('discarded', 'duplicate')`
        : `status = 'pending'`
    );
  }

  if (documentIds?.length) {
    params.push(documentIds);
    predicates.push(`id = ANY($${params.length})`);
  }

  return {
    text: `SELECT ${RULES_PROJECTION} FROM documents WHERE (${predicates.join(' OR ')})`,
    params,
  };
}

// Fields a rules re-run may fill in `fillOnly` mode (post-edit trigger).
// Deliberately excludes status/notes/flagged/classification/hidden/etc so a
// vendor-code edit can never discard, reclassify, or annotate a document —
// it only fills coding fields the user has not set.
const FILL_ONLY_FIELDS = new Set([
  'gl_account',
  'phase_code',
  'cost_type',
  'routing_code',
  'job_match_number',
]);

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function snakeToCamel(field) {
  return field.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function ruleChanges(document, patches) {
  return Object.fromEntries(Object.entries(patches).map(([field, value]) => [
    snakeToCamel(field),
    [document[field] ?? null, value],
  ]));
}

async function emitRulesAppliedEvent({ documentId, document, patches, matchedRules, db }) {
  if (Object.keys(patches).length === 0) return;
  await insertAuditEvent({
    type: 'invoice.classified',
    actor: { userId: null, name: 'System', role: 'pipeline' },
    target: { type: 'invoice', id: documentId },
    changes: ruleChanges(document, patches),
    summary: `Rules applied: ${matchedRules.join(', ')}`,
    module: 'invoices',
    severity: 'info',
  }, db);
}

/**
 * Re-run the active rules against ONE document and apply the resulting patches.
 * Used outside intake: after reprocess (full mode) and after vendor-code edits
 * (fillOnly mode). Mirrors the intake apply semantics (evaluateBatch +
 * buildPatchUpdate + audit `rules-applied`).
 *
 * @param {string} docId
 * @param {object} opts
 * @param {boolean} [opts.fillOnly]  - Only fill empty coding fields; never touch
 *                                     status/notes/flagged/classification.
 * @param {object}  [opts.db]        - pg pool/client (defaults to shared pool)
 * @returns {{ matched: boolean, applied: string[], patches: object }}
 */
async function applyRulesToDocumentById(docId, { fillOnly = false, db } = {}) {
  const { pool } = require('./supabase');
  const client = db || pool;

  const docResult = await client.query('SELECT * FROM documents WHERE id = $1', [docId]);
  const doc = docResult.rows[0];
  if (!doc) return { matched: false, applied: [], patches: {} };

  const rulesResult = await client.query(
    'SELECT * FROM rules WHERE is_active = true ORDER BY rule_order ASC, created_at ASC, id ASC'
  );
  if (rulesResult.rows.length === 0) return { matched: false, applied: [], patches: {} };

  const { buildPatchUpdate, evaluateBatch } = require('../scripts/rules-engine');
  const results = evaluateBatch([doc], rulesResult.rows);
  if (results.length === 0) return { matched: false, applied: [], patches: {} };

  const { patches, matchedRules } = results[0];

  if (fillOnly) {
    for (const field of Object.keys(patches)) {
      if (!FILL_ONLY_FIELDS.has(field) || !isEmptyValue(doc[field])) {
        delete patches[field];
      }
    }
  } else if (patches.classification) {
    // Rules may only set existing active classifications (same guard as intake).
    const { enforceActiveClassification } = require('./pipeline');
    patches.classification = await enforceActiveClassification(patches.classification, 'rules-rerun');
  }

  const patchUpdate = buildPatchUpdate(patches, 2);
  if (!patchUpdate.setClauses) return { matched: true, applied: [], patches: {} };

  // BE-G: rule-written fields are 'derived', stamped in the SAME statement as
  // the value write. Without this, fillOnly after a manual clear would leave a
  // stale 'manual' origin on a rule-supplied value (falsely violet). Only
  // FIELD_MAP-backed columns get origins; status/notes/etc are skipped.
  const { FIELD_MAP } = require('./invoiceEditService');
  // First mapping wins so the description column keys as 'description'
  // (FIELD_MAP also aliases notes → description).
  const COLUMN_TO_CAMEL = {};
  for (const [camel, col] of Object.entries(FIELD_MAP)) {
    if (!(col in COLUMN_TO_CAMEL)) COLUMN_TO_CAMEL[col] = camel;
  }
  const originPatch = {};
  const originAt = new Date().toISOString();
  for (const col of patchUpdate.fields) {
    const camel = COLUMN_TO_CAMEL[col];
    if (camel) originPatch[camel] = { origin: 'derived', at: originAt, by: 'rules-engine' };
  }
  const originClause = Object.keys(originPatch).length > 0
    ? `, field_origins = field_origins || $${2 + patchUpdate.values.length}::jsonb`
    : '';
  const originValues = Object.keys(originPatch).length > 0 ? [JSON.stringify(originPatch)] : [];

  await client.query(
    `UPDATE documents SET ${patchUpdate.setClauses}${originClause}, updated_at = NOW() WHERE id = $1`,
    [docId, ...patchUpdate.values, ...originValues]
  );
  await emitLegacyInvoiceAuditEvent(docId, 'rules-applied', {
    matchedRules,
    patches: patchUpdate.patches,
  }, 'rules-engine', client);
  await emitRulesAppliedEvent({
    documentId: docId,
    document: doc,
    patches: patchUpdate.patches,
    matchedRules,
    db: client,
  });

  return { matched: true, applied: patchUpdate.fields, patches: patchUpdate.patches };
}

module.exports = {
  applyRulesToDocumentById,
  buildRulesApplyDocumentQuery,
  emitRulesAppliedEvent,
  ruleChanges,
  snakeToCamel,
};
