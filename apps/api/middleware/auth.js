'use strict';
/**
 * Auth middleware for the NCG Invoice Dashboard API.
 *
 * Two authentication paths:
 *
 *   1. Internal proxy secret (Next.js → backend):
 *      The Next.js App Router proxy route at /api/backend/[...path] validates
 *      the user's NextAuth session server-side, then forwards requests with:
 *        - x-internal-secret: <matches INTERNAL_API_SECRET>
 *        - x-user-email: <session user email>
 *      This path is the primary auth for production traffic.
 *
 *   2. Direct NextAuth JWT (future / service accounts):
 *      A client sends `Authorization: Bearer <jwt>` signed with NEXTAUTH_SECRET
 *      (NextAuth v4 HS256 JWEs are NOT used here — NextAuth v4 defaults to
 *      JWE-encrypted JWTs, so this path only works if NextAuth is configured
 *      for signed-not-encrypted tokens OR if we eventually issue our own
 *      service tokens signed with NEXTAUTH_SECRET).
 *      For now: not actively used, but wired in so future clients can use it.
 *
 * All /api routes require auth EXCEPT /api/health which stays open for
 * monitoring (Caddy → localhost:3456/api/health from the heartbeat script).
 *
 * After successful auth: req.user = { email, source, role, userId, permissions }
 * and res.locals.userEmail is set so routes can log `created_by` / `updated_by`.
 *
 * Platform Role System headers (forwarded by Next.js proxy):
 *   - x-user-role: user's role name (e.g. 'admin', 'leadership', 'employee')
 *   - x-user-id: toolbox_users UUID
 *   - x-user-permissions: comma-separated permission keys
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const { getUserByEmailForAuth, getUserPermissionsForAuth } = require('../lib/db');
const { getRequestLogger, logRequestError } = require('../lib/requestLog');
const { fail } = require('./errorResponse');

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || '';

const SAFE_EQUAL_HMAC_KEY = 'toolbox-internal-secret-comparison-v1';
const ACTIVE_STATUS_CACHE_TTL_MS = 60 * 1000;
const activeStatusCache = new Map();

// HMAC digests are fixed-length, so this compares all string inputs with
// crypto.timingSafeEqual without exposing a length-mismatch fast path.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = crypto.createHmac('sha256', SAFE_EQUAL_HMAC_KEY).update(a, 'utf8').digest();
  const right = crypto.createHmac('sha256', SAFE_EQUAL_HMAC_KEY).update(b, 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

function unauthorized(res, reason) {
  // Don't leak which check failed — just return a generic 401
  if (process.env.DEBUG_AUTH === '1') {
    getRequestLogger(res).debug({ reason }, 'Auth rejected');
  }
  return fail(res, 401, 'Unauthorized');
}

function identityLookupFailed(req, res, error) {
  logRequestError(
    req,
    'auth.identity_lookup',
    error,
    { credentialSource: 'jwt' },
    'Authentication identity lookup failed'
  );
  return fail(res, 500, 'Internal server error');
}

function getRoleName(user) {
  const role = Array.isArray(user && user.role) ? user.role[0] : user && user.role;
  return role && typeof role.name === 'string' ? role.name : null;
}

function getInternalUser(headers) {
  const userEmail = String(headers['x-user-email'] || 'system');
  return {
    email: userEmail,
    source: 'internal',
    role: typeof headers['x-user-role'] === 'string' ? headers['x-user-role'] : null,
    userId: typeof headers['x-user-id'] === 'string' ? headers['x-user-id'] : null,
    permissions: typeof headers['x-user-permissions'] === 'string'
      ? headers['x-user-permissions'].split(',').map((value) => value.trim()).filter(Boolean)
      : [],
  };
}

function clearActiveStatusCache() {
  activeStatusCache.clear();
}

async function checkInternalUserActive(req, res, user) {
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  if (!email || email.toLowerCase() === 'system') return true;

  const cacheKey = email.toLowerCase();
  const cached = activeStatusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.isActive) unauthorized(res, 'user-deactivated');
    return cached.isActive;
  }
  if (cached) activeStatusCache.delete(cacheKey);

  try {
    const dbUser = await getUserByEmailForAuth(email);
    const isActive = dbUser?.is_active !== false;
    activeStatusCache.set(cacheKey, {
      isActive,
      expiresAt: Date.now() + ACTIVE_STATUS_CACHE_TTL_MS,
    });
    if (!isActive) {
      unauthorized(res, 'user-deactivated');
      return false;
    }
    return true;
  } catch (error) {
    logRequestError(
      req,
      'auth.internal_active_status',
      error,
      { credentialSource: 'internal' },
      'Internal user active-status lookup failed; allowing request'
    );
    return true;
  }
}

async function getJwtUser(decoded) {
  const emailClaim = decoded && (decoded.email || decoded.sub);
  if (typeof emailClaim !== 'string' || !emailClaim.trim()) return null;

  const user = await getUserByEmailForAuth(emailClaim);
  if (!user || !user.id) return null;
  if (user.is_active === false) return null;

  const permissions = await getUserPermissionsForAuth(user.id, user.role_id);
  return {
    email: typeof user.email === 'string' ? user.email : emailClaim,
    source: 'jwt',
    role: getRoleName(user),
    userId: user.id,
    permissions: Array.isArray(permissions) ? permissions : [],
  };
}

/**
 * requireAuth — blocks the request if no valid credential is present.
 *
 * Credential sources (in order of precedence):
 *   1. x-internal-secret header matching INTERNAL_API_SECRET
 *   2. Authorization: Bearer <jwt> signed with NEXTAUTH_SECRET
 */
async function requireAuth(req, res, next) {
  // Fail-closed: if secrets are not configured, refuse all traffic.
  // This prevents an accidental unauthenticated deployment.
  if (!INTERNAL_API_SECRET && !NEXTAUTH_SECRET) {
    getRequestLogger(req).fatal({
      operation: 'auth.config_missing',
      context: {},
      error: 'INTERNAL_API_SECRET and NEXTAUTH_SECRET both missing',
    }, 'Auth not configured - INTERNAL_API_SECRET and NEXTAUTH_SECRET both missing');
    return fail(res, 503, 'Auth not configured');
  }

  // Path 1 — internal proxy secret
  const internalSecret = req.headers['x-internal-secret'];
  if (INTERNAL_API_SECRET && internalSecret) {
    if (safeEqual(String(internalSecret), INTERNAL_API_SECRET)) {
      req.user = getInternalUser(req.headers);
      if (!await checkInternalUserActive(req, res, req.user)) return undefined;
      res.locals.userEmail = req.user.email;
      return next();
    }
    return unauthorized(res, 'internal-secret-mismatch');
  }

  // Path 2 — Authorization: Bearer <jwt>
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (NEXTAUTH_SECRET && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    let decoded;
    try {
      decoded = jwt.verify(token, NEXTAUTH_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      return unauthorized(res, `jwt-verify-failed: ${err.message}`);
    }

    try {
      const user = await getJwtUser(decoded);
      if (!user) return unauthorized(res, 'jwt-user-not-found');
      req.user = user;
      res.locals.userEmail = user.email;
      return next();
    } catch (error) {
      return identityLookupFailed(req, res, error);
    }
  }

  return unauthorized(res, 'no-credentials');
}

/**
 * optionalAuth — sets req.user if credentials are present/valid but does not
 * block the request. Useful for endpoints where auth adds context but isn't
 * required. Currently unused; exported for future routes.
 */
async function optionalAuth(req, res, next) {
  const internalSecret = req.headers['x-internal-secret'];
  if (INTERNAL_API_SECRET && internalSecret && safeEqual(String(internalSecret), INTERNAL_API_SECRET)) {
    req.user = getInternalUser(req.headers);
    if (!await checkInternalUserActive(req, res, req.user)) return undefined;
    res.locals.userEmail = req.user.email;
    return next();
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (NEXTAUTH_SECRET && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    let decoded;
    try {
      decoded = jwt.verify(token, NEXTAUTH_SECRET, { algorithms: ['HS256'] });
    } catch {
      // Invalid optional credentials do not establish an identity.
    }

    if (decoded) {
      try {
        const user = await getJwtUser(decoded);
        if (user) {
          req.user = user;
          res.locals.userEmail = user.email;
        }
      } catch (error) {
        return identityLookupFailed(req, res, error);
      }
    }
  }

  req.user = req.user || null;
  next();
}

module.exports = {
  safeEqual,
  clearActiveStatusCache,
  requireAuth,
  optionalAuth,
};
