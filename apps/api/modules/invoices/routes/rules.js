'use strict';
/**
 * /api/rules routes
 */

const express = require('express');
const router = express.Router();
const {
  applyRulePatch,
  createRule,
  deleteRule,
  listRules,
  loadDocumentsForRuleApplication,
  loadRulesForApplication,
  reorderRules,
  updateRule,
} = require('../services/rulesService');
const { buildPatchUpdate, evaluateBatch } = require('../scripts/rules-engine');
const { validate } = require('../../../middleware/validate');
const { requirePermission } = require('../../../middleware/permissions');
const { paginationQuerySchema, ruleApplySchema, ruleCreateSchema, ruleOrderSchema, ruleUpdateSchema } = require('../../../lib/schemas');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { createAndApplyRule } = require('../services/rulesService');

function rowToRule(r) {
  return {
    // Rule PK is a DB integer; always serialize it as a string so no rule ID
    // ever leaves the API as a number (request-side coercion accepts both).
    id: r.id == null ? null : String(r.id),
    userId: r.user_id,
    name: r.name,
    isActive: r.is_active,
    order: r.rule_order,
    stopOnMatch: r.stop_on_match,
    shared: r.shared,
    criteria: r.criteria || [],
    actions: r.actions || [],
    createdAt: r.created_at?.toISOString(),
    updatedAt: r.updated_at?.toISOString(),
    createdBy: r.user_id,
  };
}

router.use(requirePermission('accounting.invoices.manage_rules'));

// GET /api/rules
router.get('/', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    const rules = await listRules({ limit, offset });
    res.json({ rules: rules.map(rowToRule), total: rules.length });
  } catch (err) {
    return safeError(res, err, 'GET /api/rules');
  }
});

// POST /api/rules — create, optionally create-and-apply atomically.
router.post('/', validate(ruleCreateSchema), async (req, res) => {
  try {
    const createdBy = req.user?.email || 'system';
    const { name, isActive = true, stopOnMatch = false, shared = false, criteria, actions } = req.body;
    const ruleInput = { createdBy, name, isActive, order: req.body.order, stopOnMatch, shared, criteria, actions };

    // Create-only (unchanged).
    if (req.body.apply !== true) {
      const rule = await createRule(ruleInput);
      return res.status(201).json(rowToRule(rule));
    }

    // Atomic create + apply — the service owns the transaction (the rule INSERT
    // and every document update run together; a failure after the INSERT rolls
    // the rule back, so no orphaned rule).
    const { scope = 'pending', documentIds, includeScope = true, sourceDocumentId } = req.body;
    const outcome = await createAndApplyRule(ruleInput, { scope, documentIds, includeScope, sourceDocumentId });

    const response = {
      rule: rowToRule(outcome.rule),
      applied: { matchedInvoices: outcome.matchedInvoices, actionsApplied: outcome.actionsApplied },
    };
    if (outcome.sourceOutcome) response.sourceOutcome = outcome.sourceOutcome;
    return res.status(201).json(response);
  } catch (err) {
    return safeError(res, err, 'POST /api/rules');
  }
});

// PATCH /api/rules/:id
router.patch('/:id', validate(ruleUpdateSchema), async (req, res) => {
  try {
    const rule = await updateRule(req.params.id, req.body);
    if (!rule) return fail(res, 404, 'Rule not found');
    res.json(rowToRule(rule));
  } catch (err) {
    return safeError(res, err, 'PATCH /api/rules/:id');
  }
});

// DELETE /api/rules/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!(await deleteRule(req.params.id))) return fail(res, 404, 'Rule not found');
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/rules/:id');
  }
});

// PUT /api/rules/order
router.put('/order', validate(ruleOrderSchema), async (req, res) => {
  try {
    const { ids } = req.body;
    await reorderRules(ids);
    res.json({ updated: ids.length });
  } catch (err) {
    return safeError(res, err, 'PUT /api/rules/order');
  }
});

// POST /api/rules/apply
router.post('/apply', requirePermission('accounting.invoices.manage_rules'), validate(ruleApplySchema), async (req, res) => {
  try {
    const { ruleIds, scope, documentIds, includeScope } = req.body;
    const startMs = Date.now();

    const rules = await loadRulesForApplication({ ruleIds: ruleIds?.length ? ruleIds : null });
    if (rules.length === 0) return res.json({ matchedInvoices: 0, actionsApplied: 0, errors: 0, durationMs: 0 });

    const documents = await loadDocumentsForRuleApplication({ scope, documentIds, includeScope });

    const results = evaluateBatch(documents, rules);
    let actionsApplied = 0, errors = 0;

    for (const { docId, patches, matchedRules } of results) {
      try {
        // Rules may only set existing active classifications.
        if (patches.classification) {
          const { enforceActiveClassification } = require('../services/pipeline');
          patches.classification = await enforceActiveClassification(patches.classification, 'rules-apply');
        }
        const patchUpdate = buildPatchUpdate(patches, 2);
        if (!patchUpdate.setClauses) continue;

        await applyRulePatch({ documentId: docId, patchUpdate, matchedRules });
        actionsApplied += patchUpdate.fields.length;
      } catch (e) { errors++; }
    }

    res.json({
      matchedInvoices: results.length,
      actionsApplied,
      errors,
      durationMs: Date.now() - startMs,
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/rules/apply');
  }
});

module.exports = router;
