#!/usr/bin/env node
'use strict';
/**
 * Nightly retention purge — NCG Invoice Pipeline
 *
 * Loads retention policies from Supabase, finds documents that have aged out,
 * deletes local PDFs and Box files as configured, then removes the DB rows.
 * Posts a summary to Discord #accounting if anything was actually purged.
 *
 * Usage:
 *   node purge.js            # live run
 *   node purge.js --dry-run  # preview only, no deletes
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '..', '..', '.env');
try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
} catch {}

const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const { BOX_SCRIPT } = require('../../../config');

// ─── Constants ────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const DISCORD_ACCOUNTING_CHANNEL = '100000000000000001';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function warn(...args) {
  console.warn(`[${new Date().toISOString()}] ⚠️`, ...args);
}

/**
 * Delete a file from Box. Returns true on success, false on failure.
 */
async function deleteFromBox(boxFileId) {
  try {
    execFileSync('node', [BOX_SCRIPT, 'delete', String(boxFileId)], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (err) {
    warn(`Box delete failed for ${boxFileId}:`, err.message);
    return false;
  }
}

async function notifyDiscord(message) {
  execFileSync('agent-runtime', [
    'message', 'send', '--channel', 'discord', '--target', DISCORD_ACCOUNTING_CHANNEL, '--message', String(message),
  ], { encoding: 'utf8' });
}

/**
 * Delete a local file. Returns bytes freed (0 if file not found or error).
 */
function deleteLocalFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    fs.unlinkSync(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Build an effective retention map from rules.
 * Specific classification rules override wildcards for a given status.
 * Returns: Map<status+classification key, rule>
 */
function buildEffectiveRules(rules) {
  // Group by status, then prefer specific over wildcard
  const byStatus = new Map();

  for (const rule of rules) {
    const key = `${rule.classification}::${rule.status}`;
    byStatus.set(key, rule);
  }

  return byStatus;
}

/**
 * For a given document (classification, status), find the best matching rule.
 * Specific wins over wildcard.
 */
function findRule(effectiveRules, docClassification, docStatus) {
  const specificKey = `${docClassification}::${docStatus}`;
  if (effectiveRules.has(specificKey)) return effectiveRules.get(specificKey);

  const wildcardKey = `*::${docStatus}`;
  if (effectiveRules.has(wildcardKey)) return effectiveRules.get(wildcardKey);

  return null;
}

/**
 * Persist a purge event independently from the document, then delete the
 * document in the same transaction. audit_log cannot serve this purpose: its
 * document foreign key intentionally cascades on a permanent document delete.
 */
async function auditAndDeleteDocument(database, doc, rule, ageDays) {
  let client;
  try {
    client = await database.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO audit_events (
         id, type, timestamp, actor_name, actor_role,
         target_type, target_id, target_label, changes,
         summary, module, severity
       )
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
      [
        randomUUID(),
        'invoice.document.purged',
        'retention-purge',
        'system',
        'invoice-document',
        doc.id,
        doc.id,
        JSON.stringify({
          reason: `retention policy: ${rule.classification}/${rule.status}, ${rule.retention_days} days`,
          ageDays: Math.floor(ageDays),
          deletePdfRequested: Boolean(rule.delete_pdf && doc.file_path),
          deleteBoxRequested: Boolean(rule.delete_box && doc.box_file_id),
          beforeState: {
            classification: doc.classification,
            status: doc.status,
            updatedAt: doc.updated_at,
          },
        }),
        `Retention purge permanently deleted ${doc.classification} document ${doc.id}`,
        'invoices',
        'warning',
      ]
    );

    const deleted = await client.query('DELETE FROM documents WHERE id = $1', [doc.id]);
    if (deleted.rowCount !== 1) {
      throw new Error(`document ${doc.id} was not deleted`);
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        warn(`Rollback failed for doc ${doc.id}:`, rollbackErr.message);
      }
    }
    warn(`Skipping doc ${doc.id}; purge audit/delete transaction failed:`, err.message);
    return false;
  } finally {
    client?.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(options = {}) {
  const database = options.pool || pool;
  const dryRun = options.dryRun ?? DRY_RUN;
  const deleteLocal = options.deleteLocalFile || deleteLocalFile;
  const deleteBox = options.deleteFromBox || deleteFromBox;
  const notify = options.notifyDiscord || notifyDiscord;

  log(`Starting retention purge${dryRun ? ' (DRY RUN)' : ''}...`);

  // 1. Load all retention rules
  const retentionResult = await database.query('SELECT * FROM retention_settings ORDER BY classification, status');
  const rules = retentionResult.rows;
  log(`Loaded ${rules.length} retention rules`);

  // Build effective rule map
  const effectiveRules = buildEffectiveRules(rules);

  // 2. Query all documents that might be eligible for purge
  //    We fetch docs across all statuses covered by retention rules, older than the minimum retention window
  const coveredStatuses = [...new Set(rules.map(r => r.status))];
  if (coveredStatuses.length === 0) {
    log('No retention rules found — nothing to purge');
    await database.end();
    return;
  }

  const placeholders = coveredStatuses.map((_, i) => `$${i + 1}`).join(', ');
  const docsResult = await database.query(
    `SELECT id, classification, status, file_path, box_file_id, updated_at
     FROM documents
     WHERE status IN (${placeholders})
     ORDER BY updated_at ASC`,
    coveredStatuses
  );

  log(`Found ${docsResult.rows.length} documents in covered statuses`);

  // 3. Process each document
  const now = new Date();
  let totalPurged = 0;
  let totalBytesFreed = 0;

  // Track per-rule summary for Discord
  const ruleSummary = new Map(); // ruleKey => { rule, count, bytes }

  for (const doc of docsResult.rows) {
    // ─── Hard safety rule: NEVER purge invoice + pending ──────────────────────
    if ((doc.classification === 'invoice' || doc.classification === 'pay-application') && doc.status === 'pending') {
      // Only warn if a rule somehow exists for this combo
      const ruleForIt = findRule(effectiveRules, doc.classification, 'pending');
      if (ruleForIt) {
        warn(`SAFETY: Skipping invoice/pending doc ${doc.id} — this combination is protected from auto-purge`);
      }
      continue;
    }

    const rule = findRule(effectiveRules, doc.classification, doc.status);
    if (!rule) continue;

    // Check age
    const ageMs = now - new Date(doc.updated_at);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < rule.retention_days) continue;

    const ruleKey = `${rule.classification}::${rule.status}`;
    if (!ruleSummary.has(ruleKey)) {
      ruleSummary.set(ruleKey, { rule, count: 0, bytes: 0 });
    }

    if (dryRun) {
      log(`[DRY RUN] Would purge doc ${doc.id} (${doc.classification}/${doc.status}, ${Math.floor(ageDays)} days old)`
        + ` — deletePdf=${rule.delete_pdf}, deleteBox=${rule.delete_box}`);
      ruleSummary.get(ruleKey).count++;
      totalPurged++;
      continue;
    }

    // ─── Live purge ───────────────────────────────────────────────────────────
    log(`Purging doc ${doc.id} (${doc.classification}/${doc.status}, ${Math.floor(ageDays)} days old)`);

    // The audit record is written to audit_events (which has no document FK)
    // before the hard delete, in one transaction. A foreign-key/constraint
    // error rolls back this document only and the loop continues.
    const deleted = await auditAndDeleteDocument(database, doc, rule, ageDays);
    if (!deleted) continue;

    let bytesFreed = 0;

    // External cleanup follows the committed local state. It remains
    // best-effort, but a DB constraint failure can no longer delete files for
    // a document that remains in the queue.
    if (rule.delete_pdf && doc.file_path) {
      bytesFreed += deleteLocal(doc.file_path);
      log(`  → Deleted local PDF: ${doc.file_path}`);
    }

    if (rule.delete_box && doc.box_file_id) {
      const boxOk = await deleteBox(doc.box_file_id);
      log(`  → Box delete ${boxOk ? 'succeeded' : 'failed'}: ${doc.box_file_id}`);
    }

    ruleSummary.get(ruleKey).count++;
    ruleSummary.get(ruleKey).bytes += bytesFreed;
    totalPurged++;
    totalBytesFreed += bytesFreed;
  }

  // 4. Summary output
  log(`\n─────────────────────────────────────────`);
  log(`Retention purge complete${dryRun ? ' (DRY RUN)' : ''}`);
  log(`Total purged: ${totalPurged} documents`);
  if (!dryRun) log(`Space freed: ~${formatBytes(totalBytesFreed)}`);
  log(`─────────────────────────────────────────`);

  for (const [key, { rule, count, bytes }] of ruleSummary) {
    const classLabel = rule.classification === '*' ? 'all types' : rule.classification;
    log(`  ${count} ${classLabel} (${rule.status}, ${rule.retention_days}+ days)${!dryRun ? ` — ${formatBytes(bytes)} freed` : ''}`);
  }

  // 5. Discord notification (live run only, if something was purged)
  if (!dryRun && totalPurged > 0) {
    try {
      const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const lines = [`🗑️ **Retention Purge** — ${dateLabel}`];

      for (const [, { rule, count, bytes }] of ruleSummary) {
        if (count === 0) continue;
        const classLabel = rule.classification === '*' ? 'items' : `${rule.classification} items`;
        const actions = [];
        if (rule.delete_pdf) actions.push('PDFs deleted');
        if (rule.delete_box) actions.push('Box copies removed');
        const actionStr = actions.length ? `— ${actions.join(', ')}` : '';
        lines.push(`• ${count} ${rule.status} ${classLabel} (${rule.retention_days}+ days) ${actionStr}`);
      }

      lines.push(`• Space freed: ~${formatBytes(totalBytesFreed)}`);
      const msg = lines.join('\n');

      await notify(msg);
      log('Discord summary posted to #accounting');
    } catch (discordErr) {
      warn('Discord notification failed:', discordErr.message);
    }
  }

  // 6. Cleanup stuck split-processing rows (worker crashed or timed out)
  // Any child doc that has been in split-processing for >15 minutes is
  // considered stuck — flip it to error so the user can retry or delete.
  try {
    const stuckResult = await database.query(
      `UPDATE documents
       SET status = 'error',
           submit_error = 'Split worker timed out or crashed (>15 min in split-processing)',
           updated_at = NOW()
       WHERE status = 'split-processing'
         AND updated_at < NOW() - INTERVAL '15 minutes'
       RETURNING id, file_name`
    );
    if (stuckResult.rows.length > 0) {
      log(`Swept ${stuckResult.rows.length} stuck split-processing rows → error`);
      for (const stuck of stuckResult.rows) {
        log(`  — ${stuck.id} (${stuck.file_name})`);
      }
    }
  } catch (sweepErr) {
    warn('Stuck split-processing sweep failed:', sweepErr.message);
  }

  await database.end();
  log('Done.');

  return { totalPurged, totalBytesFreed, ruleSummary };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

module.exports = {
  auditAndDeleteDocument,
  buildEffectiveRules,
  deleteFromBox,
  findRule,
  notifyDiscord,
  run,
};

if (require.main === module) {
  run().catch(err => {
    console.error('Purge script failed:', err);
    process.exit(1);
  });
}
