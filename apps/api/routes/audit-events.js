'use strict';

const express = require('express');

const {
  insertAuditEvent,
  listAuditEvents,
} = require('../lib/auditEvents');
const { logRequestError } = require('../lib/requestLog');
const { auditEventCreateSchema, auditEventsQuerySchema } = require('../lib/schemas');
const { requirePermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { fail } = require('../middleware/errorResponse');

const router = express.Router();

const AUDIT_EVENTS_READ_PERMISSION = 'platform.manage_permissions';

function isUniqueViolation(error) {
  return Boolean(error && error.code === '23505');
}

function logRouteError(req, operation, error, context) {
  logRequestError(req, operation, error, context, 'audit-events route failed');
}

router.post('/events', validate(auditEventCreateSchema), async (req, res) => {
  try {
    // Deliberately no requirePermission here: ordinary authenticated invoice users
    // emit audit events. Their supplied actor is always replaced with req.user.
    const event = await insertAuditEvent({
      ...req.body,
      actor: {
        userId: req.user.userId || null,
        name: req.user.email,
        role: req.user.role || null,
      },
    });
    return res.status(201).json(event);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(res, 409, 'Conflict', 'Audit event id already exists');
    }

    logRouteError(req, 'createAuditEvent', error, { eventId: req.body && req.body.id });
    return fail(res, 500, 'Internal Server Error');
  }
});

router.get(
  '/events',
  requirePermission(AUDIT_EVENTS_READ_PERMISSION),
  validate(auditEventsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const result = await listAuditEvents(req.query);
      return res.json(result);
    } catch (error) {
      logRouteError(req, 'listAuditEvents', error, { query: req.query || {} });
      return fail(res, 500, 'Internal Server Error');
    }
  }
);

module.exports = router;
module.exports.AUDIT_EVENTS_READ_PERMISSION = AUDIT_EVENTS_READ_PERMISSION;
