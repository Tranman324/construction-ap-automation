'use strict';
/**
 * Feature Request Board — Express Routes
 *
 * Mounted at /api/feature-requests in the main server.
 * Auth: requireAuth middleware applied before mount (same pattern as invoices).
 * User identity: req.user.email (set by auth middleware from x-user-email header).
 */

const express = require('express');
const router = express.Router();
const {
  castFeatureRequestVote,
  createFeatureRequest,
  deleteFeatureRequest,
  getActiveFeatureRequest,
  listFeatureRequests,
  removeFeatureRequestVote,
  updateFeatureRequest,
} = require('./featureRequestService');
const { getAvatarUrlByEmail } = require('../invoices/routes/users');
const { logRequestError } = require('../../lib/requestLog');
const { validate } = require('../../middleware/validate');
const { checkPermission, requirePermission } = require('../../middleware/permissions');
const {
  featureRequestSchema,
  featureRequestsQuerySchema,
  featureRequestUpdateSchema,
  featureVoteSchema,
} = require('../../lib/schemas');
const { getPagination } = require('../../lib/pagination');
const { fail } = require('../../middleware/errorResponse');

const requireFeatureRequestManage = requirePermission('feature_requests.manage');

function requireManageForStatusChange(req, res, next) {
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
    return next();
  }

  return requireFeatureRequestManage(req, res, next);
}

function logRouteError(req, operation, error, context) {
  logRequestError(req, operation, error, context, 'feature request route failed');
}

// ─── Validation helpers ───────────────────────────────────────────────────────
const VALID_CATEGORIES = new Set(['workflow', 'reporting', 'integration', 'design', 'admin']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'completed', 'declined']);

const STATUS_TRANSITIONS = {
  open: ['in_progress', 'declined'],
  in_progress: ['completed', 'open'],
  completed: ['open'],
  declined: ['open'],
};

// ─── 1. GET /api/feature-requests ─────────────────────────────────────────────
// Returns all non-deleted requests with vote counts and voter details.
router.get('/', validate(featureRequestsQuerySchema, 'query'), async (req, res) => {
  try {
    const { category, status = 'open' } = req.query;
    const userEmail = req.user.email;
    const { limit, offset } = getPagination(req.query);

    const rows = await listFeatureRequests({ category, status, userEmail, limit, offset, validCategories: VALID_CATEGORIES, validStatuses: VALID_STATUSES });

    const requests = rows.map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      status: r.status,
      authorName: r.author_name,
      authorEmail: r.author_email,
      authorImage: getAvatarUrlByEmail(r.author_email) || null,
      mustHaveVotes: r.must_have_votes,
      niceToHaveVotes: r.nice_to_have_votes,
      totalVotes: r.total_votes,
      currentUserVote: r.current_user_vote || null,
      voters: (typeof r.voters === 'string' ? JSON.parse(r.voters) : r.voters).map(v => ({
        ...v,
        image: getAvatarUrlByEmail(v.email) || null,
      })),
      createdAt: r.created_at ? r.created_at.toISOString() : null,
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
    }));

    res.json({ requests, total: requests.length });
  } catch (err) {
    logRouteError(req, 'listFeatureRequests', err);
    return fail(res, 500, 'Failed to load feature requests');
  }
});

// ─── 2. POST /api/feature-requests ────────────────────────────────────────────
// Create a new feature request.
router.post('/', validate(featureRequestSchema), async (req, res) => {
  try {
    const { title, description, category } = req.body;
    const userEmail = req.user.email;

    // Derive author name from email (best effort — format: first.last@domain)
    // The frontend should send x-user-name header for better display names.
    const authorName = req.headers['x-user-name']
      || userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const r = await createFeatureRequest({ title, description, category, userEmail, authorName });
    res.status(201).json({
      request: {
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        status: r.status,
        authorName: r.author_name,
        authorEmail: r.author_email,
        authorImage: getAvatarUrlByEmail(r.author_email) || null,
        mustHaveVotes: 0,
        niceToHaveVotes: 0,
        totalVotes: 0,
        currentUserVote: null,
        voters: [],
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      },
    });
  } catch (err) {
    logRouteError(req, 'createFeatureRequest', err, { category: req.body?.category || null });
    return fail(res, 500, 'Failed to create feature request');
  }
});

// ─── 3. PATCH /api/feature-requests/:id ───────────────────────────────────────
// Author can edit title/description/category. Status changes require feature_requests.manage.
router.patch('/:id', validate(featureRequestUpdateSchema), requireManageForStatusChange, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;
    const { title, description, category, status } = req.body;

    // Fetch existing record
    const record = await getActiveFeatureRequest(id);
    if (!record) {
      return fail(res, 404, 'Feature request not found');
    }
    const userCanManage = checkPermission(req, 'feature_requests.manage');
    const userIsAuthor = record.author_email.toLowerCase() === userEmail.toLowerCase();

    if (!userCanManage && !userIsAuthor) {
      return fail(res, 403, 'You can only edit your own requests');
    }

    const updates = {};

    // Author fields (author OR feature-request manager can edit)
    if (title !== undefined && (userIsAuthor || userCanManage)) {
      if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 120) {
        return fail(res, 400, 'title must be 1-120 characters');
      }
      updates.title = title.trim();
    }
    if (description !== undefined && (userIsAuthor || userCanManage)) {
      if (typeof description !== 'string' || description.trim().length === 0 || description.trim().length > 500) {
        return fail(res, 400, 'description must be 1-500 characters');
      }
      updates.description = description.trim();
    }
    if (category !== undefined && (userIsAuthor || userCanManage)) {
      if (!VALID_CATEGORIES.has(category)) {
        return fail(res, 400, `category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
      }
      updates.category = category;
    }

    // Status (feature-request manager only)
    if (status !== undefined) {
      if (!userCanManage) {
        return fail(res, 403, 'Missing required permission');
      }
      if (!VALID_STATUSES.has(status)) {
        return fail(res, 400, `status must be one of: ${[...VALID_STATUSES].join(', ')}`);
      }
      const allowed = STATUS_TRANSITIONS[record.status] || [];
      if (!allowed.includes(status)) {
        return fail(res, 400, `Cannot transition from '${record.status}' to '${status}'. Allowed: ${allowed.join(', ')}`);
      }
      updates.status = status;
    }

    if (!Object.keys(updates).length) {
      return fail(res, 400, 'No valid fields to update');
    }

    const r = await updateFeatureRequest(id, updates);
    res.json({
      request: {
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        status: r.status,
        authorName: r.author_name,
        authorEmail: r.author_email,
        authorImage: getAvatarUrlByEmail(r.author_email) || null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      },
    });
  } catch (err) {
    logRouteError(req, 'updateFeatureRequest', err, { featureRequestId: req.params.id });
    return fail(res, 500, 'Failed to update feature request');
  }
});

// ─── 4. DELETE /api/feature-requests/:id ──────────────────────────────────────
// Feature-request manager only. Hard delete (cascades votes).
router.delete('/:id', requireFeatureRequestManage, async (req, res) => {
  try {
    const { id } = req.params;

    if (!(await deleteFeatureRequest(id))) {
      return fail(res, 404, 'Feature request not found');
    }

    res.json({ deleted: true, id });
  } catch (err) {
    logRouteError(req, 'deleteFeatureRequest', err, { featureRequestId: req.params.id });
    return fail(res, 500, 'Failed to delete feature request');
  }
});

// ─── 5. POST /api/feature-requests/:id/vote ───────────────────────────────────
// Cast or update a vote. Upsert on (feature_request_id, user_email).
router.post('/:id/vote', validate(featureVoteSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;
    const { voteType } = req.body;

    // Verify request exists
    if (!(await getActiveFeatureRequest(id))) {
      return fail(res, 404, 'Feature request not found');
    }

    // Derive voter name
    const userName = req.headers['x-user-name']
      || userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Upsert: insert or update vote type
    const v = await castFeatureRequestVote({ featureRequestId: id, userEmail, userName, voteType });
    res.json({
      vote: {
        id: v.id,
        featureRequestId: v.feature_request_id,
        userEmail: v.user_email,
        userName: v.user_name,
        voteType: v.vote_type,
        createdAt: v.created_at.toISOString(),
      },
    });
  } catch (err) {
    logRouteError(req, 'castFeatureRequestVote', err, { featureRequestId: req.params.id });
    return fail(res, 500, 'Failed to cast vote');
  }
});

// ─── 6. DELETE /api/feature-requests/:id/vote ─────────────────────────────────
// Remove current user's vote.
router.delete('/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    if (!(await removeFeatureRequestVote({ featureRequestId: id, userEmail }))) {
      return fail(res, 404, 'No vote found to remove');
    }

    res.json({ removed: true });
  } catch (err) {
    logRouteError(req, 'removeFeatureRequestVote', err, { featureRequestId: req.params.id });
    return fail(res, 500, 'Failed to remove vote');
  }
});

module.exports = router;
