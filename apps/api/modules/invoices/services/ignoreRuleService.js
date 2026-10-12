'use strict';

const { pool } = require('./supabase');

async function listIgnoreRules({ limit, offset }) {
  const result = await pool.query(
    'SELECT * FROM ignore_rules ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return result.rows;
}

async function createIgnoreRule({ type, value, reason }) {
  const result = await pool.query(
    'INSERT INTO ignore_rules (field, pattern, reason) VALUES ($1, $2, $3) RETURNING *',
    [type, value, reason]
  );
  return result.rows[0];
}

async function deleteIgnoreRule(id) {
  const result = await pool.query('DELETE FROM ignore_rules WHERE id = $1', [id]);
  return result.rowCount;
}

module.exports = { createIgnoreRule, deleteIgnoreRule, listIgnoreRules };
