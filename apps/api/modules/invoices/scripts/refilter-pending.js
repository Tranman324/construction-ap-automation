#!/usr/bin/env node
// One-off: retroactively apply the attachment junk filters (name-pattern,
// dimensions, junk-hash) to PENDING documents and discard matches with the
// proper discard_source. Dry-run by default; pass --apply to write.
// See docs/specs/invoices/ATTACHMENT-FILTERING.md.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { withScriptClient } = require('../../../lib/scriptDb');
const { detectFileType } = require('../services/file-types');
const {
  checkSignatureNamePattern,
  checkImageDimensions,
} = require('../services/junkFilterService');

const APPLY = process.argv.includes('--apply');

async function main() {
  await withScriptClient(async (db) => {
  const { rows } = await db.query(`
    SELECT id, file_name, file_path, file_size_bytes, classification, notes
    FROM documents
    WHERE status = 'pending'
    ORDER BY queued_at ASC
  `);

  const results = [];
  for (const doc of rows) {
    if (!doc.file_path || !fs.existsSync(doc.file_path)) continue;
    const fileType = detectFileType(doc.file_path);
    if (!fileType?.isImage) continue; // images only — never touch PDFs

    const fileName = doc.file_name || path.basename(doc.file_path);
    const size = doc.file_size_bytes || fs.statSync(doc.file_path).size;
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(doc.file_path)).digest('hex');

    // Junk-hash match?
    const hashHit = await db.query('SELECT 1 FROM junk_attachments WHERE sha256 = $1', [sha256]);
    let reason = null;
    let source = null;
    if (hashHit.rows.length > 0) {
      reason = 'junk-hash-match (retro-filter)';
      source = 'junk-hash';
    } else {
      const nameHit = checkSignatureNamePattern(fileName, size);
      if (nameHit) { reason = `${nameHit} (retro-filter)`; source = 'rule-filter'; }
      else {
        const dimHit = await checkImageDimensions(doc.file_path);
        if (dimHit) { reason = `${dimHit} (retro-filter)`; source = 'rule-filter'; }
      }
    }

    if (!reason) continue;
    results.push({ id: doc.id, fileName, size, classification: doc.classification, reason, source });

    if (APPLY) {
      await db.query(`
        UPDATE documents SET
          status = 'discarded',
          discard_source = $2,
          sha256 = $3,
          discarded_at = NOW(),
          discarded_by = 'retro-filter',
          notes = COALESCE(notes || E'\\n', '') || $4,
          updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
      `, [doc.id, source, sha256, `Auto-discarded (retro-filter): ${reason}`]);
      if (source === 'rule-filter') {
        await db.query(`
          INSERT INTO junk_attachments (sha256, file_name, file_size_bytes, reason, source)
          VALUES ($1, $2, $3, $4, 'auto-other')
          ON CONFLICT (sha256) DO NOTHING
        `, [sha256, fileName, size, reason]);
      }
    }
  }

  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${results.length} of ${rows.length} pending docs matched:`);
  for (const r of results) {
    console.log(`  ${r.id} | ${r.classification} | ${r.fileName} (${r.size}b) → ${r.source}: ${r.reason}`);
  }
  });
}

main().catch(err => { console.error(err); process.exit(1); });
