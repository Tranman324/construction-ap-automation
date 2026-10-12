'use strict';

/**
 * One-off seed for the junk_attachments fingerprint cache.
 *
 * Walks existing documents with classification='other' AND status='discarded',
 * hashes their stored files (file_path), and inserts sha256 fingerprints with
 * source='seed'. IMAGES ONLY — discarded 'other' PDFs are deliberately skipped
 * (conservative: a discarded PDF usually means duplicate/irrelevant document,
 * not repeating signature junk).
 *
 * Usage:
 *   node modules/invoices/scripts/seed-junk-attachments.js          — dry run (report only)
 *   node modules/invoices/scripts/seed-junk-attachments.js --apply  — insert hashes
 *
 * See docs/specs/invoices/ATTACHMENT-FILTERING.md.
 */

const fs = require('fs');
const { withScriptClient } = require('../../../lib/scriptDb');
const { detectFileType } = require('../services/file-types');
const { sha256File } = require('../services/junkFilterService');

async function main() {
  const apply = process.argv.includes('--apply');

  await withScriptClient(async (db) => {
    const { rows } = await db.query(`
      SELECT id, file_name, file_path, file_size_bytes
      FROM documents
      WHERE classification = 'other'
        AND status = 'discarded'
        AND file_path IS NOT NULL
      ORDER BY discarded_at DESC NULLS LAST
    `);

    let candidates = 0, skippedNonImage = 0, missingFile = 0, inserted = 0, duplicates = 0;
    const seen = new Set();

    for (const row of rows) {
      const fileType = detectFileType(row.file_path, row.file_name);
      if (!fileType.isImage) {
        skippedNonImage++;
        continue;
      }
      if (!fs.existsSync(row.file_path)) {
        missingFile++;
        continue;
      }
      const sha256 = sha256File(row.file_path);
      if (!sha256) {
        missingFile++;
        continue;
      }
      candidates++;
      if (seen.has(sha256)) {
        duplicates++;
        continue;
      }
      seen.add(sha256);

      if (apply) {
        const result = await db.query(
          `INSERT INTO junk_attachments (sha256, file_name, file_size_bytes, reason, source)
           VALUES ($1, $2, $3, $4, 'seed')
           ON CONFLICT (sha256) DO NOTHING`,
          [sha256, row.file_name, row.file_size_bytes, `seeded from discarded 'other' doc ${row.id}`]
        );
        if (result.rowCount > 0) inserted++;
        else duplicates++;
      } else {
        inserted++;
        process.stdout.write(`  would seed: ${sha256.slice(0, 12)}… ${row.file_name} (${row.file_size_bytes} bytes, ${row.id})\n`);
      }
    }

    process.stdout.write(`${JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      discardedOtherDocs: rows.length,
      imageCandidates: candidates,
      skippedNonImage,
      missingFile,
      [apply ? 'inserted' : 'wouldInsert']: inserted,
      duplicateHashes: duplicates,
    }, null, 2)}\n`);
  });
}

main().catch((e) => {
  process.stderr.write(`seed-junk-attachments failed: ${e.message}\n`);
  process.exit(1);
});
