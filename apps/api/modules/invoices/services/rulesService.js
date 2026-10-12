'use strict';

const { pool } = require('./supabase');
const { emitLegacyInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { buildRulesApplyDocumentQuery } = require('./rulesApplyService');
const { withTransaction } = require('./transaction');
const { buildPatchUpdate, evaluateBatch } = require('../scripts/rules-engine');

async function listRules({ limit, offset }) {
  const result = await pool.query(
    'SELECT * FROM rules ORDER BY rule_order ASC, created_at ASC, id ASC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return result.rows;
}

// `db` is an optional transaction client (defaults to the shared pool) so
// create can run inside the atomic create+apply transaction.
async function createRule({ createdBy, name, isActive, order, stopOnMatch, shared, criteria, actions, db = pool }) {
  let ruleOrder = order;
  if (ruleOrder == null) {
    const maxResult = await db.query('SELECT COALESCE(MAX(rule_order), -1) as max FROM rules');
    ruleOrder = parseInt(maxResult.rows[0].max, 10) + 1;
  }
  const result = await db.query(
    `INSERT INTO rules (user_id, name, is_active, rule_order, stop_on_match, shared, criteria, actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [createdBy, name, isActive, ruleOrder, stopOnMatch, shared, JSON.stringify(criteria), JSON.stringify(actions)]
  );
  return result.rows[0];
}

async function updateRule(id, changes) {
  const existing = await pool.query('SELECT * FROM rules WHERE id = $1', [id]);
  if (existing.rows.length === 0) return null;

  const updates = [];
  const params = [];
  let idx = 1;
  if (changes.name !== undefined) { updates.push(`name = $${idx++}`); params.push(changes.name); }
  if (changes.isActive !== undefined) { updates.push(`is_active = $${idx++}`); params.push(changes.isActive); }
  if (changes.stopOnMatch !== undefined) { updates.push(`stop_on_match = $${idx++}`); params.push(changes.stopOnMatch); }
  if (changes.shared !== undefined) { updates.push(`shared = $${idx++}`); params.push(changes.shared); }
  if (changes.criteria !== undefined) { updates.push(`criteria = $${idx++}`); params.push(JSON.stringify(changes.criteria)); }
  if (changes.actions !== undefined) { updates.push(`actions = $${idx++}`); params.push(JSON.stringify(changes.actions)); }
  updates.push(`updated_at = $${idx++}`);
  params.push(new Date().toISOString());
  params.push(id);
  const result = await pool.query(
    `UPDATE rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0];
}

async function deleteRule(id) {
  const result = await pool.query('DELETE FROM rules WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) return false;
  await pool.query(
    `UPDATE rules SET rule_order = sub.rn - 1
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY rule_order, created_at, id) AS rn FROM rules) sub
     WHERE rules.id = sub.id`
  );
  return true;
}

async function reorderRules(ids) {
  for (let index = 0; index < ids.length; index += 1) {
    await pool.query('UPDATE rules SET rule_order = $1, updated_at = NOW() WHERE id = $2', [index, ids[index]]);
  }
}

async function loadRulesForApplication({ ruleIds }) {
  const text = ruleIds
    ? 'SELECT * FROM rules WHERE id = ANY($1) AND is_active = true ORDER BY rule_order ASC, created_at ASC, id ASC'
    : 'SELECT * FROM rules WHERE is_active = true ORDER BY rule_order ASC, created_at ASC, id ASC';
  const result = await pool.query(text, ruleIds ? [ruleIds] : []);
  return result.rows;
}

async function loadDocumentsForRuleApplication(input, db = pool) {
  const query = buildRulesApplyDocumentQuery(input);
  const result = await db.query(query.text, query.params);
  return result.rows;
}

// `db` optional so the document write participates in the atomic create+apply
// transaction — a throw here rolls back the just-created rule.
async function applyRulePatch({ documentId, patchUpdate, matchedRules, db = pool }) {
  const discardsDocument = patchUpdate.patches.status === 'discarded';
  const classificationIndex = patchUpdate.fields.indexOf('classification');
  const classificationGuard = classificationIndex >= 0
    ? ` AND (linked_lien_waiver_id IS NULL OR classification = $${classificationIndex + 2})`
    : '';
  const result = await db.query(
    `UPDATE documents
     SET ${patchUpdate.setClauses},
         ${discardsDocument ? `filed = CASE
           WHEN classification = 'lien-waiver' AND linked_lien_waiver_id IS NOT NULL THEN false
           ELSE filed
         END,
         filed_at = CASE
           WHEN classification = 'lien-waiver' AND linked_lien_waiver_id IS NOT NULL THEN NULL
           ELSE filed_at
         END,` : ''}
         updated_at = NOW()
     WHERE id = $1${classificationGuard}
     RETURNING classification, linked_lien_waiver_id`,
    [documentId, ...patchUpdate.values]
  );
  if (classificationIndex >= 0 && result.rowCount === 0) {
    const error = new Error('Unlink the lien waiver before changing this document classification.');
    error.code = 'WAIVER_LINKED_CLASSIFICATION_PROTECTED';
    throw error;
  }
  const updated = result.rows?.[0];
  const auditPatches = discardsDocument
    && updated?.classification === 'lien-waiver'
    && updated?.linked_lien_waiver_id
    ? { ...patchUpdate.patches, filed: false, filed_at: null }
    : patchUpdate.patches;
  // Emit on the same client as the UPDATE: in the atomic create+apply path `db`
  // is the transaction client, so a later rollback also removes this audit row
  // (no phantom). On the best-effort /apply path `db` is the shared pool.
  await emitLegacyInvoiceAuditEvent(documentId, 'rules-applied', {
    matchedRules,
    patches: auditPatches,
  }, 'rules-engine', db);
}

// Atomic create + apply. The rule INSERT and every document update execute in
// ONE transaction; a throw at any point after the INSERT (including mid-apply)
// rolls the rule back — no orphaned rule. Reuses the same apply semantics as
// POST /api/rules/apply (evaluateBatch + buildPatchUpdate + applyRulePatch).
async function createAndApplyRule(ruleInput, { scope = 'pending', documentIds, includeScope = true, sourceDocumentId } = {}) {
  return withTransaction(pool, async (db) => {
    const rule = await createRule({ ...ruleInput, db });
    const documents = await loadDocumentsForRuleApplication({ scope, documentIds, includeScope }, db);
    const results = evaluateBatch(documents, [rule]);
    let actionsApplied = 0;
    const appliedDocIds = new Set();
    for (const { docId, patches, matchedRules } of results) {
      if (patches.classification) {
        const { enforceActiveClassification } = require('./pipeline');
        patches.classification = await enforceActiveClassification(patches.classification, 'rules-apply');
      }
      const patchUpdate = buildPatchUpdate(patches, 2);
      if (!patchUpdate.setClauses) continue;
      await applyRulePatch({ documentId: docId, patchUpdate, matchedRules, db });
      actionsApplied += patchUpdate.fields.length;
      appliedDocIds.add(docId);
    }
    const outcome = { rule, matchedInvoices: results.length, actionsApplied };

    if (sourceDocumentId) {
      const row = (await db.query(
        'SELECT id, status FROM documents WHERE id = $1',
        [sourceDocumentId]
      )).rows[0];
      outcome.sourceOutcome = row
        ? { id: row.id, matched: appliedDocIds.has(row.id), status: row.status }
        : { id: sourceDocumentId, matched: false, status: null };
    }

    return outcome;
  });
}

module.exports = {
  applyRulePatch,
  createAndApplyRule,
  createRule,
  deleteRule,
  listRules,
  loadDocumentsForRuleApplication,
  loadRulesForApplication,
  reorderRules,
  updateRule,
};
