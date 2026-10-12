'use strict';
/**
 * OCR helpers for scanned PDFs and image attachments.
 */

const { execSync } = require('child_process');
const { INVOICE_OCR_MIN_CHARS } = require('../../../config');
const { sanitizePathForShell } = require('./sanitize');

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function isThinText(text) {
  const cleaned = normalizeText(text);
  return cleaned.length < INVOICE_OCR_MIN_CHARS;
}

function ocrImage(imagePath) {
  try {
    return normalizeText(execSync(`tesseract "${sanitizePathForShell(imagePath)}" stdout -l eng`, { timeout: 30000 }).toString());
  } catch {
    return '';
  }
}

function getPdfText(filePath) {
  try {
    return normalizeText(execSync(`pdftotext "${sanitizePathForShell(filePath)}" -`, { timeout: 10000 }).toString());
  } catch {
    return '';
  }
}

function getPdfOcrText(imagePaths = []) {
  return normalizeText(imagePaths.map(ocrImage).filter(Boolean).join('\n'));
}

function collectPdfText(filePath, imagePaths = []) {
  const extractedText = getPdfText(filePath);
  if (!isThinText(extractedText)) {
    return { text: extractedText, ocrApplied: false };
  }

  const ocrText = getPdfOcrText(imagePaths);
  if (ocrText.length > extractedText.length) {
    return { text: ocrText, ocrApplied: Boolean(ocrText) };
  }

  return { text: extractedText, ocrApplied: false };
}

function collectImageText(filePath) {
  const ocrText = ocrImage(filePath);
  return { text: ocrText, ocrApplied: Boolean(ocrText) };
}

module.exports = {
  collectImageText,
  collectPdfText,
  isThinText,
};
