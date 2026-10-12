'use strict';

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers["x-internal-secret"]',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers["x-internal-secret"]',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  base: {
    service: 'invoice-api',
    version: '1.0.0',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,service,version',
          },
        },
      }),
});

module.exports = logger;