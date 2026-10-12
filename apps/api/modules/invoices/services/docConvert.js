'use strict';
/**
 * Word-to-PDF conversion via LibreOffice headless.
 *
 * Converts .doc/.docx files to PDF in place (replaces the original).
 * Uses a unique UserInstallation per invocation to avoid profile-lock
 * conflicts from concurrent conversions.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONVERT_TIMEOUT_MS = 30_000;
const WORD_EXTENSIONS = new Set(['.doc', '.docx']);

function isWordDoc(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return WORD_EXTENSIONS.has(ext);
}

/**
 * Convert a Word document to PDF in place.
 * The original .doc/.docx is deleted; the new .pdf takes its place.
 *
 * @param {string} filePath - Path to the .doc/.docx file
 * @returns {string} Path to the converted PDF
 * @throws {Error} If conversion fails or produces an empty/missing PDF
 */
function convertToPdf(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const expectedPdf = path.join(dir, `${baseName}.pdf`);

  // Unique temp profile to avoid concurrent-invocation lock conflicts
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-convert-'));

  try {
    execFileSync('libreoffice', [
      '--headless',
      '--norestore',
      '--safe-mode',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf',
      '--outdir', dir,
      filePath,
    ], {
      timeout: CONVERT_TIMEOUT_MS,
      stdio: 'pipe',
    });

    // Validate the output
    if (!fs.existsSync(expectedPdf)) {
      throw new Error(`LibreOffice did not produce expected PDF: ${expectedPdf}`);
    }
    const stats = fs.statSync(expectedPdf);
    if (stats.size === 0) {
      fs.rmSync(expectedPdf, { force: true });
      throw new Error('LibreOffice produced a 0-byte PDF');
    }

    // Delete the original Word doc
    if (expectedPdf !== filePath) {
      fs.rmSync(filePath, { force: true });
    }

    return expectedPdf;
  } finally {
    // Clean up the temp profile
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

module.exports = { convertToPdf, isWordDoc, WORD_EXTENSIONS };
