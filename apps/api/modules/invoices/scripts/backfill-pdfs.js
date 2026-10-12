#!/usr/bin/env node
/**
 * One-time backfill: recover PDFs from Graph API for documents with null file_path.
 * Skips classifications that never had real attachments (no-attachment, all-skipped).
 * Uses same Graph token + recovery logic as server.js ensurePdf().
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();

const { FILES_DIR, INVOICE_MAILBOX: SHARED_MAILBOX } = require('../../../config');
const graph = require('../../../lib/graph');

async function recoverDoc(doc) {
  const { id, email_message_id, file_name } = doc;

  try {
    const allAttachments = await graph.getAttachments(SHARED_MAILBOX, email_message_id);
    const attachments = allAttachments.filter(a =>
      a['@odata.type'] === '#microsoft.graph.fileAttachment'
    );

    if (attachments.length === 0) {
      return { id, status: 'no-attachments', reason: 'Email has no file attachments' };
    }

    // Find matching attachment by filename
    let target = file_name
      ? attachments.find(a => a.name === file_name)
      : null;

    // Fallback: first PDF attachment
    if (!target) {
      target = attachments.find(a => a.name && a.name.toLowerCase().endsWith('.pdf'));
    }
    // Last resort: first attachment
    if (!target) target = attachments[0];

    if (!target) {
      return { id, status: 'no-match', reason: 'No matching attachment found' };
    }

    // Save to data/files/ with doc ID as filename
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
    const ext = path.extname(target.name) || '.pdf';
    const recoveredPath = path.join(FILES_DIR, `${id}${ext}`);
    fs.writeFileSync(recoveredPath, Buffer.from(target.contentBytes, 'base64'));
    const stat = fs.statSync(recoveredPath);

    // Update DB
    await pool.query(
      'UPDATE documents SET file_path = $1, file_size_bytes = $2, updated_at = NOW() WHERE id = $3',
      [recoveredPath, stat.size, id]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
      [id, 'pdf-recovered', 'backfill-script', JSON.stringify({
        source: 'graph-api',
        emailMessageId: email_message_id,
        recoveredFile: target.name,
        fileSize: stat.size,
        recoveredPath,
      })]
    );

    return { id, status: 'recovered', file: target.name, size: stat.size };
  } catch (err) {
    return { id, status: 'error', reason: err.message };
  }
}

async function main() {
  // Skip classifications that are known to not have real attachments
  const SKIP = ['no-attachment', 'all-skipped'];

  const { rows } = await pool.query(
    `SELECT id, file_name, file_path, classification, email_message_id
     FROM documents
     WHERE file_path IS NULL
       AND email_message_id IS NOT NULL
       AND classification NOT IN ($1, $2)
     ORDER BY created_at`,
    SKIP
  );

  console.log(`Found ${rows.length} documents to recover\n`);

  let recovered = 0, failed = 0, noAttach = 0;

  for (let i = 0; i < rows.length; i++) {
    const doc = rows[i];
    const result = await recoverDoc(doc);

    const prefix = `[${i + 1}/${rows.length}]`;
    if (result.status === 'recovered') {
      console.log(`${prefix} ✅ ${doc.id} (${doc.classification}) → ${result.file} (${(result.size / 1024).toFixed(1)}KB)`);
      recovered++;
    } else if (result.status === 'no-attachments') {
      console.log(`${prefix} ⏭️  ${doc.id} (${doc.classification}) — no attachments in email`);
      noAttach++;
    } else {
      console.log(`${prefix} ❌ ${doc.id} (${doc.classification}) — ${result.reason}`);
      failed++;
    }

    // Rate limit: 50ms between calls to avoid Graph throttling
    if (i < rows.length - 1) await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n--- Summary ---`);
  console.log(`Recovered: ${recovered}`);
  console.log(`No attachments: ${noAttach}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total processed: ${rows.length}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
