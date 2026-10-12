'use strict';

const crypto = require('crypto');

const logger = require('../lib/logger');

function requestLogger(req, res, next) {
  req.requestId = crypto.randomUUID().slice(0, 8);
  req.log = logger.child({ requestId: req.requestId });

  const start = Date.now();
  const { method, originalUrl } = req;
  const ip = req.ip;

  res.setHeader('X-Request-Id', req.requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const user = req.user?.email || 'anonymous';
    const level = res.statusCode >= 500
      ? 'error'
      : res.statusCode >= 400
        ? 'warn'
        : 'info';

    req.log[level](
      {
        method,
        path: originalUrl,
        status: res.statusCode,
        durationMs,
        user,
        ip,
      },
      `${method} ${originalUrl} -> ${res.statusCode} (${durationMs}ms)`
    );
  });

  next();
}

module.exports = requestLogger;
