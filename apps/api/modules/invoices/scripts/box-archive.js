#!/usr/bin/env node
/**
 * Box Archive — Upload invoice PDFs to Box with smart naming & monthly subfolders
 * 
 * Naming convention:
 *   Invoice:  "Invoice - {VendorCode} - {InvoiceNumber} - {Amount}.ext"
 *   Other:    "{DocType} - {VendorName}.ext"
 * 
 * Subfolders: /Nora/projects/invoices/YYYY-MM/ (based on invoice date or received date)
 * 
 * Usage:
 *   node box-archive.js              — upload all local PDFs that aren't in Box yet
 *   node box-archive.js cleanup      — upload + delete local files older than 7 days
 *   node box-archive.js single <id>  — upload a single document by ID
 *   node box-archive.js retention    — delete Box files older than 6 months
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();

const { sanitizePathForShell } = require('../services/sanitize');
const { BOX_SCRIPT } = require('/etc/toolbox/paths.js');
const BOX_INVOICES_FOLDER = '100000000002'; // /Toolbox/Accounting/
const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

// Cache of month folder IDs to avoid re-creating
const folderCache = {};

/**
 * Get or create a monthly subfolder in Box (e.g., "2026-02")
 */
async function getMonthFolder(yearMonth) {
  if (folderCache[yearMonth]) return folderCache[yearMonth];

  // Check if folder exists
  try {
    const listOut = execSync(
      `node "${BOX_SCRIPT}" list ${BOX_INVOICES_FOLDER}`,
      { encoding: 'utf8', timeout: 30000 }
    );
    // Parse multiline format: "📁 2026-02 \n   ID: 100000000001"
    const match = listOut.match(new RegExp(`📁\\s*${yearMonth}[\\s\\S]*?ID:\\s*(\\d+)`));
    if (match) {
      folderCache[yearMonth] = match[1];
      return match[1];
    }
  } catch {}

  // Create it
  try {
    const mkOut = execSync(
      `node "${BOX_SCRIPT}" mkdir "${yearMonth}" ${BOX_INVOICES_FOLDER}`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const match = mkOut.match(/Folder ID:\s*(\d+)/);
    if (match) {
      folderCache[yearMonth] = match[1];
      return match[1];
    }
  } catch (err) {
    // Folder might already exist (race condition)
    const listOut = execSync(
      `node "${BOX_SCRIPT}" list ${BOX_INVOICES_FOLDER}`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const match2 = listOut.match(new RegExp(`📁\\s*${yearMonth}[\\s\\S]*?ID:\\s*(\\d+)`));
    if (match2) {
      folderCache[yearMonth] = match2[1];
      return match2[1];
    }
    throw new Error(`Failed to create/find Box folder for ${yearMonth}: ${err.message}`);
  }
}

/**
 * Build the Box file name based on document type
 */
function buildBoxFileName(doc) {
  const ext = path.extname(doc.file_name || '.pdf') || '.pdf';
  const sanitize = (s) => (s || '').replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

  const classification = (doc.classification || 'other').toLowerCase();
  const isInvoice = ['invoice', 'receipt', 'pay-application', 'credit-memo'].includes(classification);

  if (isInvoice) {
    const vendor = sanitize(doc.vendor_code || doc.vendor_name || 'Unknown');
    const invNum = sanitize(doc.invoice_number || 'NoNumber');
    const amount = doc.amount != null ? `$${Number(doc.amount).toFixed(2)}` : '$0.00';
    // Capitalize classification nicely
    const typeLabel = classification === 'credit-memo' ? 'Credit Memo'
      : classification === 'pay-application' ? 'Pay Application'
      : classification.charAt(0).toUpperCase() + classification.slice(1);
    return `${typeLabel} - ${vendor} - ${invNum} - ${amount}${ext}`;
  } else {
    // Non-invoice: "Lien Waiver - Vendor Name.pdf"
    const typeMap = {
      'lien-waiver': 'Lien Waiver', 'coi': 'COI', 'w9': 'W-9',
      'statement': 'Statement', 'contract': 'Contract',
      'change-order': 'Change Order', 'purchase-order': 'Purchase Order',
      'image': 'Image', 'other': 'Document'
    };
    const typeLabel = typeMap[classification] || classification.charAt(0).toUpperCase() + classification.slice(1);
    const vendor = sanitize(doc.vendor_name || doc.vendor_code || doc.email_from || 'Unknown');
    return `${typeLabel} - ${vendor}${ext}`;
  }
}

/**
 * Get the YYYY-MM for folder placement (invoice date > email received > queued)
 */
function getYearMonth(doc) {
  const d = doc.invoice_date || doc.email_received_at || doc.queued_at;
  if (!d) return new Date().toISOString().slice(0, 7);
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 7);
  return dt.toISOString().slice(0, 7);
}

async function uploadToBox(localPath, boxFileName, folderId) {
  try {
    // Copy to temp file with desired name, upload, delete temp
    const tmpDir = '/tmp/box-upload';
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, boxFileName);
    fs.copyFileSync(localPath, tmpPath);

    // Use single quotes to prevent shell expansion of $ in filenames
    const safeTmpPath = sanitizePathForShell(tmpPath);
    const output = execSync(
      `node "${BOX_SCRIPT}" upload "${safeTmpPath}" ${folderId}`,
      { encoding: 'utf8', timeout: 60000 }
    );

    // Clean temp
    try { fs.unlinkSync(tmpPath); } catch {}

    const match = output.match(/ID:\s*(\d+)/);
    if (match) return match[1];
    try {
      const json = JSON.parse(output);
      return json.id || json.entries?.[0]?.id || null;
    } catch {}
    console.log(`  Box output: ${output.trim()}`);
    return null;
  } catch (err) {
    console.error(`  Box upload failed for ${boxFileName}: ${err.message}`);
    return null;
  }
}

async function archiveAll(doCleanup = false) {
  const result = await pool.query(`
    SELECT id, classification, file_name, file_path, file_size_bytes,
           vendor_name, vendor_code, invoice_number, amount,
           invoice_date, email_received_at, email_from, queued_at,
           box_file_id, updated_at
    FROM documents
    WHERE file_path IS NOT NULL
    ORDER BY queued_at ASC
  `);

  const toUpload = result.rows.filter(r => !r.box_file_id && fs.existsSync(r.file_path));
  const toClean = doCleanup
    ? result.rows.filter(r => r.box_file_id && r.file_path && fs.existsSync(r.file_path))
        .filter(r => {
          // Only clean files older than 7 days
          const age = Date.now() - new Date(r.updated_at || r.queued_at).getTime();
          return age > 7 * 24 * 60 * 60 * 1000;
        })
    : [];

  console.log(`📦 ${toUpload.length} to upload, 🧹 ${toClean.length} local files to clean (>7 days)`);

  let uploaded = 0, cleaned = 0, errors = 0;

  // Upload new files
  for (const row of toUpload) {
    const boxFileName = buildBoxFileName(row);
    const yearMonth = getYearMonth(row);
    console.log(`  Uploading → ${yearMonth}/${boxFileName}`);

    try {
      const folderId = await getMonthFolder(yearMonth);
      const boxId = await uploadToBox(row.file_path, boxFileName, folderId);

      if (boxId) {
        await pool.query(
          'UPDATE documents SET box_file_id = $1, box_file_name = $2, box_folder_id = $3 WHERE id = $4',
          [boxId, boxFileName, folderId, row.id]
        );
        uploaded++;
        console.log(`  ✓ ${row.id} → Box ID: ${boxId}`);
      } else {
        errors++;
      }
    } catch (err) {
      console.error(`  ✗ ${row.id}: ${err.message}`);
      errors++;
    }
  }

  // Clean old local files
  for (const row of toClean) {
    try {
      fs.unlinkSync(row.file_path);
      await pool.query('UPDATE documents SET file_path = NULL WHERE id = $1', [row.id]);
      cleaned++;
    } catch (err) {
      console.error(`  Clean failed ${row.id}: ${err.message}`);
    }
  }

  console.log(`\n✅ Done: ${uploaded} uploaded, ${cleaned} cleaned, ${errors} errors`);
  await pool.end();
}

async function archiveSingle(docId) {
  const result = await pool.query(`
    SELECT id, classification, file_name, file_path,
           vendor_name, vendor_code, invoice_number, amount,
           invoice_date, email_received_at, email_from, queued_at
    FROM documents WHERE id = $1
  `, [docId]);

  if (result.rows.length === 0) { console.error('Document not found'); process.exit(1); }

  const row = result.rows[0];
  if (!row.file_path || !fs.existsSync(row.file_path)) {
    console.error('No local file found'); process.exit(1);
  }

  const boxFileName = buildBoxFileName(row);
  const yearMonth = getYearMonth(row);
  const folderId = await getMonthFolder(yearMonth);

  console.log(`Uploading → ${yearMonth}/${boxFileName}`);
  const boxId = await uploadToBox(row.file_path, boxFileName, folderId);
  if (boxId) {
    await pool.query(
      'UPDATE documents SET box_file_id = $1, box_file_name = $2, box_folder_id = $3 WHERE id = $4',
      [boxId, boxFileName, folderId, row.id]
    );
    console.log(`✓ ${row.id} → Box ID: ${boxId}`);
  }
  await pool.end();
}

async function retentionCleanup() {
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  
  // Find Box-archived docs older than 6 months (by invoice/received date)
  const result = await pool.query(`
    SELECT id, box_file_id, box_file_name,
           COALESCE(invoice_date, email_received_at, queued_at) as doc_date
    FROM documents
    WHERE box_file_id IS NOT NULL
      AND COALESCE(invoice_date, email_received_at, queued_at) < $1
  `, [sixMonthsAgo]);

  console.log(`🗑️  ${result.rows.length} Box files older than 6 months`);
  let deleted = 0;

  for (const row of result.rows) {
    try {
      execFileSync(
        'node', [BOX_SCRIPT, 'delete', String(row.box_file_id)],
        { encoding: 'utf8', timeout: 30000 }
      );
      await pool.query(
        'UPDATE documents SET box_file_id = NULL, box_file_name = NULL, box_folder_id = NULL WHERE id = $1',
        [row.id]
      );
      deleted++;
      console.log(`  ✓ Deleted ${row.box_file_name || row.id}`);
    } catch (err) {
      console.error(`  ✗ ${row.id}: ${err.message}`);
    }
  }

  console.log(`\n✅ Retention cleanup: ${deleted} Box files deleted`);
  await pool.end();
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'single' && process.argv[3]) {
    archiveSingle(process.argv[3]);
  } else if (cmd === 'cleanup') {
    archiveAll(true);
  } else if (cmd === 'retention') {
    retentionCleanup();
  } else {
    archiveAll(false);
  }
}

module.exports = { retentionCleanup };
