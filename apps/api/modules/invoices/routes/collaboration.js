'use strict';

const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const {
  commentCreateSchema,
  documentEmailAttemptParamsSchema,
  documentEmailEmptyBodySchema,
  documentEmailQuerySchema,
  documentEmailTokenSchema,
  documentForwardSchema,
  documentReplySchema,
  paginationQuerySchema,
  resourceIdParamsSchema,
} = require('../../../lib/schemas');
const { fail, safeError } = require('../../../middleware/errorResponse');
const logger = require('../../../lib/logger');

const COLLABORATION_ROUTE_FAMILIES = Object.freeze({
  invoice: Object.freeze({ basePath: '/api/invoices' }),
  document: Object.freeze({ basePath: '/api/documents' }),
});

function routeFamilyConfig(routeFamily) {
  const config = COLLABORATION_ROUTE_FAMILIES[routeFamily];
  if (!config) throw new Error(`Unknown collaboration route family: ${routeFamily}`);
  return config;
}

function emailAttemptAction(routeFamily, action, getEmail) {
  return async (req, res) => {
    const email = getEmail();
    try {
      return res.json(await email[action](req.params.attemptId));
    } catch (err) {
      if (err instanceof email.EmailError) return fail(res, err.statusCode, err.message, err.code, err.details);
      (req.log || logger).error({ operation: `${routeFamily}.email_attempt.${action}`, attemptId: req.params.attemptId }, 'Email attempt request failed');
      return fail(res, 500, 'Internal server error');
    }
  };
}

function token(req, res, next) {
  const parsed = documentEmailTokenSchema.safeParse(req.get('X-Send-Token'));
  if (!parsed.success) return fail(res, 400, 'Valid X-Send-Token UUID header required');
  req.emailSendToken = parsed.data;
  next();
}

function emailAction(routeFamily, action, getEmail) {
  return async (req, res) => {
    const email = getEmail();
    try {
      return res.json(await email[action](req.params.id, req.user, req.body, req.emailSendToken));
    } catch (err) {
      if (err instanceof email.EmailError) return fail(res, err.statusCode, err.message, err.code, err.details);
      // Graph and database errors may contain message content: never serialize raw errors here.
      (req.log || logger).error({ operation: `${routeFamily}.${action}`, documentId: req.params.id }, 'Document email request failed');
      return fail(res, 500, 'Internal server error');
    }
  };
}

function registerCollaborationRoutes(router, routeFamily, dependencies = {}) {
  const { basePath } = routeFamilyConfig(routeFamily);
  const permission = 'accounting.invoices.view_details';
  const emailPermission = 'accounting.invoices.request_waiver';
  const getCommentService = () => dependencies.commentService || require('../services/commentService');
  const getActivityService = () => dependencies.activityService || require('../services/activityService');
  const getEmail = () => dependencies.email || require('../services/email');

  router.post('/:id/comments', requirePermission(permission), validate(resourceIdParamsSchema, 'params'), validate(commentCreateSchema), async (req, res) => {
    try {
      const { createComment } = getCommentService();
      const comment = await createComment({ documentId: req.params.id, body: req.body.body, actor: req.user });
      return res.status(201).json({ comment });
    } catch (err) {
      const clientError = err && err.statusCode >= 400 && err.statusCode < 500 ? err : new Error('Comment persistence failed');
      return safeError(res, clientError, `POST ${basePath}/:id/comments`);
    }
  });

  router.get('/:id/activity', requirePermission(permission), validate(resourceIdParamsSchema, 'params'), validate(paginationQuerySchema, 'query'), async (req, res) => {
    try {
      const { getActivity } = getActivityService();
      return res.json(await getActivity(req.params.id, req.query));
    }
    catch (err) { return safeError(res, err, `GET ${basePath}/:id/activity`); }
  });

  router.post('/:id/activity/view', requirePermission(permission), validate(resourceIdParamsSchema, 'params'), validate(documentEmailEmptyBodySchema), async (req, res) => {
    try {
      const { viewActivity } = getActivityService();
      return res.json(await viewActivity(req.params.id));
    }
    catch (err) { return safeError(res, err, `POST ${basePath}/:id/activity/view`); }
  });

  router.get('/email-attempts/:attemptId', requirePermission(permission),
    validate(documentEmailAttemptParamsSchema, 'params'), emailAttemptAction(routeFamily, 'getEmailAttemptStatus', getEmail));
  router.post('/email-attempts/:attemptId/reconcile', requirePermission(permission),
    validate(documentEmailAttemptParamsSchema, 'params'), validate(documentEmailEmptyBodySchema),
    emailAttemptAction(routeFamily, 'reconcileEmailAttempt', getEmail));

  router.post('/:id/reply', requirePermission(emailPermission), validate(resourceIdParamsSchema, 'params'), validate(documentReplySchema), token, emailAction(routeFamily, 'sendReply', getEmail));
  router.get('/:id/reply-recipient', requirePermission(emailPermission), validate(resourceIdParamsSchema, 'params'), validate(documentEmailQuerySchema, 'query'), emailAction(routeFamily, 'getReplyRecipient', getEmail));
  router.post('/:id/forward', requirePermission(emailPermission), validate(resourceIdParamsSchema, 'params'), validate(documentForwardSchema), token, emailAction(routeFamily, 'sendForward', getEmail));
  router.get('/:id/forward-defaults', requirePermission(emailPermission), validate(resourceIdParamsSchema, 'params'), validate(documentEmailQuerySchema, 'query'), emailAction(routeFamily, 'getForwardDefaults', getEmail));
}

function routeFamilyForOpensAs(opensAs) {
  return opensAs === 'invoice' ? 'invoice' : 'document';
}

module.exports = { COLLABORATION_ROUTE_FAMILIES, registerCollaborationRoutes, routeFamilyForOpensAs };
