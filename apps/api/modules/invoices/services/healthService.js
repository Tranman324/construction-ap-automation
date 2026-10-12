'use strict';

const { pool } = require('./supabase');

async function getPendingDocumentCount() {
  const result = await pool.query('SELECT COUNT(*) FROM documents WHERE status = $1', ['pending']);
  return parseInt(result.rows[0].count, 10);
}

module.exports = { getPendingDocumentCount };
