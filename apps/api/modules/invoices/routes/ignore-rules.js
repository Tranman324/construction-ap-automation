'use strict';
/**
 * /api/ignore-rules routes
 */

const express = require('express');
const router = express.Router();
const { createIgnoreRule, deleteIgnoreRule, listIgnoreRules } = require('../services/ignoreRuleService');
const { validate } = require('../../../middleware/validate');
const { ignoreRuleSchema, paginationQuerySchema } = require('../../../lib/schemas');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { getPagination } = require('../../../lib/pagination');

// GET /api/ignore-rules
router.get('/', requirePermission('accounting.invoices.manage_retention'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    const rows = await listIgnoreRules({ limit, offset });
    res.json(rows.map(r => ({
      id: r.id.toString(),
      field: r.field,
      pattern: r.pattern,
      reason: r.reason,
      createdAt: r.created_at ? r.created_at.toISOString() : null,
    })));
  } catch (err) {
    return safeError(res, err, 'GET /api/ignore-rules');
  }
});

// POST /api/ignore-rules
router.post('/', requirePermission('accounting.invoices.manage_retention'), validate(ignoreRuleSchema), async (req, res) => {
  try {
    const { type, value, reason = '' } = req.body;

    const r = await createIgnoreRule({ type, value, reason });
    res.status(201).json({
      id: r.id.toString(),
      type: r.field,
      value: r.pattern,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/ignore-rules');
  }
});

// DELETE /api/ignore-rules/:id
router.delete('/:id', requirePermission('accounting.invoices.manage_retention'), async (req, res) => {
  try {
    if (!(await deleteIgnoreRule(req.params.id))) return fail(res, 404, 'Rule not found');
    res.json({ deleted: true });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/ignore-rules/:id');
  }
});

module.exports = router;
