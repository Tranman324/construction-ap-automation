// TARGET: routes/title-rules.js

const express = require('express');
const {
  createTitleRule,
  deleteTitleRule,
  getRoleById,
  getTitleRule,
  listTitleRules,
  matchTitleRule,
  updateTitleRule,
} = require('../services/titleRuleService');
const { logRequestError } = require('../lib/requestLog');
const { emitPlatformAuditEvent } = require('../lib/auditEvents');
const { requirePermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const {
  titleRuleCreateSchema,
  paginationQuerySchema,
  titleRuleUpdateSchema,
  titleRulePreviewSchema,
} = require('../lib/schemas');
const { getPagination } = require('../lib/pagination');
const { fail } = require('../middleware/errorResponse');

const router = express.Router();
const VALID_MATCH_TYPES = new Set(['equals', 'contains', 'starts_with']);

router.use(requirePermission('platform.manage_title_rules'));

function logRouteError(req, operation, error, context) {
  logRequestError(req, operation, error, context, 'title-rules route failed');
}

async function emitAudit(req, res, event) {
  try {
    await emitPlatformAuditEvent(req, res, event);
  } catch (error) {
    logRouteError(req, 'emitTitleRuleAuditEvent', error, { ruleId: event.targetId, eventType: event.type });
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getRoleName(role) {
  if (!role) {
    return null;
  }

  if (Array.isArray(role)) {
    return role[0] ? role[0].name || null : null;
  }

  return role.name || null;
}

function normalizeRule(rule) {
  return {
    id: rule.id,
    pattern: rule.pattern,
    match_type: rule.match_type,
    role_id: rule.role_id,
    priority: rule.priority,
    is_active: rule.is_active,
    created_at: rule.created_at,
    role_name: getRoleName(rule.role),
  };
}

function buildRulePayload(body, requireAllFields) {
  const payload = {};

  if (requireAllFields || Object.prototype.hasOwnProperty.call(body, 'pattern')) {
    const pattern = normalizeText(body.pattern);
    if (!pattern) {
      return { error: 'pattern is required' };
    }
    payload.pattern = pattern;
  }

  if (requireAllFields || Object.prototype.hasOwnProperty.call(body, 'match_type')) {
    const matchType = normalizeText(body.match_type);
    if (!VALID_MATCH_TYPES.has(matchType)) {
      return { error: 'match_type must be equals, contains, or starts_with' };
    }
    payload.match_type = matchType;
  }

  if (requireAllFields || Object.prototype.hasOwnProperty.call(body, 'role_id')) {
    const roleId = normalizeText(body.role_id);
    if (!roleId) {
      return { error: 'role_id is required' };
    }
    payload.role_id = roleId;
  }

  if (requireAllFields || Object.prototype.hasOwnProperty.call(body, 'priority')) {
    if (!Number.isInteger(body.priority)) {
      return { error: 'priority must be an integer' };
    }
    payload.priority = body.priority;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') {
      return { error: 'is_active must be a boolean' };
    }
    payload.is_active = body.is_active;
  } else if (requireAllFields) {
    payload.is_active = true;
  }

  return { payload };
}

async function getRuleForAudit(ruleId, req) {
  try {
    const rule = await getTitleRule(ruleId);
    return rule ? normalizeRule(rule) : null;
  } catch (error) {
    logRouteError(req, 'loadTitleRuleAuditState', error, { ruleId });
    return null;
  }
}

router.get('/', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    return res.json((await listTitleRules({ limit, offset })).map(normalizeRule));
  } catch (error) {
    logRouteError(req, 'listTitleRules', error);
    return fail(res, 500, 'Internal Server Error');
  }
});

router.post('/', validate(titleRuleCreateSchema), async (req, res) => {
  try {
    const built = buildRulePayload(req.body || {}, true);
    if (built.error) {
      return fail(res, 400, 'Invalid request', built.error);
    }

    const role = await getRoleById(built.payload.role_id);
    if (!role) {
      return fail(res, 400, 'Invalid request', 'role_id does not exist');
    }

    const createdRule = normalizeRule(await createTitleRule(built.payload));
    await emitAudit(req, res, {
      type: 'platform.title_rule_created',
      targetType: 'title_rule',
      targetId: createdRule.id,
      targetLabel: createdRule.pattern,
      afterState: createdRule,
      summary: `Created title rule ${createdRule.pattern}`,
    });
    return res.status(201).json(createdRule);
  } catch (error) {
    logRouteError(req, 'createTitleRule', error, {
      pattern: req.body?.pattern || null,
      matchType: req.body?.match_type || null,
      roleId: req.body?.role_id || null,
    });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.patch('/:id', validate(titleRuleUpdateSchema), async (req, res) => {
  try {
    const built = buildRulePayload(req.body || {}, false);
    if (built.error) {
      return fail(res, 400, 'Invalid request', built.error);
    }

    if (!Object.keys(built.payload).length) {
      return fail(res, 400, 'Invalid request', 'No fields to update');
    }

    const previousRule = await getRuleForAudit(req.params.id, req);

    if (built.payload.role_id) {
      const role = await getRoleById(built.payload.role_id);
      if (!role) {
        return fail(res, 400, 'Invalid request', 'role_id does not exist');
      }
    }

    const updatedRule = normalizeRule(await updateTitleRule(req.params.id, built.payload));
    await emitAudit(req, res, {
      type: 'platform.title_rule_updated',
      targetType: 'title_rule',
      targetId: updatedRule.id,
      targetLabel: updatedRule.pattern,
      beforeState: previousRule,
      afterState: updatedRule,
      summary: `Updated title rule ${updatedRule.pattern}`,
    });
    return res.json(updatedRule);
  } catch (error) {
    logRouteError(req, 'updateTitleRule', error, { ruleId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const previousRule = await getRuleForAudit(req.params.id, req);
    const deleted = await deleteTitleRule(req.params.id);
    if (!deleted) {
      return fail(res, 404, 'Not found');
    }
    await emitAudit(req, res, {
      type: 'platform.title_rule_deleted',
      targetType: 'title_rule',
      targetId: deleted.id,
      targetLabel: previousRule?.pattern || null,
      beforeState: previousRule,
      afterState: null,
      summary: `Deleted title rule ${previousRule?.pattern || deleted.id}`,
    });
    return res.status(204).end();
  } catch (error) {
    logRouteError(req, 'deleteTitleRule', error, { ruleId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.post('/preview', validate(titleRulePreviewSchema), async (req, res) => {
  try {
    const jobTitle = normalizeText(req.body && req.body.jobTitle);
    if (!jobTitle) {
      return fail(res, 400, 'Invalid request', 'jobTitle is required');
    }

    const matchedRule = await matchTitleRule(jobTitle);
    if (!matchedRule) {
      return res.json({ matched: null });
    }

    const role = await getRoleById(matchedRule.role_id);
    return res.json({ matched: normalizeRule({ ...matchedRule, role }) });
  } catch (error) {
    logRouteError(req, 'previewTitleRule', error, { jobTitleProvided: Boolean(req.body?.jobTitle) });
    return fail(res, 500, 'Internal Server Error');
  }
});

module.exports = router;
