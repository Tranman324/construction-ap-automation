'use strict';

const { getRequestLogger } = require('../lib/requestLog');
const { captureException } = require('../lib/sentry');
const { canonicalizeErrorBody, errorBody, sendError } = require('../lib/response');

function fail(res, status, message, legacyDetailsOrCode, details) {
  // Existing route callers supplied a fourth details argument before A7b. Keep
  // that call shape compatible. A legacy details object may already contain a
  // machine-readable code; promote it rather than leaving code nested.
  if (arguments.length < 5) {
    if (legacyDetailsOrCode
      && typeof legacyDetailsOrCode === 'object'
      && !Array.isArray(legacyDetailsOrCode)
      && typeof legacyDetailsOrCode.code === 'string') {
      const { code, ...legacyDetails } = legacyDetailsOrCode;
      return sendError(
        res,
        status,
        message,
        code,
        Object.keys(legacyDetails).length > 0 ? legacyDetails : undefined
      );
    }
    return sendError(res, status, message, undefined, legacyDetailsOrCode);
  }
  return sendError(res, status, message, legacyDetailsOrCode, details);
}

function failFromBody(res, status, body) {
  const normalized = canonicalizeErrorBody(body);
  return sendError(res, status, normalized.error, normalized.code, normalized.details);
}

function safeError(res, err, context = 'unknown') {
  // Only trust status-like values that are real HTTP codes. Child-process
  // errors carry `status` = exit code (e.g. qpdf exit 3), which previously
  // leaked into res.status() and crashed with a RangeError.
  const rawStatus = err?.statusCode || err?.status || 500;
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const req = res.req;
  const requestLog = getRequestLogger(req || res);
  const errorContext = {
    route: context,
    method: req?.method,
    path: req?.originalUrl,
    status,
  };

  requestLog.error({
    operation: 'request.error',
    context: errorContext,
    error: err && err.message ? err.message : String(err),
    err,
  }, 'Request failed');

  if (status >= 500) {
    captureException(err, {
      operation: 'request.error',
      route: context,
      method: req?.method,
      path: req?.originalUrl,
      requestId: req?.requestId,
      status,
    });
  }

  if (status < 500) {
    return fail(res, status, err?.message || 'Bad request');
  }

  return fail(res, 500, 'Internal server error');
}

module.exports = { errorBody, fail, failFromBody, safeError };
