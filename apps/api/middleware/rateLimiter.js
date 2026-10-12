'use strict';

const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.default || rateLimitModule;
const { ipKeyGenerator } = rateLimitModule;

function getRateLimitKey(req) {
  if (req.user?.userId) return req.user.userId;
  if (req.user?.email) return req.user.email;
  return typeof ipKeyGenerator === 'function' ? ipKeyGenerator(req.ip) : req.ip;
}

function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message,
    keyGenerator: getRateLimitKey,
  });
}

const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
});

const writeLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
});

const readLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { error: 'Too many requests, please try again later.' },
});

const pipelineLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many pipeline requests. Please try again later.' },
});

const healthLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests.' },
});

function methodLimiter(req, res, next) {
  const method = req.method.toUpperCase();

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return writeLimiter(req, res, next);
  }

  return readLimiter(req, res, next);
}

module.exports = {
  createLimiter,
  getRateLimitKey,
  authLimiter,
  writeLimiter,
  readLimiter,
  pipelineLimiter,
  healthLimiter,
  methodLimiter,
};
