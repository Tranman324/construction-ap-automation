// TARGET: routes/admin-users.js
//
// Admin user management — list toolbox_users, update role/active status.
// Requires platform.manage_users permission.
// Mount at: app.use('/api/admin/users', requireAuth, methodLimiter, require('./routes/admin-users'));

const express = require('express');
const { bumpAdminUserRoleVersion, getAdminUser, getRoleById, listAdminUsers, updateAdminUser } = require('../services/adminUserService');
const { logRequestError } = require('../lib/requestLog');
const { emitPlatformAuditEvent } = require('../lib/auditEvents');
const { requirePermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { adminUserPatchSchema, paginationQuerySchema } = require('../lib/schemas');
const { getPagination } = require('../lib/pagination');
const { fail } = require('../middleware/errorResponse');

const router = express.Router();

router.use(requirePermission('platform.manage_users'));


function logRouteError(req, operation, error, context) {
  logRequestError(req, operation, error, context, 'admin-users route failed');
}

async function emitAudit(req, res, event) {
  try {
    await emitPlatformAuditEvent(req, res, event);
  } catch (error) {
    logRouteError(req, 'emitAdminUserAuditEvent', error, { userId: event.targetId, eventType: event.type });
  }
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  const role = Array.isArray(user.role) ? user.role[0] || null : user.role || null;
  return { ...user, role };
}

function isSelfTarget(req, user) {
  if (!user) {
    return false;
  }

  if (req.user?.userId && req.user.userId === user.id) {
    return true;
  }

  if (!req.user?.email || !user.email) {
    return false;
  }

  return req.user.email.toLowerCase() === user.email.toLowerCase();
}

// ─── GET /api/admin/users — List all toolbox users ──────────────────────────

router.get('/', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    return res.json((await listAdminUsers({ limit, offset })).map(normalizeUser));
  } catch (error) {
    logRouteError(req, 'listUsers', error);
    return fail(res, 500, 'Internal Server Error');
  }
});

// ─── PATCH /api/admin/users/:id — Update role_id and/or is_active ───────────

router.patch('/:id', validate(adminUserPatchSchema), async (req, res) => {
  try {
    const existing = await getAdminUser(req.params.id);

    if (!existing) {
      return fail(res, 404, 'Not found');
    }

    if (isSelfTarget(req, existing) && Object.prototype.hasOwnProperty.call(req.body, 'role_id')) {
      return fail(res, 403, 'Forbidden', 'You cannot change your own role');
    }

    if (isSelfTarget(req, existing) && req.body.is_active === false) {
      return fail(res, 403, 'Forbidden', 'You cannot deactivate your own account');
    }

    const payload = {};
    const hasRoleUpdate = Object.prototype.hasOwnProperty.call(req.body, 'role_id');
    const hasActiveUpdate = Object.prototype.hasOwnProperty.call(req.body, 'is_active');
    const roleChanged = hasRoleUpdate && req.body.role_id !== existing.role_id;
    let nextRole = null;

    if (hasRoleUpdate) {
      nextRole = await getRoleById(req.body.role_id);

      if (!nextRole) {
        return fail(res, 400, 'Invalid request', 'role_id does not exist');
      }

      payload.role_id = req.body.role_id;
    }

    if (hasActiveUpdate) {
      payload.is_active = req.body.is_active;
    }

    const nextActive = hasActiveUpdate ? req.body.is_active : existing.is_active;
    const outcome = await updateAdminUser({ id: req.params.id, existing, payload, roleChanged, nextRole: roleChanged ? nextRole : null, nextActive });

    if (outcome.conflict) {
      return fail(res, 409, 'Conflict', 'You cannot deactivate or demote the last active admin');
    }

    const normalizedUpdated = normalizeUser(outcome.updated);
    await emitAudit(req, res, {
      type: 'platform.user_updated',
      targetType: 'user',
      targetId: existing.id,
      targetLabel: existing.email,
      changes: {
        ...(Object.prototype.hasOwnProperty.call(req.body, 'role_id') ? { role_id: [existing.role_id, normalizedUpdated.role_id] } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, 'is_active') ? { is_active: [existing.is_active, normalizedUpdated.is_active] } : {}),
      },
      beforeState: { role_id: existing.role_id, is_active: existing.is_active },
      afterState: { role_id: normalizedUpdated.role_id, is_active: normalizedUpdated.is_active },
      summary: `Updated user ${existing.email}`,
    });
    return res.json(normalizedUpdated);
  } catch (error) {
    logRouteError(req, 'updateUser', error, {
      userId: req.params.id,
      updatesRole: Object.prototype.hasOwnProperty.call(req.body || {}, 'role_id'),
      updatesActive: Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active'),
    });
    return fail(res, 500, 'Internal Server Error');
  }
});

const bumpVersionRouter = express.Router();

bumpVersionRouter.post('/:id/bump-version', requirePermission('platform.manage_users'), async (req, res) => {
  try {
    const bumpedUser = await bumpAdminUserRoleVersion(req.params.id);
    if (!bumpedUser) return fail(res, 404, 'Not found');
    const response = { ok: true, userId: req.params.id };
    if (typeof bumpedUser.role_version === 'number') response.roleVersion = bumpedUser.role_version;
    return res.status(200).json(response);
  } catch (error) {
    logRequestError(req, 'bumpRoleVersion', error, { userId: req.params.id }, 'bump version route failed');
    return fail(res, 500, 'Internal error');
  }
});

module.exports = router;
module.exports.bumpVersionRouter = bumpVersionRouter;
