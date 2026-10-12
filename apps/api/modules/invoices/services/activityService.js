'use strict';

const { isDeepStrictEqual } = require('node:util');
const pool = require('../../../lib/db');
const { getPagination } = require('../../../lib/pagination');
const { rowToAuditEvent } = require('../../../lib/auditEvents');
const {
  actorCandidate, resolveActorProjections, serializeComment, CommentError,
} = require('./commentService');
const { withTransaction } = require('./transaction');

// One SQL snapshot: source union precedes counting and paging. The final kind
// tie-breaker also handles the unlikely cross-table UUID collision deterministically.
const ACTIVITY_SQL = `WITH activity AS (
  SELECT 'comment'::text AS kind, id, created_at AS timestamp, to_jsonb(c) AS payload
  FROM document_comments c WHERE document_id = $1
  UNION ALL
  SELECT 'event'::text AS kind, id, timestamp, to_jsonb(e) AS payload
  FROM audit_events e WHERE target_id = $1 AND target_type IN ('invoice', 'document')
    AND type <> 'invoice.commented'
  UNION ALL
  SELECT 'email'::text AS kind, id,
    COALESCE(received_at, sent_at, created_at) AS timestamp, to_jsonb(m) AS payload
  FROM document_email_messages m
  WHERE document_id = $1
    AND (direction = 'in' OR (direction = 'out' AND status = 'confirmed'))
), page AS (
  SELECT * FROM activity ORDER BY timestamp DESC, id DESC, kind DESC LIMIT $2 OFFSET $3
)
SELECT EXISTS(SELECT 1 FROM documents WHERE id = $1) AS document_exists,
  (SELECT classification FROM documents WHERE id = $1) AS document_classification,
  (SELECT COUNT(*)::int FROM activity) AS total,
  COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY timestamp DESC, id DESC, kind DESC) FROM page), '[]'::jsonb) AS entries`;

const UNREAD_AGGREGATES_SQL = `SELECT
  (SELECT COUNT(*)::int FROM document_email_messages m
   WHERE m.document_id = $1 AND m.direction = 'in' AND m.kind = 'inbound'
     AND ($2::timestamptz IS NULL OR m.created_at > $2::timestamptz)) AS unread_replies,
  (SELECT COUNT(*)::int FROM document_comments c
   WHERE c.document_id = $1
     AND ($2::timestamptz IS NULL OR c.created_at > $2::timestamptz)) AS unread_comments`;

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isChangesObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTuple(value) {
  return Array.isArray(value) && value.length === 2;
}

function canCoalesce(later, earlier) {
  if (!later || !earlier || later.kind !== 'event' || earlier.kind !== 'event') return false;
  if (later.undoneAt || earlier.undoneAt) return false;
  if (later.actor?.userId == null || earlier.actor?.userId == null || later.actor.userId !== earlier.actor.userId) return false;
  if (later.type !== earlier.type || !isChangesObject(later.changes) || !isChangesObject(earlier.changes)) return false;

  const laterTime = Date.parse(later.timestamp);
  const earlierTime = Date.parse(earlier.timestamp);
  return Number.isFinite(laterTime)
    && Number.isFinite(earlierTime)
    && Math.abs(laterTime - earlierTime) <= 60_000;
}

function mergeEvents(later, earlier) {
  const changes = { ...later.changes };
  for (const [field, earlierValue] of Object.entries(earlier.changes)) {
    if (!Object.hasOwn(changes, field)) {
      changes[field] = earlierValue;
      continue;
    }

    const laterValue = changes[field];
    if (!isTuple(laterValue) || !isTuple(earlierValue)) continue;

    changes[field] = [earlierValue[0], laterValue[1]];
  }
  return { ...later, changes };
}

function coalesceEvents(entries) {
  const coalesced = [];
  let index = 0;
  while (index < entries.length) {
    let merged = entries[index];
    let nextIndex = index + 1;
    while (nextIndex < entries.length && canCoalesce(merged, entries[nextIndex])) {
      merged = mergeEvents(merged, entries[nextIndex]);
      nextIndex += 1;
    }
    if (nextIndex > index + 1) {
      merged = {
        ...merged,
        changes: Object.fromEntries(Object.entries(merged.changes)
          .filter(([, value]) => !isTuple(value) || !isDeepStrictEqual(value[0], value[1]))),
      };
    }
    coalesced.push(merged);
    index = nextIndex;
  }
  return coalesced;
}

function serializeEmail(row, timestamp, actor) {
  return {
    kind: 'email', id: row.id, documentId: row.document_id,
    direction: row.direction, emailKind: row.kind, status: row.status,
    timestamp: iso(timestamp || row.received_at || row.sent_at || row.created_at),
    from: row.from_address || null, to: parseJson(row.to_json, []),
    subject: row.subject || null, bodyPreview: row.body_preview || null,
    sanitizedBodyHtml: row.direction === 'in' ? (row.sanitized_body_html || null) : null,
    inReplyTo: row.in_reply_to || null, conversationId: row.conversation_id || null,
    receivedAt: iso(row.received_at), sentAt: iso(row.sent_at),
    correlationState: row.correlation_state || null, correlationReason: row.correlation_reason || null,
    hasAttachments: Boolean(row.has_attachments),
    attachmentReviewed: Boolean(row.attachment_reviewed),
    verifiedParticipant: row.verified_participant ?? null,
    actor,
  };
}

function isSystem(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'system';
}

function activityActor(kind, row) {
  if (kind === 'comment') return actorCandidate({
    userId: row.actor_user_id, name: row.actor_name, role: row.actor_role,
  });
  if (kind === 'email') {
    if (row.direction === 'out' && !isSystem(row.actor_user_id)) {
      return actorCandidate({ userId: row.actor_user_id });
    }
    return actorCandidate({
      name: row.kind === 'ndr' ? 'System' : (row.from_address || 'Vendor'),
      role: 'external', external: true,
    });
  }
  if (isSystem(row.actor_user_id) || (!row.actor_user_id && isSystem(row.actor_name))) {
    return actorCandidate({ name: 'System', role: row.actor_role || 'system', external: true });
  }
  if (!row.actor_user_id && ['external', 'pipeline'].includes(row.actor_role)) {
    return actorCandidate({ name: row.actor_name || 'System', role: row.actor_role, external: true });
  }
  return actorCandidate({ userId: row.actor_user_id, name: row.actor_name, role: row.actor_role });
}

async function getUnreadAggregates(documentId, activityViewedAt = null, db = pool) {
  const result = await db.query(UNREAD_AGGREGATES_SQL, [documentId, activityViewedAt]);
  const row = result.rows[0] || {};
  return {
    unreadReplies: Number.parseInt(row.unread_replies, 10) || 0,
    unreadComments: Number.parseInt(row.unread_comments, 10) || 0,
  };
}

async function viewActivity(documentId) {
  return withTransaction(pool, async (db) => {
    const locked = await db.query(
      'SELECT id, activity_viewed_at FROM documents WHERE id = $1 FOR UPDATE',
      [documentId]
    );
    if (locked.rows.length === 0) throw new CommentError('Document not found', 404);

    const priorActivityViewedAt = locked.rows[0].activity_viewed_at;
    const advanced = await db.query(`UPDATE documents
      SET activity_viewed_at = GREATEST(
        COALESCE(activity_viewed_at, '-infinity'::timestamptz), clock_timestamp()
      )
      WHERE id = $1
      RETURNING id, activity_viewed_at`, [documentId]);
    const activityViewedAt = advanced.rows[0].activity_viewed_at;

    await db.query(`UPDATE document_email_messages
      SET read_at = $2
      WHERE document_id = $1
        AND direction = 'in' AND kind = 'inbound'
        AND read_at IS NULL
        AND created_at <= $2`, [documentId, activityViewedAt]);

    const unread = await getUnreadAggregates(documentId, activityViewedAt, db);
    return {
      documentId,
      priorActivityViewedAt: iso(priorActivityViewedAt),
      activityViewedAt: iso(activityViewedAt),
      ...unread,
    };
  });
}

async function getActivity(documentId, pagination = {}) {
  const { limit, offset } = getPagination(pagination);
  const { rows } = await pool.query(ACTIVITY_SQL, [documentId, limit, offset]);
  const result = rows[0];
  if (!result.document_exists) throw new CommentError('Document not found', 404);
  const documentClassification = result.document_classification ?? null;
  const actorProjections = await resolveActorProjections(
    result.entries.map(({ kind, payload }) => activityActor(kind, payload)), pool
  );
  const serializedEntries = result.entries.map(({ kind, payload, timestamp }, index) => {
    if (kind === 'comment') return serializeComment(payload, actorProjections[index]);
    if (kind === 'email') return serializeEmail(payload, timestamp, actorProjections[index]);
    return {
      kind: 'event',
      ...rowToAuditEvent(payload),
      actor: actorProjections[index],
      documentClassification,
    };
  });
  const entries = coalesceEvents(serializedEntries);
  return {
    entries,
    pagination: {
      limit,
      offset,
      total: result.total,
      hasMore: offset + serializedEntries.length < result.total,
    },
  };
}

module.exports = {
  canCoalesce,
  coalesceEvents,
  getActivity,
  getUnreadAggregates,
  mergeEvents,
  viewActivity,
  serializeEmail,
};
