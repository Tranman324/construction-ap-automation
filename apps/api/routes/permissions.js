// TARGET: routes/permissions.js

const express = require('express');
const {
  getKnownPermissionKeys,
  getRole,
  getUser,
  listPermissions,
  listRolePermissionKeys,
  listUserPermissionOverrides,
  replaceRolePermissions,
  replaceUserOverrides,
} = require('../services/permissionService');
const { logRequestError } = require('../lib/requestLog');
const { emitPlatformAuditEvent } = require('../lib/auditEvents');
const { requirePermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { paginationQuerySchema, rolePermissionsSchema, userOverridesSchema } = require('../lib/schemas');
const { fail } = require('../middleware/errorResponse');
const { getPagination } = require('../lib/pagination');

const router = express.Router();

router.use(requirePermission('platform.manage_permissions'));

function logRouteError(req, operation, error, context) {
  logRequestError(req, operation, error, context, 'permissions route failed');
}

async function emitAudit(req, res, event) {
  try {
    await emitPlatformAuditEvent(req, res, event);
  } catch (error) {
    logRouteError(req, 'emitPermissionAuditEvent', error, { targetId: event.targetId, eventType: event.type });
  }
}

async function loadAuditSnapshot(req, targetId, snapshotType, load) {
  try {
    return await load();
  } catch (error) {
    // Audit snapshots are supplemental: a failed read must not prevent the mutation.
    logRouteError(req, 'loadPermissionAuditSnapshot', error, { targetId, snapshotType });
    return null;
  }
}

function normalizePermissionKeys(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  return Array.from(new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))).sort();
}

function normalizeOverrides(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const overrides = new Map();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || typeof entry.granted !== 'boolean') {
      return null;
    }

    const key = entry.key.trim();
    if (!key) {
      return null;
    }

    overrides.set(key, { key, granted: entry.granted });
  }

  return Array.from(overrides.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function getUnknownKeys(requestedKeys, knownKeys) {
  const knownSet = new Set(knownKeys);
  return requestedKeys.filter((key) => !knownSet.has(key));
}

router.get('/permissions', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    const rows = await listPermissions({ limit, offset });

    const grouped = {};
    for (const row of rows || []) {
      if (!grouped[row.module]) {
        grouped[row.module] = [];
      }

      grouped[row.module].push({ key: row.key, description: row.description });
    }

    return res.json(grouped);
  } catch (error) {
    logRouteError(req, 'listPermissions', error);
    return fail(res, 500, 'Internal Server Error');
  }
});

router.get('/roles/:id/permissions', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    if (!(await getRole(req.params.id))) {
      return fail(res, 404, 'Not found');
    }

    return res.json(await listRolePermissionKeys(req.params.id, getPagination(req.query)));
  } catch (error) {
    logRouteError(req, 'getRolePermissions', error, { roleId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.put('/roles/:id/permissions', validate(rolePermissionsSchema), async (req, res) => {
  try {
    const permissionKeys = normalizePermissionKeys(req.body && req.body.permissions);
    if (!permissionKeys) {
      return fail(res, 400, 'Invalid request', 'permissions must be an array of strings');
    }

    const unknownKeys = getUnknownKeys(permissionKeys, await getKnownPermissionKeys(permissionKeys));
    if (unknownKeys.length) {
      return fail(res, 400, 'Unknown permission keys', unknownKeys);
    }

    if (!(await getRole(req.params.id))) {
      return fail(res, 404, 'Not found');
    }

    const previousPermissions = await loadAuditSnapshot(
      req,
      req.params.id,
      'role_permissions',
      () => listRolePermissionKeys(req.params.id)
    );

    await replaceRolePermissions(req.params.id, permissionKeys);

    await emitAudit(req, res, {
      type: 'platform.role_permissions_updated',
      targetType: 'role',
      targetId: req.params.id,
      ...(previousPermissions === null ? {} : {
        changes: {
          granted: permissionKeys.filter((key) => !previousPermissions.includes(key)),
          revoked: previousPermissions.filter((key) => !permissionKeys.includes(key)),
        },
      }),
      beforeState: previousPermissions === null ? null : { permissions: previousPermissions },
      afterState: { permissions: permissionKeys },
      summary: 'Updated role permissions',
    });
    return res.json({ ok: true, permissions: permissionKeys });
  } catch (error) {
    logRouteError(req, 'replaceRolePermissions', error, { roleId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.get('/users/:id/overrides', validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    if (!(await getUser(req.params.id))) {
      return fail(res, 404, 'Not found');
    }

    return res.json(await listUserPermissionOverrides(req.params.id, getPagination(req.query)));
  } catch (error) {
    logRouteError(req, 'getUserOverrides', error, { userId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.put('/users/:id/overrides', validate(userOverridesSchema), async (req, res) => {
  try {
    const overrides = normalizeOverrides(req.body && req.body.overrides);
    if (!overrides) {
      return fail(res, 400, 'Invalid request', 'overrides must be an array of { key, granted } objects');
    }

    const overrideKeys = overrides.map((entry) => entry.key);
    const unknownKeys = getUnknownKeys(overrideKeys, await getKnownPermissionKeys(overrideKeys));
    if (unknownKeys.length) {
      return fail(res, 400, 'Unknown permission keys', unknownKeys);
    }

    if (!(await getUser(req.params.id))) {
      return fail(res, 404, 'Not found');
    }

    const previousOverrides = await loadAuditSnapshot(
      req,
      req.params.id,
      'user_permission_overrides',
      () => listUserPermissionOverrides(req.params.id)
    );

    await replaceUserOverrides(req.params.id, overrides);

    await emitAudit(req, res, {
      type: 'platform.user_permission_overrides_updated',
      targetType: 'user',
      targetId: req.params.id,
      ...(previousOverrides === null ? {} : { changes: { overrides } }),
      beforeState: previousOverrides === null ? null : { overrides: previousOverrides },
      afterState: { overrides },
      summary: 'Updated user permission overrides',
    });
    return res.json({ ok: true, overrides });
  } catch (error) {
    logRouteError(req, 'replaceUserOverrides', error, { userId: req.params.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

module.exports = router;
