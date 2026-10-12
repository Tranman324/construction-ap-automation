'use strict';
const { randomUUID } = require('node:crypto');
const { EmailError } = require('./errors');
function createOutbox(pool, config) {
  return {
    async reserve(doc, actor, token, kind, message, recipients, attached) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize all attempts for this actor across processes; cap + dedupe + insert are atomic.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`document-email:${actor.id}`]);
        const prior = await client.query(`SELECT id FROM document_email_messages
          WHERE actor_user_id = $1 AND direction = 'out' AND
          send_token = $2 AND (attempted_at > now() - interval '60 seconds' OR status IN ('pending','ambiguous'))
          ORDER BY attempted_at DESC, id DESC LIMIT 1`, [actor.id, token]);
        if (prior.rows.length) throw new EmailError(409, 'Send already attempted', 'EMAIL_SEND_DUPLICATE', { attemptId: prior.rows[0].id });
        const counts = await client.query(`SELECT
          count(*) FILTER (WHERE attempted_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS daily,
          count(*) FILTER (WHERE attempted_at > now() - interval '1 minute')::int AS minute
          FROM document_email_messages WHERE actor_user_id = $1 AND direction = 'out'`, [actor.id, config.timeZone]);
        if (counts.rows[0].daily >= config.dailyCap || counts.rows[0].minute >= 10) {
          throw new EmailError(429, 'Email send limit reached', 'EMAIL_SEND_LIMIT');
        }
        const id = randomUUID();
        await client.query(`INSERT INTO document_email_messages
          (id,document_id,direction,kind,status,actor_user_id,send_token,from_address,to_json,subject,body_preview,has_attachments)
          VALUES ($1,$2,'out',$3,'pending',$4,$5,$6,$7,$8,$9,$10)`,
        [id, doc.id, kind, actor.id, token, config.mailbox, JSON.stringify(recipients), message.subject, message.preview, attached]);
        await client.query('COMMIT'); return id;
      } catch (err) { await client.query('ROLLBACK'); throw err; }
      finally { client.release(); }
    },
    async draft(id, draft) {
      await pool.query(`UPDATE document_email_messages SET graph_message_id=$2, conversation_id=$3
        WHERE id=$1 AND status='pending'`, [id, draft.id, draft.conversationId || null]);
    },
    async started(id) {
      await pool.query('UPDATE document_email_messages SET send_started_at=now() WHERE id=$1', [id]);
    },
    async finish(id, status, sent) {
      await pool.query(`UPDATE document_email_messages SET status=$2, resolved_at=now(),
        internet_message_id=$3, sent_at=$4 WHERE id=$1`,
      [id, status, sent?.internetMessageId || null, sent?.sentDateTime || null]);
    },
  };
}
module.exports = { createOutbox };
