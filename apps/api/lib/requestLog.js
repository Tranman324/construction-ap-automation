'use strict';

const logger = require('./logger');
const { captureException } = require('./sentry');

function getRequestLogger(reqOrRes) {
  if (reqOrRes && reqOrRes.log) {
    return reqOrRes.log;
  }

  if (reqOrRes && reqOrRes.req && reqOrRes.req.log) {
    return reqOrRes.req.log;
  }

  return logger;
}

function logRequestError(req, operation, error, context = {}, message = 'route failed') {
  const requestLog = getRequestLogger(req);
  const safeContext = context || {};

  requestLog.error({
    operation,
    context: safeContext,
    error: error && error.message ? error.message : String(error),
    err: error,
  }, message);

  captureException(error, {
    operation,
    details: safeContext,
    method: req && req.method,
    path: req && req.originalUrl,
    requestId: req && req.requestId,
  });
}

module.exports = {
  getRequestLogger,
  logRequestError,
};
