'use strict';
/**
 * PDF Split Service
 *
 * Utilities for:
 * - Splitting a multi-page PDF into N new PDFs using qpdf
 * - Extracting a single page as a thumbnail PNG via ImageMagick
 * - Detecting PDF page count
 *
 * All shell calls escape `$` in file paths to prevent variable expansion.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Use the centralized sanitizer for shell safety. The old shellEscape()
// only handled $; the new one handles all shell metacharacters.
const { sanitizePathForShell: shellEscape } = require('./sanitize');

/**
 * Get the page count of a PDF.
 * @param {string} pdfPath
 * @returns {number}
 */
function getPageCount(pdfPath) {
  try {
    const safePath = shellEscape(pdfPath);
    const out = execSync(`identify "${safePath}" 2>/dev/null | wc -l`, {
      timeout: 15000,
      encoding: 'utf8',
    }).trim();
    return parseInt(out, 10) || 1;
  } catch {
    return 1;
  }
}

/**
 * Extract a subset of pages from a PDF into a new PDF.
 * Supports non-contiguous pages via qpdf's comma syntax.
 *
 * @param {string} srcPath  - Source PDF path
 * @param {number[]} pages  - Array of 1-indexed page numbers
 * @param {string} destPath - Output PDF path
 * @returns {void}
 * @throws {Error} if qpdf fails
 */
function extractPages(srcPath, pages, destPath) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('extractPages: pages must be a non-empty array');
  }
  const safeSrc = shellEscape(srcPath);
  const safeDest = shellEscape(destPath);
  // qpdf supports both ranges (1-5) and lists (1,3,5) — we use explicit lists
  // so non-contiguous pages work cleanly
  const pageSpec = pages.join(',');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    // --warning-exit-0: damaged-but-recoverable PDFs (broken xref tables from
    // scanners etc.) make qpdf exit 3 with warnings even though it repairs the
    // file and writes a clean output. Treat warnings as success; real failures
    // still exit 2 and throw.
    execSync(`qpdf --warning-exit-0 "${safeSrc}" --pages . ${pageSpec} -- "${safeDest}"`, {
      timeout: 30000,
    });
  } catch (err) {
    const friendly = new Error('This PDF appears to be corrupted and could not be split. Ask the sender for a new copy of the file.');
    friendly.statusCode = 422;
    friendly.cause = err;
    throw friendly;
  }
}

/**
 * Render a single page of a PDF as a PNG image (for thumbnails).
 * Caches to disk so repeated calls are fast.
 *
 * Uses `pdftoppm` (poppler) for single-page extraction — fast and reliable.
 *
 * @param {string} pdfPath     - Source PDF path
 * @param {number} pageNumber  - 1-indexed page number
 * @param {string} cachePath   - Output PNG path (should be in a cache dir)
 * @param {number} width       - Target width in pixels (aspect preserved)
 * @returns {string}           - Path to the cached thumbnail
 * @throws {Error} if render fails
 */
function renderPageThumbnail(pdfPath, pageNumber, cachePath, width = 300) {
  // Return from cache if already rendered
  if (fs.existsSync(cachePath)) {
    return cachePath;
  }

  const safePdf = shellEscape(pdfPath);

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  // ☉ Retina/HiDPI support:
  // Render at 2x the requested CSS width and at a higher source DPI (200)
  // so 2x-pixel-ratio screens get sharp images. The frontend still requests
  // e.g. width=300 and lays the image out at 300 CSS pixels, but the PNG
  // contains 600 device pixels — browser downsamples nicely, no blur.
  const renderWidth = width * 2;

  // pdftoppm writes to <prefix>-NNN.png; we capture output in a temp spot
  // and move to the final cache path.
  const tmpPrefix = path.join(path.dirname(cachePath), `thumb-${Date.now()}`);
  const safeTmp = shellEscape(tmpPrefix);
  execSync(
    `pdftoppm -f ${pageNumber} -l ${pageNumber} -r 200 -scale-to-x ${renderWidth} -scale-to-y -1 -png "${safePdf}" "${safeTmp}"`,
    { timeout: 30000 }
  );

  // pdftoppm outputs <prefix>-<pagenum>.png (with zero-padding based on total pages)
  // For single-page extraction there's no padding — try a couple of common forms
  const candidates = [
    `${tmpPrefix}-${pageNumber}.png`,
    `${tmpPrefix}-${String(pageNumber).padStart(2, '0')}.png`,
    `${tmpPrefix}-${String(pageNumber).padStart(3, '0')}.png`,
  ];
  const actual = candidates.find((p) => fs.existsSync(p));
  if (!actual) {
    throw new Error(`pdftoppm produced no output for page ${pageNumber}`);
  }
  fs.renameSync(actual, cachePath);

  return cachePath;
}

/**
 * Render ALL pages of a PDF at once using pdftoppm. Much faster than
 * calling ImageMagick N times. Used by the analyze endpoint to batch-render
 * all pages for Haiku in a single subprocess call.
 *
 * @param {string} pdfPath    - Source PDF path
 * @param {string} outputDir  - Directory to write page-N.png files
 * @param {object} opts       - Options: { dpi=150, maxPages=null, prefix='page' }
 * @returns {string[]}        - Array of output PNG paths in page order (1..N)
 * @throws {Error} if pdftoppm fails
 */
function renderAllPages(pdfPath, outputDir, opts = {}) {
  const { dpi = 150, maxPages = null, prefix = 'page' } = opts;
  const safePdf = shellEscape(pdfPath);

  fs.mkdirSync(outputDir, { recursive: true });

  const tmpPrefix = path.join(outputDir, prefix);
  const safeTmp = shellEscape(tmpPrefix);

  const rangeArgs = maxPages ? `-f 1 -l ${maxPages}` : '';

  execSync(
    `pdftoppm ${rangeArgs} -r ${dpi} -png "${safePdf}" "${safeTmp}"`,
    { timeout: 120000 }
  );

  // Collect output files in order. pdftoppm zero-pads based on page count
  // (e.g., 10 pages → page-01.png, page-02.png, ..., page-10.png)
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.png'))
    .map((f) => path.join(outputDir, f))
    .sort(); // lexicographic sort works because of zero-padding

  if (files.length === 0) {
    throw new Error(`pdftoppm produced no output files for ${pdfPath}`);
  }

  return files;
}

/**
 * Validate a proposed split layout.
 * - Every page 1..pageCount must appear exactly once across groups and discardPages
 * - Each group must have at least one page
 * - Page numbers must be in valid range
 *
 * @param {object} layout
 * @param {Array<{pages: number[]}>} layout.groups
 * @param {number[]} [layout.discardPages]
 * @param {number} pageCount
 * @returns {{valid: boolean, error?: string}}
 */
function validateSplitLayout(layout, pageCount) {
  if (!layout || !Array.isArray(layout.groups)) {
    return { valid: false, error: 'groups must be an array' };
  }

  const discardPages = Array.isArray(layout.discardPages) ? layout.discardPages : [];
  const seen = new Set();

  for (const [i, group] of layout.groups.entries()) {
    if (!Array.isArray(group.pages) || group.pages.length === 0) {
      return { valid: false, error: `Group ${i + 1} has no pages` };
    }
    for (const p of group.pages) {
      if (!Number.isInteger(p) || p < 1 || p > pageCount) {
        return {
          valid: false,
          error: `Group ${i + 1} has invalid page number ${p} (must be 1-${pageCount})`,
        };
      }
      if (seen.has(p)) {
        return { valid: false, error: `Page ${p} is in multiple groups` };
      }
      seen.add(p);
    }
  }

  for (const p of discardPages) {
    if (!Number.isInteger(p) || p < 1 || p > pageCount) {
      return {
        valid: false,
        error: `Invalid discard page ${p} (must be 1-${pageCount})`,
      };
    }
    if (seen.has(p)) {
      return { valid: false, error: `Page ${p} cannot be in a group AND discarded` };
    }
    seen.add(p);
  }

  // Every page must be accounted for
  const missing = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!seen.has(p)) missing.push(p);
  }
  if (missing.length > 0) {
    return {
      valid: false,
      error: `Pages not assigned to any group or discarded: ${missing.join(', ')}`,
    };
  }

  return { valid: true };
}

module.exports = {
  shellEscape,
  getPageCount,
  extractPages,
  renderPageThumbnail,
  renderAllPages,
  validateSplitLayout,
};
