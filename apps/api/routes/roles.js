// TARGET: routes/roles.js

const express = require('express');
const { countRoleUsers, createRole, deleteRole, getRoleById, listRoles, updateRole } = require('../services/roleService');
const { logRequestError } = require('../lib/requestLog');
const { emitPlatformAuditEvent } = require('../lib/auditEvents');
const { requirePermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { paginationQuerySchema, roleCreateSchema, roleUpdateSchema } = require('../lib/schemas');
const { fail } = require('../middleware/errorResponse');
const { getPagination } = require('../lib/pagination');

const router = express.Router();

router.use(requirePermission('platform.manage_roles'));

function logRouteError(req, operation, error, context) {
  logRequestError(req, operation, error, context, 'roles route failed');
}

async function emitAudit(req, res, event) {
  try {
    await emitPlatformAuditEvent(req, res, event);
  } catch (error) {
    logRouteError(req, 'emitRoleAuditEvent', error, { roleId: event.targetId, eventType: event.type });
  }
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDescription(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isUniqueViolation(error) {
  return Boolean(error && (error.code === '23505' || error.status === 409));
}

function buildUpdatePayload(body) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeName(body.name);

    if (!name) {
      return { error: 'Role name is required' };
    }

    payload.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    payload.description = normalizeDescription(body.description);
  }

  return { payload };
}

router.get('/', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    const roles = await listRoles({ limit, offset });
    return res.json(roles.map(({ toolbox_users: users, ...role }) => ({
      ...role,
      user_count: Array.isArray(users) ? Number(users[0]?.count || 0) : Number(users?.count || 0),
    })));
  } catch (error) {
    logRouteError(req, 'listRoles', error);
    return fail(res, 500, 'Internal Server Error');
  }
});

router.post('/', validate(roleCreateSchema), async (req, res) => {
  try {
    const name = normalizeName(req.body && req.body.name);

    if (!name) {
      return fail(res, 400, 'Invalid request', 'Role name is required');
    }

    let created;
    try {
      created = await createRole({
        name,
        description: normalizeDescription(req.body && req.body.description),
        is_system: false,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return fail(res, 409, 'Conflict', 'Role name already exists');
    }

    await emitAudit(req, res, {
      type: 'platform.role_created',
      targetType: 'role',
      targetId: created.id,
      targetLabel: created.name,
      afterState: created,
      summary: `Created role ${created.name}`,
    });
    return res.status(201).json(created);
  } catch (error) {
    logRouteError(req, 'createRole', error, { roleName: req.body?.name || null });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.patch('/:id', validate(roleUpdateSchema), async (req, res) => {
  try {
    const role = await getRoleById(req.params.id);

    if (!role) {
      return fail(res, 404, 'Not found');
    }

    if (role.is_system) {
      return fail(res, 403, 'Forbidden', 'System roles cannot be modified');
    }

    const update = buildUpdatePayload(req.body || {});

    if (update.error) {
      return fail(res, 400, 'Invalid request', update.error);
    }

    if (!Object.keys(update.payload).length) {
      return fail(res, 400, 'Invalid request', 'No fields to update');
    }

    let updated;
    try {
      updated = await updateRole(req.params.id, update.payload);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return fail(res, 409, 'Conflict', 'Role name already exists');
    }

    await emitAudit(req, res, {
      type: 'platform.role_updated',
      targetType: 'role',
      targetId: updated.id,
      targetLabel: updated.name,
      beforeState: role,
      afterState: updated,
      summary: `Updated role ${updated.name}`,
    });
    return res.json(updated);
  } catch (error) {
    logRouteError(req, 'updateRole', error, { roleId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const role = await getRoleById(req.params.id);

    if (!role) {
      return fail(res, 404, 'Not found');
    }

    if (role.is_system) {
      return fail(res, 403, 'Forbidden', 'System roles cannot be deleted');
    }

    if ((await countRoleUsers(req.params.id)) > 0) {
      return fail(res, 409, 'Forbidden', 'Role has assigned users');
    }

    await deleteRole(req.params.id);

    await emitAudit(req, res, {
      type: 'platform.role_deleted',
      targetType: 'role',
      targetId: role.id,
      targetLabel: role.name,
      beforeState: role,
      afterState: null,
      summary: `Deleted role ${role.name}`,
    });
    return res.status(204).end();
  } catch (error) {
    logRouteError(req, 'deleteRole', error, { roleId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

module.exports = router;
