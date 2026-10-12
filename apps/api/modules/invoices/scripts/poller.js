#!/usr/bin/env node
/**
 * Invoice Email Poller — Checks invoices@northwindcg.example for new invoices
 * 
 * Usage:
 *   node poller.js check          — check for new unread invoices
 *   node poller.js process        — check + extract + match (full pipeline)
 *   node poller.js process --dry  — dry run (no state changes)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();

const graph = require('../../../lib/graph');
const { INVOICE_MAILBOX, INCOMING_DIR: INCOMING_DIR_CFG } = require('../../../config');
const INCOMING_DIR = INCOMING_DIR_CFG || path.join(__dirname, '..', 'data', 'incoming');
const QUEUE_PATH = path.join(__dirname, '..', 'data', 'queue.json'); // kept for dry-run debug only
const PROCESSED_IDS_PATH = path.join(__dirname, '..', 'data', 'processed-ids.json'); // fallback only

function loadJSON(filepath, fallback) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch { return fallback; }
}

function saveJSON(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

/**
 * Check for unread emails with PDF attachments in the invoices inbox.
 */
async function checkForInvoices() {
  const emails = await graph.checkInbox(INVOICE_MAILBOX, { unreadOnly: true });
  // Filter to those with attachments only
  return emails.filter(e => e.hasAttachments);
}

/**
 * Download PDF attachments from an email.
 */
async function downloadAttachments(messageId) {
  fs.mkdirSync(INCOMING_DIR, { recursive: true });

  const attachments = await graph.getAttachments(INVOICE_MAILBOX, messageId);
  const downloaded = [];

  for (const att of attachments) {
    if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
    const filePath = path.join(INCOMING_DIR, att.name);
    fs.writeFileSync(filePath, Buffer.from(att.contentBytes, 'base64'));
    downloaded.push({ filename: att.name, path: filePath, size: att.size });
  }

  return downloaded;
}

/**
 * Mark email back to unread (HARD RULE).
 */
async function markUnread(messageId) {
  await graph.markUnread(INVOICE_MAILBOX, messageId);
}

/**
 * Add an invoice to the processing_queue table in Supabase.
 * Falls back to writing queue.json for dry-run mode.
 */
async function enqueue(matchResult, emailMeta, opts = {}) {
  const isDry = opts.dry || false;
  const entry = {
    id: `inv-${Date.now()}`,
    ...matchResult,
    email: {
      messageId: emailMeta.id,
      from: emailMeta.from,
      subject: emailMeta.subject,
      receivedAt: emailMeta.receivedDateTime,
    },
    queuedAt: new Date().toISOString(),
  };

  if (isDry) {
    // Dry-run: write to JSON file only
    const queue = loadJSON(QUEUE_PATH, []);
    queue.push(entry);
    saveJSON(QUEUE_PATH, queue);
    return entry;
  }

  // Write to Supabase processing_queue
  try {
    await pool.query(
      `INSERT INTO processing_queue (
        id, run_id, classification, confidence,
        file_name, file_path, email_message_id, email_from, email_subject,
        reason, status, queued_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.runId || null,
        entry.classification || 'other',
        entry.confidence || null,
        entry.file || null,
        entry.filePath || null,
        emailMeta.id || null,
        emailMeta.from || null,
        emailMeta.subject || null,
        entry.reason || null,
        'queued',
        entry.queuedAt,
      ]
    );
  } catch (e) {
    // Fallback to JSON on DB error
    console.warn(`WARNING: Could not write to processing_queue (${e.message}) — writing to JSON`);
    const queue = loadJSON(QUEUE_PATH, []);
    queue.push(entry);
    saveJSON(QUEUE_PATH, queue);
  }

  return entry;
}

/**
 * Check if an email has already been processed (via Supabase processed_emails table).
 */
async function isProcessed(emailId) {
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM processed_emails WHERE email_id = $1',
      [emailId]
    );
    return rows.length > 0;
  } catch (e) {
    // Fallback to JSON
    const ids = loadJSON(PROCESSED_IDS_PATH, []);
    return ids.includes(emailId);
  }
}

/**
 * Mark an email as processed in Supabase.
 */
async function markProcessed(emailId) {
  try {
    await pool.query(
      'INSERT INTO processed_emails (email_id, processed_at) VALUES ($1, $2) ON CONFLICT (email_id) DO NOTHING',
      [emailId, new Date().toISOString()]
    );
  } catch (e) {
    // Fallback to JSON
    console.warn(`WARNING: Could not save processed ID to Supabase (${e.message}) — writing to JSON`);
    const ids = loadJSON(PROCESSED_IDS_PATH, []);
    if (!ids.includes(emailId)) {
      ids.push(emailId);
      saveJSON(PROCESSED_IDS_PATH, ids);
    }
  }
}

module.exports = { checkForInvoices, downloadAttachments, markUnread, enqueue, isProcessed, markProcessed };

// --- CLI ---
if (require.main === module) {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'check':
      checkForInvoices()
        .then(r => console.log(JSON.stringify(r, null, 2)))
        .catch(e => { console.error(e.message); process.exit(1); });
      break;
    default:
      console.log('Usage: node poller.js [check|process|process --dry]');
  }
}
