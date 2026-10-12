'use strict';

const { pool } = require('./supabase');

async function loadClassificationRows({ builtInNames, pagination }) {
  if (!pagination) {
    const result = await pool.query('SELECT * FROM custom_classifications ORDER BY added_at, name');
    return { overrides: [], customRows: result.rows };
  }
  const { limit, offset } = pagination;
  const builtInCount = builtInNames.length;
  const customLimit = Math.max(0, limit - Math.max(0, Math.min(limit, builtInCount - offset)));
  const customOffset = Math.max(0, offset - builtInCount);
  const [overrides, custom] = await Promise.all([
    pool.query('SELECT * FROM custom_classifications WHERE name = ANY($1::text[])', [builtInNames]),
    pool.query('SELECT * FROM custom_classifications WHERE name <> ALL($1::text[]) ORDER BY added_at, name LIMIT $2 OFFSET $3', [builtInNames, customLimit, customOffset]),
  ]);
  return { overrides: overrides.rows, customRows: custom.rows };
}

async function createCustomClassification({ name, label, action, opensAs, actor }) {
  const result = await pool.query(
    `INSERT INTO custom_classifications (name, label, action, opens_as, status, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, 'active', NOW(), $5) RETURNING *`,
    [name, label, action, opensAs, actor]
  );
  return result.rows[0];
}

async function getClassificationOverride(name) {
  const result = await pool.query('SELECT opens_as FROM custom_classifications WHERE name = $1', [name]);
  return result.rows[0] || null;
}

async function upsertBuiltInClassificationOverride({ name, label, action, opensAs, status, actor }) {
  await pool.query(
    `INSERT INTO custom_classifications (name, label, action, opens_as, status, added_at, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)
     ON CONFLICT (name) DO UPDATE SET opens_as = $4, updated_at = NOW(), updated_by = $6`,
    [name, label, action, opensAs, status, actor]
  );
}

async function updateCustomClassification(name, changes, actor) {
  const beforeResult = await pool.query('SELECT opens_as, status, label FROM custom_classifications WHERE name = $1', [name]);
  if (!beforeResult.rows.length) return null;
  const columns = { opensAs: 'opens_as', status: 'status', label: 'label' };
  const sets = [];
  const params = [];
  let parameter = 1;
  for (const [key, column] of Object.entries(columns)) {
    if (changes[key] === undefined) continue;
    sets.push(`${column} = $${parameter++}`);
    params.push(changes[key]);
  }
  sets.push('updated_at = NOW()');
  sets.push(`updated_by = $${parameter++}`);
  params.push(actor, name);
  const result = await pool.query(`UPDATE custom_classifications SET ${sets.join(', ')} WHERE name = $${parameter} RETURNING *`, params);
  return { before: beforeResult.rows[0], row: result.rows[0] || null };
}

async function deleteCustomClassification(name) {
  const exists = await pool.query('SELECT name FROM custom_classifications WHERE name = $1', [name]);
  if (!exists.rows.length) return { kind: 'missing' };
  const documents = await pool.query('SELECT count(*) FROM documents WHERE classification = $1', [name]);
  if (parseInt(documents.rows[0].count, 10) > 0) return { kind: 'in_use' };
  await pool.query('DELETE FROM custom_classifications WHERE name = $1', [name]);
  return { kind: 'deleted' };
}

async function listRetentionSettings({ limit, offset }) {
  const result = await pool.query('SELECT * FROM retention_settings ORDER BY classification, status, id LIMIT $1 OFFSET $2', [limit, offset]);
  return result.rows;
}

async function updateRetentionSetting(id, changes, actor) {
  const columns = { retention_days: 'retention_days', delete_pdf: 'delete_pdf', delete_box: 'delete_box' };
  const sets = [];
  const params = [];
  let parameter = 1;
  for (const [key, column] of Object.entries(columns)) {
    if (changes[key] === undefined) continue;
    sets.push(`${column} = $${parameter++}`);
    params.push(changes[key]);
  }
  if (!sets.length) return { kind: 'empty' };
  sets.push('updated_at = NOW()');
  sets.push(`updated_by = $${parameter++}`);
  params.push(actor, id);
  const result = await pool.query(`UPDATE retention_settings SET ${sets.join(', ')} WHERE id = $${parameter} RETURNING *`, params);
  return result.rows[0] || null;
}

async function createRetentionSetting({ classification, status, retentionDays, deletePdf, deleteBox, actor }) {
  const result = await pool.query(
    `INSERT INTO retention_settings (classification, status, retention_days, delete_pdf, delete_box, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [classification, status, retentionDays, deletePdf, deleteBox, actor]
  );
  return result.rows[0];
}

async function deleteRetentionSetting(id) {
  const result = await pool.query('SELECT * FROM retention_settings WHERE id = $1', [id]);
  if (!result.rows.length) return { kind: 'missing' };
  if (result.rows[0].classification === '*') return { kind: 'wildcard' };
  await pool.query('DELETE FROM retention_settings WHERE id = $1', [id]);
  return { kind: 'deleted' };
}

async function getDocumentById(id) {
  const result = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
  return result.rows[0] || null;
}

module.exports = {
  createCustomClassification,
  createRetentionSetting,
  deleteCustomClassification,
  deleteRetentionSetting,
  getClassificationOverride,
  getDocumentById,
  listRetentionSettings,
  loadClassificationRows,
  updateCustomClassification,
  updateRetentionSetting,
  upsertBuiltInClassificationOverride,
};
