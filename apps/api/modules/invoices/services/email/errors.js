'use strict';
class EmailError extends Error {
  constructor(statusCode, message, code, details) {
    super(message); this.name = 'EmailError'; this.statusCode = statusCode;
    this.code = code; this.details = details;
  }
}
module.exports = { EmailError };
