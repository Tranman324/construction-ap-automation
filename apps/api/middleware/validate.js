'use strict';

const { getRequestLogger } = require('../lib/requestLog');
const { fail } = require('./errorResponse');

function validate(schema, source = 'body', errorStatus = 400) {
  return (req, res, next) => {
    const data = source === 'query'
      ? req.query
      : source === 'params'
        ? req.params
        : req.body;
    const result = schema.safeParse(data);

    if (!result.success) {
      const flat = result.error.flatten();
      const details = { ...flat.fieldErrors };

      if (flat.formErrors.length > 0) {
        details._errors = flat.formErrors;
      }

      getRequestLogger(req).warn({
        operation: 'request.validation_failed',
        context: {
          path: req.originalUrl,
          source,
        },
        errors: details,
      }, 'Validation failed');

      return fail(res, errorStatus, 'Validation failed', details);
    }

    if (source === 'query' || source === 'params') {
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req.body = result.data;
    }

    next();
  };
}

module.exports = { validate };
