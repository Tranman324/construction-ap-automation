'use strict';

const pool = require('../../lib/db');

async function listFeatureRequests({ category, status, userEmail, limit, offset, validCategories, validStatuses }) {
  const conditions = ['fr.deleted_at IS NULL'];
  const params = [];
  let parameter = 1;
  if (category && category !== 'all' && validCategories.has(category)) {
    conditions.push(`fr.category = $${parameter++}`);
    params.push(category);
  }
  if (status && status !== 'all' && validStatuses.has(status)) {
    conditions.push(`fr.status = $${parameter++}`);
    params.push(status);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await pool.query(
    `SELECT
       fr.*,
       COALESCE(vc.must_have_count, 0)::int AS must_have_votes,
       COALESCE(vc.nice_to_have_count, 0)::int AS nice_to_have_votes,
       COALESCE(vc.must_have_count, 0)::int + COALESCE(vc.nice_to_have_count, 0)::int AS total_votes,
       (SELECT fv.vote_type FROM feature_votes fv WHERE fv.feature_request_id = fr.id AND fv.user_email = $${parameter}) AS current_user_vote,
       COALESCE((SELECT json_agg(json_build_object('name', fv2.user_name, 'email', fv2.user_email, 'voteType', fv2.vote_type) ORDER BY fv2.created_at)
         FROM feature_votes fv2 WHERE fv2.feature_request_id = fr.id), '[]'::json) AS voters
     FROM feature_requests fr
     LEFT JOIN (SELECT feature_request_id, COUNT(*) FILTER (WHERE vote_type = 'must_have') AS must_have_count,
       COUNT(*) FILTER (WHERE vote_type = 'nice_to_have') AS nice_to_have_count FROM feature_votes GROUP BY feature_request_id) vc
       ON vc.feature_request_id = fr.id
     ${where}
     ORDER BY total_votes DESC, fr.created_at DESC, fr.id DESC
     LIMIT $${parameter + 1} OFFSET $${parameter + 2}`,
    [...params, userEmail, limit, offset]
  );
  return result.rows;
}

async function createFeatureRequest({ title, description, category, userEmail, authorName }) {
  const result = await pool.query(
    `INSERT INTO feature_requests (title, description, category, author_email, author_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [title.trim(), description.trim(), category, userEmail, authorName]
  );
  return result.rows[0];
}

async function getActiveFeatureRequest(id) {
  const result = await pool.query('SELECT * FROM feature_requests WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function updateFeatureRequest(id, changes) {
  const columns = { title: 'title', description: 'description', category: 'category', status: 'status' };
  const sets = [];
  const params = [];
  let parameter = 1;
  for (const [key, column] of Object.entries(columns)) {
    if (changes[key] === undefined) continue;
    sets.push(`${column} = $${parameter++}`);
    params.push(changes[key]);
  }
  sets.push('updated_at = NOW()');
  params.push(id);
  const result = await pool.query(
    `UPDATE feature_requests SET ${sets.join(', ')} WHERE id = $${parameter} RETURNING *`,
    params
  );
  return result.rows[0];
}

async function deleteFeatureRequest(id) {
  const result = await pool.query('DELETE FROM feature_requests WHERE id = $1', [id]);
  return result.rowCount > 0;
}

async function castFeatureRequestVote({ featureRequestId, userEmail, userName, voteType }) {
  const result = await pool.query(
    `INSERT INTO feature_votes (feature_request_id, user_email, user_name, vote_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (feature_request_id, user_email)
     DO UPDATE SET vote_type = $4, user_name = $3
     RETURNING *`,
    [featureRequestId, userEmail, userName, voteType]
  );
  return result.rows[0];
}

async function removeFeatureRequestVote({ featureRequestId, userEmail }) {
  const result = await pool.query('DELETE FROM feature_votes WHERE feature_request_id = $1 AND user_email = $2', [featureRequestId, userEmail]);
  return result.rowCount > 0;
}

module.exports = {
  castFeatureRequestVote,
  createFeatureRequest,
  deleteFeatureRequest,
  getActiveFeatureRequest,
  listFeatureRequests,
  removeFeatureRequestVote,
  updateFeatureRequest,
};
