#!/usr/bin/env node
/**
 * Backfill PDFs from local data/incoming/ directory for documents with null file_path.
 * Matches by file_name against files in the incoming folder.
 * Copies matched files to data/files/<doc-id>.pdf and updates DB.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();

const INCOMING_DIR = path.join(__dirname, '..', 'data', 'incoming');
const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

async function main() {
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

  // Build index of all files in incoming/
  const incomingFiles = {};
  const dirs = fs.readdirSync(INCOMING_DIR);
  for (const dir of dirs) {
    const dirPath = path.join(INCOMING_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      // Store by filename (may have dupes — last one wins, which is fine)
      incomingFiles[file] = path.join(dirPath, file);
    }
  }
  console.log(`Indexed ${Object.keys(incomingFiles).length} files from incoming/\n`);

  // Get all docs with null file_path
  const { rows } = await pool.query(
    `SELECT id, file_name, classification, status
     FROM documents
     WHERE file_path IS NULL
     ORDER BY created_at`
  );
  console.log(`Found ${rows.length} documents with null file_path\n`);

  let matched = 0, noFile = 0, noName = 0;

  for (let i = 0; i < rows.length; i++) {
    const doc = rows[i];
    const prefix = `[${i + 1}/${rows.length}]`;

    if (!doc.file_name) {
      console.log(`${prefix} ⏭️  ${doc.id} (${doc.classification}) — no file_name recorded`);
      noName++;
      continue;
    }

    const sourcePath = incomingFiles[doc.file_name];
    if (!sourcePath) {
      console.log(`${prefix} ❌ ${doc.id} (${doc.classification}) — "${doc.file_name}" not found in incoming/`);
      noFile++;
      continue;
    }

    // Copy to data/files/<doc-id>.<ext>
    const ext = path.extname(doc.file_name) || '.pdf';
    const destPath = path.join(FILES_DIR, `${doc.id}${ext}`);
    fs.copyFileSync(sourcePath, destPath);
    const stat = fs.statSync(destPath);

    // Update DB
    await pool.query(
      'UPDATE documents SET file_path = $1, file_size_bytes = $2, updated_at = NOW() WHERE id = $3',
      [destPath, stat.size, doc.id]
    );

    // Audit
    await pool.query(
      'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
      [doc.id, 'pdf-recovered', 'backfill-local', JSON.stringify({
        source: 'local-incoming',
        originalFile: doc.file_name,
        sourcePath,
        destPath,
        fileSize: stat.size,
      })]
    );

    console.log(`${prefix} ✅ ${doc.id} (${doc.classification}) → ${doc.file_name} (${(stat.size / 1024).toFixed(1)}KB)`);
    matched++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Matched & copied: ${matched}`);
  console.log(`No file_name: ${noName}`);
  console.log(`File not found: ${noFile}`);
  console.log(`Total: ${rows.length}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
