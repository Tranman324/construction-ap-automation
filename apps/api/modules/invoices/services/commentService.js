'use strict';

const { resolveActor } = require('../../../lib/invoiceAuditActor');
const { randomUUID } = require('node:crypto');
const pool = require('../../../lib/db');
const { insertAuditEvent } = require('../../../lib/auditEvents');
const { withTransaction } = require('./transaction');

class CommentError extends Error {
  constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
}

const PLATFORM_ACTORS_SQL = `SELECT u.id::text AS user_id, u.name, r.name AS platform_role,
  u.azure_id, u.avatar_url, lower(u.email) AS email
  FROM toolbox_users u
  LEFT JOIN roles r ON r.id = u.role_id
  WHERE u.id::text = ANY($1::text[]) OR lower(u.email) = ANY($2::text[])`;

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function email(value) {
  const candidate = text(value);
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : null;
}

function actorCandidate({ userId, name, role, external = false } = {}) {
  return {
    userId: text(userId), name: text(name), role: text(role), external,
    legacyEmail: email(userId) || email(name),
  };
}

function externalActor(name = 'System', role = null) {
  return { userId: null, name, role, azureId: null, avatarUrl: null };
}

async function resolveActorProjections(candidates, db = pool) {
  const internal = candidates.filter((candidate) => !candidate.external);
  const ids = [...new Set(internal.map((candidate) => candidate.userId).filter(Boolean))];
  const emails = [...new Set(internal.map((candidate) => candidate.legacyEmail).filter(Boolean))];
  const byId = new Map();
  const byEmail = new Map();
  if (ids.length || emails.length) {
    const result = await db.query(PLATFORM_ACTORS_SQL, [ids, emails]);
    for (const row of result.rows) {
      byId.set(String(row.user_id), row);
      if (row.email) byEmail.set(String(row.email).toLowerCase(), row);
    }
  }
  return candidates.map((candidate) => {
    if (candidate.external) return externalActor(candidate.name || 'System', candidate.role);
    const row = byId.get(candidate.userId) || byEmail.get(candidate.legacyEmail);
    if (!row) return {
      userId: candidate.userId, name: candidate.name || 'Unknown',
      role: candidate.role, azureId: null, avatarUrl: null,
    };
    return {
      userId: row.user_id,
      name: text(row.name) || candidate.name || 'Unknown',
      role: candidate.role || text(row.platform_role),
      azureId: text(row.azure_id),
      avatarUrl: text(row.azure_id) ? `/api/users/${row.azure_id}/photo` : null,
    };
  });
}

function serializeComment(row, actor) {
  return {
    kind: 'comment', id: row.id, documentId: row.document_id, body: row.body,
    timestamp: new Date(row.created_at).toISOString(),
    actor: actor || { userId: row.actor_user_id || null, name: row.actor_name, role: row.actor_role || null },
  };
}

async function createComment({ documentId, body, actor }) {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed || trimmed.length > 2000) throw new CommentError('Comment must contain 1–2000 characters', 400);
  return withTransaction(pool, async (db) => {
    const document = await db.query('SELECT id FROM documents WHERE id = $1 FOR KEY SHARE', [documentId]);
    if (!document.rows.length) throw new CommentError('Document not found', 404);
    const identity = await resolveActor(actor, db);
    const id = randomUUID();
    const result = await db.query(`INSERT INTO document_comments
      (id, document_id, body, actor_user_id, actor_name, actor_role)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, documentId, trimmed, identity.userId, identity.name, identity.role]);
    await insertAuditEvent({
      type: 'invoice.commented', actor: identity,
      target: { type: 'invoice', id: documentId },
      changes: { commentId: id, documentId }, summary: 'Comment added', module: 'invoices',
    }, db);
    const row = result.rows[0];
    const [actorProjection] = await resolveActorProjections([actorCandidate({
      userId: row.actor_user_id, name: row.actor_name, role: row.actor_role,
    })], db);
    return serializeComment(row, actorProjection);
  });
}

async function listComments(documentId, pagination = {}) {
  const { getPagination } = require('../../../lib/pagination');
  const { limit, offset } = getPagination(pagination);
  const result = await pool.query(`SELECT * FROM document_comments WHERE document_id = $1
    ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [documentId, limit, offset]);
  return result.rows.map(serializeComment);
}

module.exports = {
  CommentError, createComment, listComments, serializeComment,
  actorCandidate, externalActor, resolveActorProjections,
};
