'use strict';
// PROBE: importing the invoices supabase re-export of the pool must fail lint.
const { pool } = require('../services/supabase');
module.exports = pool;
