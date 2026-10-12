'use strict';

const { pool } = require('./supabase');

async function listPipelineErrors({ resolved, limit, offset }) {
  const filter = resolved === 'all' ? '' : `WHERE resolved = ${resolved === 'true'}`;
  const result = await pool.query(
    `SELECT * FROM pipeline_errors ${filter} ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function resolvePipelineError(id) {
  await pool.query('UPDATE pipeline_errors SET resolved = true WHERE id = $1', [id]);
}

async function retryPipelineError(id) {
  await pool.query('UPDATE pipeline_errors SET retry_count = 0, resolved = false WHERE id = $1', [id]);
}

module.exports = { listPipelineErrors, resolvePipelineError, retryPipelineError };
