'use strict';

let sentry = null;
let initialized = false;

function buildRelease() {
  if (process.env.SENTRY_RELEASE) {
    return process.env.SENTRY_RELEASE;
  }

  try {
    const pkg = require('../package.json');
    return `${pkg.name || 'invoice-api'}@${pkg.version || '0.0.0'}`;
  } catch {
    return undefined;
  }
}

function initSentry() {
  if (initialized) {
    return sentry;
  }

  initialized = true;

  if (!process.env.SENTRY_DSN) {
    return null;
  }

  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: buildRelease(),
  });

  sentry = Sentry;
  return sentry;
}

function captureException(error, context = {}) {
  const Sentry = initSentry();
  if (!Sentry || !error) {
    return false;
  }

  Sentry.withScope((scope) => {
    if (context.operation) scope.setTag('operation', context.operation);
    if (context.requestId) scope.setTag('requestId', context.requestId);
    if (context.status) scope.setTag('status', String(context.status));

    scope.setContext('request', {
      method: context.method || undefined,
      path: context.path || undefined,
      route: context.route || undefined,
      requestId: context.requestId || undefined,
    });

    if (context.details && typeof context.details === 'object') {
      scope.setContext('details', context.details);
    }

    Sentry.captureException(error);
  });

  return true;
}

module.exports = {
  captureException,
  initSentry,
};
