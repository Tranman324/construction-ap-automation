'use strict';

/**
 * Document destinations catalog service.
 *
 * The version table is authoritative for effective reads and append-only
 * writes. The legacy singleton remains a read fallback during migration and
 * keeps the existing bare current-config response compatible.
 */

const { randomUUID } = require('node:crypto');
const { emitPlatformAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { documentDestinationsConfigSchema } = require('../../../lib/schemas');
const { getPagination } = require('../../../lib/pagination');
const { pool } = require('./supabase');
const { withTransaction } = require('./transaction');

function serverNow(req = {}) {
  return req.destinationNow instanceof Date ? req.destinationNow : new Date();
}

function versionShape(row) {
  return {
    id: row.id,
    config: row.config,
    effectiveFrom: row.effective_from instanceof Date ? row.effective_from.toISOString() : row.effective_from,
    author: row.author,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/**
 * Resolve the immutable destination version effective at the supplied server
 * time. Callers may inject a transaction/fake pool for deterministic tests.
 */
async function getEffectiveDocumentDestinations(db = pool, now = new Date()) {
  const result = await db.query(
    'SELECT id, effective_from, config, author, created_at FROM document_destination_versions WHERE effective_from <= $1 ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1',
    [now],
  );
  const row = result.rows[0];
  return row ? { id: row.id, config: row.config, row } : null;
}

function parseWrite(body, now) {
  const candidate = { ...(body || {}) };
  const effectiveFrom = candidate.effectiveFrom;
  delete candidate.effectiveFrom;

  const parsed = documentDestinationsConfigSchema.safeParse(candidate);
  if (!parsed.success) return { error: parsed.error };
  if (effectiveFrom === undefined) return { config: parsed.data, effectiveFrom: now };

  if (typeof effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(effectiveFrom)) {
    return { error: new Error('effectiveFrom must be an ISO timestamp') };
  }
  const parsedTime = new Date(effectiveFrom);
  if (Number.isNaN(parsedTime.getTime()) || parsedTime.toISOString() !== effectiveFrom) {
    return { error: new Error('effectiveFrom must be an ISO timestamp') };
  }
  return { config: parsed.data, effectiveFrom: parsedTime };
}

function validationFailure(res, parsedError) {
  const flat = typeof parsedError.flatten === 'function'
    ? parsedError.flatten()
    : { fieldErrors: { effectiveFrom: [parsedError.message] }, formErrors: [] };
  return fail(res, 422, 'Invalid document destinations config', {
    code: 'INVALID_DOCUMENT_DESTINATIONS_CONFIG',
    fields: { ...flat.fieldErrors, ...(flat.formErrors?.length ? { _errors: flat.formErrors } : {}) },
  });
}

async function getDocumentDestinations(req, res) {
  try {
    // The version table is authoritative once its migration is present. Keep
    // the singleton fallback so legacy deployments retain the bare GET shape.
    let effective = null;
    try {
      effective = await getEffectiveDocumentDestinations(pool, serverNow(req));
    } catch (err) {
      if (err?.code !== '42P01') throw err;
    }
    if (effective) return res.json(effective.config);

    const result = await pool.query('SELECT config FROM document_destinations WHERE id = 1');
    if (result.rows.length === 0) {
      return fail(res, 404, 'Destination catalog is not configured', { code: 'DESTINATIONS_NOT_CONFIGURED' });
    }
    return res.json(result.rows[0].config);
  } catch (err) {
    return safeError(res, err, 'GET /api/document-destinations');
  }
}

async function listDocumentDestinationVersions(req, res) {
  try {
    const { limit, offset } = getPagination(req.query);
    const [versions, count] = await Promise.all([
      pool.query(
        'SELECT id, effective_from, config, author, created_at FROM document_destination_versions ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT $1 OFFSET $2',
        [limit, offset],
      ),
      pool.query('SELECT COUNT(*)::int AS count FROM document_destination_versions'),
    ]);
    return res.json({
      versions: versions.rows.map(versionShape),
      total: Number(count.rows[0]?.count || 0),
      limit,
      offset,
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/document-destinations/versions');
  }
}

async function getDocumentDestinationVersion(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, effective_from, config, author, created_at FROM document_destination_versions WHERE id = $1',
      [req.params.id],
    );
    if (!result.rows[0]) {
      return fail(res, 404, 'Destination version was not found', { code: 'DOCUMENT_DESTINATION_VERSION_NOT_FOUND' });
    }
    return res.json(versionShape(result.rows[0]));
  } catch (err) {
    return safeError(res, err, 'GET /api/document-destinations/versions/:id');
  }
}

async function updateDocumentDestinations(req, res) {
  const now = serverNow(req);
  const parsed = parseWrite(req.body, now);
  if (parsed.error) return validationFailure(res, parsed.error);

  try {
    const actor = getRequestAuditActor(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      // Serialize version allocation with the compatibility singleton lock.
      // The singleton is never rewritten; it is only a durable lock and
      // migration-window fallback for legacy reads.
      const legacy = await db.query('SELECT config FROM document_destinations WHERE id = 1 FOR UPDATE');
      const effective = await getEffectiveDocumentDestinations(db, now);
      const before = effective?.config ?? legacy.rows[0]?.config ?? null;
      const nextVersion = await db.query('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM document_destination_versions');
      const inserted = await db.query(
        'INSERT INTO document_destination_versions (id, version, effective_from, config, created_at, author) VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id, effective_from, config, author, created_at',
        [randomUUID(), Number(nextVersion.rows[0]?.version || 1), parsed.effectiveFrom, JSON.stringify(parsed.config), now, actor.name],
      );
      const version = versionShape(inserted.rows[0]);

      // The audit INSERT enlists in this same transaction. A failure rolls
      // back the immutable version, preventing a phantom settings event.
      await emitPlatformAuditEvent(req, res, {
        type: 'settings.document_destinations.updated',
        targetType: 'document_destinations',
        targetId: version.id,
        changes: { config: ['updated'], version: [version.id] },
        beforeState: { config: before },
        afterState: { config: version.config, version },
        module: 'invoices',
        summary: 'Document destinations catalog updated',
        severity: 'info',
        client: db,
      });

      return {
        before,
        current: effective?.config ?? legacy.rows[0]?.config ?? null,
        version,
        scheduled: parsed.effectiveFrom > now,
      };
    });

    return res.json(outcome.scheduled ? { version: outcome.version, config: outcome.current } : outcome.version.config);
  } catch (err) {
    return safeError(res, err, 'PUT /api/document-destinations');
  }
}

module.exports = {
  getDocumentDestinations,
  listDocumentDestinationVersions,
  getDocumentDestinationVersion,
  updateDocumentDestinations,
  getEffectiveDocumentDestinations,
  parseWrite,
  serverNow,
  versionShape,
};
