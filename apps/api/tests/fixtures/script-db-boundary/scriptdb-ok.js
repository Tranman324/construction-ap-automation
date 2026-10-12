'use strict';
// A migrated script using scriptDb must pass the boundary lint.
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
module.exports = pool;
