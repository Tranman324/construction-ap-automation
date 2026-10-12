'use strict';
// PROBE: a script importing the shared API pool directly must fail lint.
const pool = require('../../../lib/db');
module.exports = pool;
