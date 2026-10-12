'use strict';

const { randomUUID } = require('node:crypto');

const pool = require('./db');
const { resolveActor } = require('./invoiceAuditActor');

const AUDIT_EVENT_COLUMNS = `
  id,
  type,
  timestamp,
  actor_user_id,
  actor_name,
  actor_role,
  target_type,
  target_id,
  target_label,
  changes,
  before_state,
  after_state,
  undoable,
  undone_at,
  undone_by,
  summary,
  module,
  severity,
  created_at
`;

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToAuditEvent(row) {
  return {
    id: row.id,
    type: row.type,
    timestamp: toIsoString(row.timestamp),
    actor: {
      userId: row.actor_user_id || null,
      name: row.actor_name || null,
      role: row.actor_role || null,
    },
    target: {
      type: row.target_type,
      id: row.target_id,
      ...(row.target_label ? { label: row.target_label } : {}),
    },
    ...(row.changes !== null && row.changes !== undefined ? { changes: row.changes } : {}),
    ...(row.before_state !== null && row.before_state !== undefined ? { beforeState: row.before_state } : {}),
    ...(row.after_state !== null && row.after_state !== undefined ? { afterState: row.after_state } : {}),
    undoable: Boolean(row.undoable),
    undoneAt: toIsoString(row.undone_at),
    undoneBy: row.undone_by || null,
    summary: row.summary,
    module: row.module,
    severity: row.severity,
  };
}

function normalizeActor(actor = {}) {
  return {
    userId: actor.userId ? String(actor.userId) : null,
    name: actor.name ? String(actor.name) : null,
    role: actor.role ? String(actor.role) : null,
  };
}

function normalizeTarget(target) {
  return {
    type: String(target.type),
    id: String(target.id),
    label: target.label ? String(target.label) : null,
  };
}

async function insertAuditEvent(event, client = pool) {
  const actor = normalizeActor(event.actor);
  const target = normalizeTarget(event.target);
  const beforeState = event.beforeState !== undefined ? event.beforeState : event.before_state;
  const afterState = event.afterState !== undefined ? event.afterState : event.after_state;
  const result = await client.query(
    `INSERT INTO audit_events (
       id,
       type,
       timestamp,
       actor_user_id,
       actor_name,
       actor_role,
       target_type,
       target_id,
       target_label,
       changes,
       before_state,
       after_state,
       undoable,
       summary,
       module,
       severity
     )
     VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16)
     RETURNING ${AUDIT_EVENT_COLUMNS}`,
    [
      event.id || randomUUID(),
      event.type,
      event.timestamp || null,
      actor.userId,
      actor.name,
      actor.role,
      target.type,
      target.id,
      target.label,
      event.changes === undefined ? null : JSON.stringify(event.changes),
      beforeState === undefined ? null : JSON.stringify(beforeState),
      afterState === undefined ? null : JSON.stringify(afterState),
      Boolean(event.undoable),
      event.summary,
      event.module,
      event.severity || 'info',
    ]
  );

  return rowToAuditEvent(result.rows[0]);
}

function addFilter(conditions, params, sql, value) {
  if (value === undefined || value === null || value === '') return;
  params.push(value);
  conditions.push(sql.replace('?', `$${params.length}`));
}

function buildWhere(filters) {
  const conditions = [];
  const params = [];

  addFilter(conditions, params, 'type = ?', filters.type);
  addFilter(conditions, params, 'module = ?', filters.module);
  addFilter(conditions, params, 'actor_user_id = ?', filters.actorId);
  addFilter(conditions, params, 'target_type = ?', filters.targetType);
  addFilter(conditions, params, 'target_id = ?', filters.targetId);
  addFilter(conditions, params, 'severity = ?', filters.severity);
  addFilter(conditions, params, 'timestamp >= ?::timestamptz', filters.from);
  addFilter(conditions, params, 'timestamp <= ?::timestamptz', filters.to);

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

async function listAuditEvents(filters = {}) {
  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const offset = (page - 1) * limit;
  const { where, params } = buildWhere(filters);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_events ${where}`,
    params
  );

  const rowsResult = await pool.query(
    `SELECT ${AUDIT_EVENT_COLUMNS}
     FROM audit_events
     ${where}
     ORDER BY timestamp DESC, created_at DESC, id DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const total = countResult.rows[0]?.total || 0;
  return {
    events: rowsResult.rows.map(rowToAuditEvent),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

function normalizeStateValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);

  const stringValue = String(value);
  const parsedDate = new Date(stringValue);
  if (
    typeof value === 'string'
    // Timestamps AND date-only strings: pg returns DATE columns as Date objects
    // (ISO midnight), so '2026-09-01' must canonicalize identically or undo
    // state checks flag unchanged dates as stale.
    && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)
    && !Number.isNaN(parsedDate.getTime())
  ) {
    return parsedDate.toISOString();
  }

  return stringValue;
}

function checkStateMatch(currentRow, afterState) {
  const staleFields = [];
  for (const [field, expectedValue] of Object.entries(afterState || {})) {
    const normalizedCurrent = normalizeStateValue(currentRow[field]);
    const normalizedExpected = normalizeStateValue(expectedValue);
    if (normalizedCurrent !== normalizedExpected) staleFields.push(field);
  }

  return staleFields.length === 0
    ? { match: true, staleFields: [] }
    : { match: false, staleFields };
}

async function findUndoableAction(targetId, actionType) {
  const result = await pool.query(
    `SELECT ${AUDIT_EVENT_COLUMNS}
     FROM audit_events
     WHERE target_id = $1
       AND type = $2
       AND undoable = true
       AND undone_at IS NULL
     ORDER BY timestamp DESC, created_at DESC
     LIMIT 1`,
    [targetId, actionType]
  );

  return result.rows[0] ? rowToAuditEvent(result.rows[0]) : null;
}

async function findAuditEvent(targetId, actionId) {
  const result = await pool.query(
    `SELECT ${AUDIT_EVENT_COLUMNS}
     FROM audit_events
     WHERE target_id = $1 AND id = $2
     LIMIT 1`,
    [targetId, actionId]
  );

  return result.rows[0] ? rowToAuditEvent(result.rows[0]) : null;
}

async function markActionUndone(actionId, undoneBy) {
  await pool.query(
    `UPDATE audit_events
     SET undone_at = NOW(),
         undone_by = $1
     WHERE id = $2`,
    [undoneBy, actionId]
  );
}

function getRequestAuditActor(req, res) {
  const email = req?.user?.email || res?.locals?.userEmail || 'system';
  const userId = req?.user?.userId || email;
  const role = req?.user?.role || null;

  return {
    userId,
    name: email,
    role,
  };
}

function invoiceLabel(rowOrLabel) {
  if (!rowOrLabel) return null;
  if (typeof rowOrLabel === 'string') return rowOrLabel;
  return rowOrLabel.invoice_number || rowOrLabel.file_name || rowOrLabel.id || null;
}

async function emitInvoiceAuditEvent(req, res, options) {
  const targetId = options.targetId || options.invoiceId;
  return insertAuditEvent({
    id: options.id,
    type: options.type,
    timestamp: options.timestamp,
    actor: await resolveActor({ ...req?.user, email: req?.user?.email || res?.locals?.userEmail }, options.client || pool),
    target: {
      type: options.targetType || 'invoice',
      id: targetId,
      ...(invoiceLabel(options.label || options.row) ? { label: invoiceLabel(options.label || options.row) } : {}),
    },
    changes: options.changes,
    beforeState: options.beforeState,
    afterState: options.afterState,
    undoable: options.undoable,
    summary: options.summary,
    module: 'invoices',
    severity: options.severity || 'info',
  }, options.client);
}

async function emitPlatformAuditEvent(req, res, options) {
  return insertAuditEvent({
    id: options.id,
    type: options.type,
    timestamp: options.timestamp,
    // Callers that predate request-derived audit actors may supply their
    // historical actor explicitly. Existing platform routes retain the
    // request-derived actor by default.
    actor: options.actor || getRequestAuditActor(req, res),
    target: {
      type: options.targetType,
      id: options.targetId,
      ...(options.targetLabel ? { label: options.targetLabel } : {}),
    },
    changes: options.changes,
    beforeState: options.beforeState,
    afterState: options.afterState,
    undoable: false,
    summary: options.summary,
    module: options.module || 'platform',
    severity: options.severity || 'info',
  }, options.client);
}

/**
 * Preserve the legacy invoice audit_log contract while centralizing all audit
 * SQL in this module. The invoice service facade delegates here so callers
 * retain the same document_id, action, actor, and JSON changes semantics.
 */
// `client` defaults to the shared pool (best-effort, autocommitted) so
// non-transactional callers are unchanged. A caller inside a transaction may
// pass its transaction client so the audit INSERT enlists in that transaction
// and rolls back with it — no phantom audit row for rolled-back work.
async function emitLegacyInvoiceAuditEvent(documentId, action, changes = null, actor = 'dashboard', client = pool) {
  await client.query(
    'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
    [documentId, action, actor, changes ? JSON.stringify(changes) : null]
  );
}

module.exports = {
  AUDIT_EVENT_COLUMNS,
  checkStateMatch,
  emitInvoiceAuditEvent,
  emitLegacyInvoiceAuditEvent,
  emitPlatformAuditEvent,
  findAuditEvent,
  findUndoableAction,
  getRequestAuditActor,
  insertAuditEvent,
  listAuditEvents,
  markActionUndone,
  rowToAuditEvent,
};
