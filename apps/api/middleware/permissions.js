// TARGET: middleware/permissions.js

const { fail } = require('./errorResponse');

function hasAdminRole(req) {
  try {
    return req && req.user && req.user.role === 'admin';
  } catch (error) {
    return false;
  }
}

function parsePermissions(req) {
  try {
    const permissionsValue = req && req.user && req.user.permissions;

    if (Array.isArray(permissionsValue)) {
      const permissions = permissionsValue
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean);
      return permissions.length ? new Set(permissions) : null;
    }

    if (typeof permissionsValue !== 'string') return null;

    const trimmedHeader = permissionsValue.trim();

    if (!trimmedHeader) {
      return null;
    }

    const permissions = trimmedHeader
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!permissions.length) {
      return null;
    }

    return new Set(permissions);
  } catch (error) {
    return null;
  }
}

function normalizePermissionKeys(permissionKeys) {
  try {
    if (!Array.isArray(permissionKeys)) {
      return [];
    }

    return permissionKeys
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function getPermissionCandidates(permissionKey) {
  const key = permissionKey.trim();
  const accountingPrefix = 'accounting.invoices.';
  const legacyPrefix = 'invoices.';
  // These are the only invoice suffixes that existed before the 2026-06-25
  // namespace migration. Later permissions must match their canonical key.
  const migratedLegacyInvoiceSuffixes = new Set([
    'approve',
    'delete',
    'export',
    'manage_retention',
    'manage_rules',
    'manage_splits',
    'permanent_delete',
    'reject',
    'submit_spectrum',
    'view',
    'view_details',
  ]);

  if (key.startsWith(accountingPrefix) && key.length > accountingPrefix.length) {
    const suffix = key.slice(accountingPrefix.length);
    return migratedLegacyInvoiceSuffixes.has(suffix) ? [key, `${legacyPrefix}${suffix}`] : [key];
  }

  if (key.startsWith(legacyPrefix) && key.length > legacyPrefix.length) {
    const suffix = key.slice(legacyPrefix.length);
    return migratedLegacyInvoiceSuffixes.has(suffix) ? [key, `${accountingPrefix}${suffix}`] : [key];
  }

  return [key];
}

function checkPermission(req, permissionKey) {
  try {
    if (hasAdminRole(req)) {
      return true;
    }

    if (typeof permissionKey !== 'string' || !permissionKey.trim()) {
      return false;
    }

    const permissions = parsePermissions(req);

    if (!permissions) {
      return false;
    }

    return getPermissionCandidates(permissionKey).some((key) => permissions.has(key));
  } catch (error) {
    return false;
  }
}

function deny(res) {
  return fail(res, 403, 'Forbidden');
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    try {
      if (checkPermission(req, permissionKey)) {
        return next();
      }

      return deny(res);
    } catch (error) {
      return deny(res);
    }
  };
}

function requireAnyPermission(permissionKeys) {
  return (req, res, next) => {
    try {
      if (hasAdminRole(req)) {
        return next();
      }

      const normalizedKeys = normalizePermissionKeys(permissionKeys);

      if (!normalizedKeys.length) {
        return deny(res);
      }

      const isAllowed = normalizedKeys.some((key) => checkPermission(req, key));

      if (isAllowed) {
        return next();
      }

      return deny(res);
    } catch (error) {
      return deny(res);
    }
  };
}

module.exports = {
  requirePermission,
  requireAnyPermission,
  checkPermission,
};
