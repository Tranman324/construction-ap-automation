'use strict';

/**
 * GET /api/users          — List NCG employees from Azure AD (cached 15 min)
 * GET /api/users/:id/photo — Proxy user photo from Graph API (cached 1 hour)
 *
 * Uses Client Credentials Flow (same app registration as invoice pipeline).
 * No additional Entra ID permissions needed — The Teams bot app already has User.Read.All.
 */

const express = require('express');
const router = express.Router();
const msal = require('@azure/msal-node');
const logger = require('../../../lib/logger');
const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const { paginationQuerySchema, resourceIdParamsSchema } = require('../../../lib/schemas');
const { fail } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');

// ─── MSAL Client ──────────────────────────────────────────────────────────────

let cca = null;

function getMsalClient() {
  if (cca) {
    return cca;
  }

  const clientId = process.env.MS_CLIENT_ID;
  const tenantId = process.env.MS_TENANT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  if (!clientId || !tenantId || !clientSecret) {
    const missing = [
      ['MS_CLIENT_ID', clientId],
      ['MS_TENANT_ID', tenantId],
      ['MS_CLIENT_SECRET', clientSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    const err = new Error(`Azure Graph auth not configured (${missing.join(', ')})`);
    err.status = 503;
    throw err;
  }

  cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });

  return cca;
}

async function getToken() {
  const result = await getMsalClient().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const USER_FIELDS = 'id,displayName,mail,jobTitle,department,mobilePhone,userPrincipalName';

let _userCache = null;
let _userCacheAt = 0;
const USER_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const _photoCache = new Map(); // `${id}|${size}` → { buffer, contentType, cachedAt }
const PHOTO_CACHE_TTL = 60 * 60 * 1000; // 1 hour (server-side)
const PHOTO_CACHE_MAX = 100; // max cached photos

// Photos are employee PII behind an authenticated proxy: browsers may cache
// briefly, shared caches must not (BE-B/§3.7 "cache headers deliberate").
const PHOTO_CACHE_CONTROL = 'private, max-age=300';

// Graph's fixed thumbnail sizes (mirrors GraphUserPhotoSize in apps/web
// src/modules/shared/lib/graphPhoto.ts — keep in sync).
const PHOTO_SIZES = new Set([
  '48x48', '64x64', '96x96', '120x120', '240x240',
  '360x360', '432x432', '504x504', '648x648',
]);

/**
 * Pure request planner for the photo proxy. Returns either
 * `{ error: 'invalid-size' }` or `{ graphPath, cacheKey }`.
 * No size → full-size photo; a listed size → Graph's sized thumbnail.
 */
function buildPhotoFetchPlan(id, size) {
  if (size === undefined || size === null || size === '') {
    return {
      graphPath: `/users/${encodeURIComponent(id)}/photo/$value`,
      cacheKey: `${id}|full`,
    };
  }
  if (typeof size !== 'string' || !PHOTO_SIZES.has(size)) {
    return { error: 'invalid-size' };
  }
  return {
    graphPath: `/users/${encodeURIComponent(id)}/photos/${size}/$value`,
    cacheKey: `${id}|${size}`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRole(jobTitle) {
  if (!jobTitle) return 'viewer';
  const t = jobTitle.toLowerCase();
  if (t.includes('cfo') || t.includes('director') || t.includes('president')) return 'admin';
  if (t.includes('controller') || t.includes('finance')) return 'controller';
  if (t.includes('project manager') || t.includes('senior project') || t.includes('assistant project') || t.includes('preconstruction')) return 'pm';
  if (t.includes('superintendent') || t.includes('general superintendent')) return 'superintendent';
  if (t.includes('estimat')) return 'pm'; // estimators get PM-level access
  return 'viewer';
}

function formatUser(u) {
  return {
    id: u.id,
    azure_id: u.id,
    name: u.displayName,
    email: u.mail || u.userPrincipalName,
    job_title: u.jobTitle || null,
    department: u.department || null,
    phone: u.mobilePhone || null,
    role: mapRole(u.jobTitle),
    avatar_url: `/api/users/${u.id}/photo`,
    is_active: true,
  };
}

// ─── Shared fetch logic ─────────────────────────────────────────────────────

async function refreshUserCache() {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users?$top=100&$select=${USER_FIELDS}&$filter=accountEnabled eq true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const allUsers = (data.value || []).map(formatUser);

  // Filter out service accounts / shared mailboxes
  const users = allUsers.filter(u =>
    u.email &&
    u.email.toLowerCase().endsWith('@northwindcg.example') &&
    !['admin@northwindcg.example', 'info@northwindcg.example', 'invoices@northwindcg.example'].includes(u.email.toLowerCase())
  );

  // A name collision must not move entries between offset pages.
  users.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  _userCache = users;
  _userCacheAt = Date.now();
  return users;
}

// Auto-warm cache on startup (non-blocking)
refreshUserCache().then(users => {
  logger.info({ userCount: users.length }, 'User cache warmed');
}).catch(err => {
  logger.warn({ err }, 'User cache warm failed; will retry on first request');
});

// ─── GET /api/users ───────────────────────────────────────────────────────────

router.get('/', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const now = Date.now();
    const { limit, offset } = getPagination(req.query);

    // Return cache if fresh
    if (_userCache && (now - _userCacheAt) < USER_CACHE_TTL) {
      return res.json(_userCache.slice(offset, offset + limit));
    }

    const users = await refreshUserCache();
    res.json(users.slice(offset, offset + limit));
  } catch (err) {
    req.log.error({
      operation: 'users.list',
      context: {},
      error: err && err.message ? err.message : String(err),
      err,
    }, 'Failed to fetch users');
    return fail(res, 500, 'Failed to fetch users');
  }
});

// ─── GET /api/users/:id/photo ─────────────────────────────────────────────────

router.get('/:id/photo', requirePermission('accounting.invoices.view_details'), validate(resourceIdParamsSchema, 'params'), async (req, res) => {
  try {
    const { id } = req.params;
    const now = Date.now();

    const plan = buildPhotoFetchPlan(id, req.query.size);
    if (plan.error) {
      return fail(res, 400, 'Invalid photo size', { allowed: [...PHOTO_SIZES] });
    }

    // Check cache
    const cached = _photoCache.get(plan.cacheKey);
    if (cached && (now - cached.cachedAt) < PHOTO_CACHE_TTL) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', PHOTO_CACHE_CONTROL);
      return res.send(cached.buffer);
    }

    const token = await getToken();
    const response = await fetch(
      `https://graph.microsoft.com/v1.0${plan.graphPath}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
      // User has no photo — return 404, frontend shows initials fallback
      if (response.status === 404) {
        return fail(res, 404, 'No photo available');
      }
      return fail(res, 502, 'Graph API photo error', { status: response.status });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Cache the photo
    if (_photoCache.size >= PHOTO_CACHE_MAX) {
      // Evict oldest
      let oldest = null;
      let oldestTime = Infinity;
      for (const [key, val] of _photoCache) {
        if (val.cachedAt < oldestTime) {
          oldest = key;
          oldestTime = val.cachedAt;
        }
      }
      if (oldest) _photoCache.delete(oldest);
    }
    _photoCache.set(plan.cacheKey, { buffer, contentType, cachedAt: now });

    res.set('Content-Type', contentType);
    res.set('Cache-Control', PHOTO_CACHE_CONTROL);
    res.send(buffer);
  } catch (err) {
    req.log.error({
      operation: 'users.photo',
      context: { userId: req.params.id },
      error: err && err.message ? err.message : String(err),
      err,
    }, 'Failed to fetch user photo');
    return fail(res, 500, 'Failed to fetch photo');
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;

/**
 * Look up a user's avatar URL by email (case-insensitive).
 * Returns the frontend-accessible photo URL path (through /api/backend/ proxy)
 * or null if cache is cold / user not found.
 */
module.exports.buildPhotoFetchPlan = buildPhotoFetchPlan;
module.exports.PHOTO_CACHE_CONTROL = PHOTO_CACHE_CONTROL;

module.exports.getAvatarUrlByEmail = function getAvatarUrlByEmail(email) {
  if (!_userCache || !email) return null;
  const needle = email.toLowerCase();
  const user = _userCache.find(u => u.email && u.email.toLowerCase() === needle);
  return user ? `/api/backend/users/${user.azure_id}/photo` : null;
};
