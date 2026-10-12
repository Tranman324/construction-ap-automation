'use strict';

const { graphCall } = require('./graphCall');
const { EmailError } = require('./errors');

const ATTEMPT_COLUMNS = `m.id,m.document_id,m.direction,m.kind,m.status,
  m.internet_message_id,m.graph_message_id,m.conversation_id,m.from_address,
  m.to_json,m.subject,m.has_attachments,m.actor_user_id,m.attempted_at,
  m.send_started_at,m.resolved_at,m.sent_at,u.name AS actor_name,r.name AS actor_role`;
const RETURNING_COLUMNS = `id,document_id,direction,kind,status,internet_message_id,
  graph_message_id,conversation_id,from_address,to_json,subject,has_attachments,
  actor_user_id,attempted_at,send_started_at,resolved_at,sent_at`;

function parseRecipients(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function serializeAttempt(row) {
  return {
    attemptId: row.id,
    documentId: row.document_id || null,
    kind: row.kind,
    status: row.status,
    actorUserId: row.actor_user_id || null,
    subject: row.subject || null,
    recipients: parseRecipients(row.to_json),
    conversationId: row.conversation_id || null,
    internetMessageId: row.internet_message_id || null,
    hasAttachments: Boolean(row.has_attachments),
    attemptedAt: row.attempted_at || null,
    sendStartedAt: row.send_started_at || null,
    sentAt: row.sent_at || null,
    resolvedAt: row.resolved_at || null,
  };
}

function classifyEvidence(evidence, expectedId) {
  if (evidence?.definitiveFailure === true
    || (evidence?.outcome === 'failed' && evidence?.definitive === true)) return 'failed';
  if (!evidence || evidence.id !== expectedId || evidence.isDraft !== false
    || typeof evidence.internetMessageId !== 'string' || !evidence.internetMessageId
    || typeof evidence.sentDateTime !== 'string' || !evidence.sentDateTime) return 'ambiguous';
  return 'confirmed';
}

function createReconciliationService(deps) {
  const { pool, graph, config, logger, insertAuditEvent } = deps;
  const reconciliationConfig = config.reconciliation || { batchSize: 20, timeoutMs: 30000 };

  async function lockAttempt(client, id) {
    const result = await client.query(`SELECT ${ATTEMPT_COLUMNS}
      FROM document_email_messages m
      LEFT JOIN toolbox_users u ON u.id::text = m.actor_user_id
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE m.id=$1 AND m.direction='out' FOR UPDATE OF m`, [id]);
    if (!result.rows[0]) throw new EmailError(404, 'Email attempt not found', 'EMAIL_ATTEMPT_NOT_FOUND');
    return result.rows[0];
  }

  async function getStatus(id) {
    const result = await pool.query(`SELECT ${ATTEMPT_COLUMNS}
      FROM document_email_messages m
      LEFT JOIN toolbox_users u ON u.id::text = m.actor_user_id
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE m.id=$1 AND m.direction='out'`, [id]);
    if (!result.rows[0]) throw new EmailError(404, 'Email attempt not found', 'EMAIL_ATTEMPT_NOT_FOUND');
    return serializeAttempt(result.rows[0]);
  }

  async function emitConfirmedAudit(attempt) {
    if (!attempt.document_id || !insertAuditEvent) return;
    try {
      await insertAuditEvent({
        type: attempt.kind === 'reply' ? 'invoice.email_replied' : 'invoice.email_forwarded',
        actor: { userId: attempt.actor_user_id, name: attempt.actor_name || attempt.actor_user_id, role: attempt.actor_role || 'employee' },
        target: { type: 'invoice', id: attempt.document_id }, module: 'invoices', severity: 'info', undoable: false,
        summary: attempt.kind === 'reply' ? 'Email replied' : 'Email forwarded',
        changes: {
          to: parseRecipients(attempt.to_json), subject: attempt.subject || null,
          attachedPdf: Boolean(attempt.has_attachments), attemptId: attempt.id,
        },
      });
    } catch {
      logger.error({ operation: 'email.reconciliation_audit_failed', attemptId: attempt.id }, 'Reconciled email audit failed');
    }
  }

  async function reconcileAttempt(id) {
    const client = await pool.connect();
    let attempt; let transitioned;
    try {
      await client.query('BEGIN');
      attempt = await lockAttempt(client, id);
      if (attempt.status !== 'ambiguous' || !attempt.graph_message_id) {
        await client.query('COMMIT');
        return { attempt: serializeAttempt(attempt), transitioned: false };
      }

      const path = `/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(attempt.graph_message_id)}`
        + '?$select=id,isDraft,internetMessageId,conversationId,sentDateTime';
      let evidence;
      try {
        evidence = await graphCall(graph, path, {}, reconciliationConfig.timeoutMs);
      } catch (error) {
        if (error?.definitiveFailure === true) evidence = { definitiveFailure: true };
        else logger.warn({ operation: 'email.reconciliation_unavailable', attemptId: id, code: error?.code }, 'Sent evidence unavailable');
      }
      const outcome = classifyEvidence(evidence, attempt.graph_message_id);
      if (outcome === 'confirmed') {
        const result = await client.query(`UPDATE document_email_messages
          SET status='confirmed', resolved_at=now(), internet_message_id=COALESCE(internet_message_id,$2),
            conversation_id=COALESCE(conversation_id,$3), sent_at=COALESCE(sent_at,$4)
          WHERE id=$1 AND status='ambiguous' RETURNING ${RETURNING_COLUMNS}`, [
          id, evidence.internetMessageId, evidence.conversationId || null, evidence.sentDateTime,
        ]);
        transitioned = result.rows[0] && { ...attempt, ...result.rows[0] };
      } else if (outcome === 'failed') {
        const result = await client.query(`UPDATE document_email_messages
          SET status='failed', resolved_at=now()
          WHERE id=$1 AND status='ambiguous' RETURNING ${RETURNING_COLUMNS}`, [id]);
        transitioned = result.rows[0] && { ...attempt, ...result.rows[0] };
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (transitioned?.status === 'confirmed') await emitConfirmedAudit(transitioned);
    return { attempt: serializeAttempt(transitioned || attempt), transitioned: Boolean(transitioned) };
  }

  async function reconcileSweep(limit = reconciliationConfig.batchSize) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || reconciliationConfig.batchSize, 1), 100);
    const candidates = await pool.query(`SELECT id FROM document_email_messages
      WHERE direction='out' AND status='ambiguous' AND graph_message_id IS NOT NULL
      ORDER BY attempted_at ASC, id ASC LIMIT $1`, [boundedLimit]);
    const summary = { scanned: candidates.rows.length, confirmed: 0, failed: 0, ambiguous: 0 };
    for (const row of candidates.rows) {
      const result = await reconcileAttempt(row.id);
      summary[result.attempt.status] = (summary[result.attempt.status] || 0) + 1;
    }
    return summary;
  }

  return { getStatus, reconcileAttempt, reconcileSweep };
}

module.exports = { classifyEvidence, createReconciliationService, serializeAttempt };
