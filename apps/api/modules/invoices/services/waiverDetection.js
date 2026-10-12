'use strict';
/**
 * Deterministic lien-waiver detection helpers.
 *
 * Used by pipeline.js, split-worker.js, and reprocess-errors.js to apply a
 * keyword pre-pass BEFORE (or instead of) Haiku vision classification.
 */

const { execSync } = require('child_process');
const { sanitizePathForShell } = require('./sanitize');

/**
 * Regex that matches lien-waiver page titles / headings.
 * Case-insensitive.  Covers Georgia-style, AIA-style, and common variants.
 */
const WAIVER_REGEX =
  /waiver\s+and\s+release|release\s+of\s+lien|payment\s+bond\s+rights|waiver\s+.{0,30}upon\s+(final|progress)\s+payment|unconditional\s+waiver|conditional\s+waiver|waives?\s+and\s+releases?\s+any\s+and\s+all\s+liens?|claims?\s+of\s+liens?\s+upon/i;

/**
 * Regex for invoice-strong signals — used to protect page 1 from being
 * force-reclassified when it carries BOTH waiver phrases and invoice content.
 */
const INVOICE_STRONG_REGEX = /invoice\s*(?:number|no\.?|#)|amount\s+due/i;

/**
 * Extract text from a single page of a PDF using pdftotext.
 * Returns empty string on failure (scanned page, corrupt file, etc.).
 *
 * @param {string} filePath  Full path to the PDF
 * @param {number} pageNum   1-based page number
 * @returns {string}
 */
function getPdfPageText(filePath, pageNum) {
  try {
    const safe = sanitizePathForShell(filePath);
    return execSync(`pdftotext -f ${pageNum} -l ${pageNum} "${safe}" -`, {
      timeout: 10000,
    })
      .toString()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/**
 * OCR a single page image using tesseract.
 * @param {string} imagePath
 * @returns {string}
 */
function ocrPageImage(imagePath) {
  try {
    return execSync(`tesseract "${sanitizePathForShell(imagePath)}" stdout -l eng`, {
      timeout: 30000,
    })
      .toString()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/**
 * Determine per-page text for waiver keyword checking.
 *
 * For text-layer PDFs we extract per-page via pdftotext -f N -l N.
 * For scanned PDFs where pdftotext returns nothing, we render each page
 * to a temp image and OCR it individually so the waiver regex can fire.
 *
 * @param {string}   filePath      Path to the PDF
 * @param {number}   pageCount     Total pages
 * @param {boolean}  ocrApplied    Whether OCR was used (text layer was thin)
 * @returns {(string|null)[]}  Per-page text array (0-indexed).  null = no text available for that page.
 */
function getPerPageTexts(filePath, pageCount, ocrApplied) {
  const texts = [];
  for (let p = 1; p <= pageCount; p++) {
    const pageText = getPdfPageText(filePath, p);
    // A dense text layer that already matches needs no OCR. Otherwise OCR the
    // page image and combine: hybrid pages (thin text-layer header + scanned
    // waiver body) and fully scanned pages both need it. Threshold 800 chars —
    // real invoice pages are text-dense; waiver pages are sparse.
    if (pageText.length >= 800 || WAIVER_REGEX.test(pageText)) {
      texts.push(pageText);
    } else {
      const tmpImg = `/tmp/waiver_ocr_${Date.now()}_p${p}.png`;
      try {
        execSync(
          `convert -density 200 "${sanitizePathForShell(filePath)}"[${p - 1}] -quality 95 "${tmpImg}"`,
          { timeout: 30000 }
        );
        const ocrText = ocrPageImage(tmpImg);
        const combined = `${pageText} ${ocrText}`.trim();
        texts.push(combined.length > 10 ? combined : null);
      } catch {
        texts.push(pageText.length > 20 ? pageText : null);
      } finally {
        try { require('fs').unlinkSync(tmpImg); } catch {}
      }
    }
  }
  return texts;
}

/**
 * Apply deterministic waiver keyword pre-pass to per-page classifications.
 *
 * Mutates `pageClassifications` in-place, forcing pages that match the waiver
 * regex to 'lien-waiver' — UNLESS it's page 0 (first page) and the text also
 * has invoice-strong signals (ambiguous; keep Haiku's call).
 *
 * @param {string[]}         pageClassifications  Per-page Haiku classifications (mutated in-place)
 * @param {(string|null)[]}  perPageTexts         Per-page text (null = skip)
 * @returns {number}  Count of pages force-reclassified
 */
function applyWaiverPrePass(pageClassifications, perPageTexts) {
  let reclassified = 0;
  for (let i = 0; i < pageClassifications.length; i++) {
    const text = perPageTexts[i];
    if (text == null) continue; // no attributable text — skip

    if (WAIVER_REGEX.test(text)) {
      // Page 1 (index 0) ambiguity guard: if it also has invoice signals, defer to Haiku
      if (i === 0 && INVOICE_STRONG_REGEX.test(text)) {
        continue;
      }
      if (pageClassifications[i] !== 'lien-waiver') {
        pageClassifications[i] = 'lien-waiver';
        reclassified++;
      }
    }
  }
  return reclassified;
}

module.exports = {
  WAIVER_REGEX,
  INVOICE_STRONG_REGEX,
  getPdfPageText,
  getPerPageTexts,
  applyWaiverPrePass,
};
