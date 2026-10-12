'use strict';

// Compatibility entry point for the waiver flow. Recipient parsing is shared
// with document reply composition; waiver-specific eligibility stays separate.
module.exports = require('./recipientResolutionParsing');
