'use strict';

const { randomUUID } = require('node:crypto');
const { emitPlatformAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { coiComplianceConfigSchema } = require('../../../lib/schemas');
const { getPagination } = require('../../../lib/pagination');
const { pool } = require('./supabase');
const { withTransaction } = require('./transaction');

function serverNow(req = {}) { return req.coiNow instanceof Date ? req.coiNow : new Date(); }
function normalizeConfig(config) { return { ...(config || {}), warnWindowDays: config?.warnWindowDays ?? 30 }; }
function versionShape(row) {
  return {
    id: row.id,
    config: normalizeConfig(row.config),
    effectiveFrom: row.effective_from instanceof Date ? row.effective_from.toISOString() : row.effective_from,
    author: row.author,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function getEffectiveCoiConfig(db = pool, now = new Date()) {
  const result = await db.query(
    'SELECT id, effective_from, config, author, created_at FROM coi_config_versions WHERE effective_from <= $1 ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1',
    [now]
  );
  return result.rows[0] ? { id: result.rows[0].id, config: normalizeConfig(result.rows[0].config), row: result.rows[0] } : null;
}

function parseWrite(body, now) {
  const candidate = { ...(body || {}) };
  const effectiveFrom = candidate.effectiveFrom;
  delete candidate.effectiveFrom;
  const parsed = coiComplianceConfigSchema.safeParse(candidate);
  if (!parsed.success) return { error: parsed.error };
  if (effectiveFrom === undefined) return { config: normalizeConfig(parsed.data), effectiveFrom: now };
  if (typeof effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(effectiveFrom)) return { error: new Error('effectiveFrom must be an ISO timestamp') };
  const parsedTime = new Date(effectiveFrom);
  if (Number.isNaN(parsedTime.getTime()) || parsedTime.toISOString() !== effectiveFrom) return { error: new Error('effectiveFrom must be an ISO timestamp') };
  return { config: normalizeConfig(parsed.data), effectiveFrom: parsedTime };
}

async function getCoiConfig(req, res) {
  try {
    const effective = await getEffectiveCoiConfig(pool, serverNow(req));
    if (!effective) return fail(res, 404, 'COI compliance config is not configured', { code: 'COI_CONFIG_NOT_CONFIGURED' });
    return res.json(effective.config);
  } catch (err) { return safeError(res, err, 'GET /api/coi-config'); }
}

async function listCoiConfigVersions(req, res) {
  try {
    const { limit, offset } = getPagination(req.query);
    const [versions, count] = await Promise.all([
      pool.query('SELECT id, effective_from, config, author, created_at FROM coi_config_versions ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*)::int AS count FROM coi_config_versions'),
    ]);
    return res.json({ versions: versions.rows.map(versionShape), total: Number(count.rows[0]?.count || 0), limit, offset });
  } catch (err) { return safeError(res, err, 'GET /api/coi-config/versions'); }
}

async function getCoiConfigVersion(req, res) {
  try {
    const result = await pool.query('SELECT id, effective_from, config, author, created_at FROM coi_config_versions WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return fail(res, 404, 'COI config version was not found', { code: 'COI_CONFIG_VERSION_NOT_FOUND' });
    return res.json(versionShape(result.rows[0]));
  } catch (err) { return safeError(res, err, 'GET /api/coi-config/versions/:id'); }
}

async function updateCoiConfig(req, res) {
  const now = serverNow(req);
  const parsed = parseWrite(req.body, now);
  if (parsed.error) {
    const flat = typeof parsed.error.flatten === 'function' ? parsed.error.flatten() : { fieldErrors: { effectiveFrom: [parsed.error.message] }, formErrors: [] };
    return fail(res, 422, 'Invalid COI compliance config', { code: 'INVALID_COI_CONFIG', fields: { ...flat.fieldErrors, ...(flat.formErrors?.length ? { _errors: flat.formErrors } : {}) } });
  }
  try {
    const actor = getRequestAuditActor(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const prior = await getEffectiveCoiConfig(db, now);
      const nextVersion = await db.query('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM coi_config_versions');
      const inserted = await db.query(
        'INSERT INTO coi_config_versions (id, version, effective_from, config, created_at, author) VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id, effective_from, config, author, created_at',
        [randomUUID(), Number(nextVersion.rows[0].version), parsed.effectiveFrom, JSON.stringify(parsed.config), now, actor.name]
      );
      return { before: prior?.config || null, current: prior?.config || null, version: versionShape(inserted.rows[0]), scheduled: parsed.effectiveFrom > now };
    });
    await emitPlatformAuditEvent(req, res, {
      type: 'settings.coi_config.updated', targetType: 'coi_compliance_config', targetId: outcome.version.id,
      changes: { config: ['updated'] }, beforeState: { config: outcome.before }, afterState: { config: parsed.config },
      module: 'invoices', summary: 'COI compliance config updated', severity: 'info',
    });
    return res.json(outcome.scheduled ? { version: outcome.version, config: outcome.current } : parsed.config);
  } catch (err) { return safeError(res, err, 'PUT /api/coi-config'); }
}

module.exports = { getCoiConfig, updateCoiConfig, listCoiConfigVersions, getCoiConfigVersion, getEffectiveCoiConfig, serverNow, versionShape };
