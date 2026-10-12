#!/usr/bin/env node
const path = require('path');

const graph = require('../../../lib/graph');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const { INVOICE_MAILBOX: SHARED_MAILBOX } = require('../../../config');

async function graphFetch(urlPath) {
  return graph.graphFetch(urlPath);
}

async function backfill() {
  // Fetch documents that have an email_message_id but are missing email_body
  const { rows } = await pool.query(
    `SELECT DISTINCT email_message_id FROM documents
     WHERE email_message_id IS NOT NULL
       AND (email_body IS NULL OR email_body = '')
     ORDER BY email_message_id`
  );

  const msgIds = rows.map(r => r.email_message_id);
  console.log('Unique emails to backfill:', msgIds.length);

  let updated = 0;
  for (const msgId of msgIds) {
    try {
      const msg = await graphFetch(`/users/${SHARED_MAILBOX}/messages/${msgId}?$select=body,bodyPreview`);
      if (msg?.body?.content) {
        const result = await pool.query(
          `UPDATE documents
           SET email_body = $1,
               email_body_content_type = $2,
               email_body_preview = COALESCE(NULLIF(email_body_preview, ''), $3),
               updated_at = NOW()
           WHERE email_message_id = $4
             AND (email_body IS NULL OR email_body = '')`,
          [
            msg.body.content,
            msg.body.contentType || 'html',
            (msg.bodyPreview || '').slice(0, 500),
            msgId,
          ]
        );
        updated += result.rowCount;
        console.log('  ✓', msgId.slice(0, 30), `(${result.rowCount} rows updated)`);
      } else {
        console.log('  skip (no body):', msgId.slice(0, 30));
      }
    } catch (e) {
      console.log('  ✗', msgId.slice(0, 30), e.message.slice(0, 80));
    }
  }

  await pool.end();
  console.log('Done. Updated ' + updated + ' document rows');
}

backfill().catch(e => { console.error('Failed:', e.message); process.exit(1); });
