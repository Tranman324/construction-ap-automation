'use strict';

// Static contract tests for Word→PDF conversion (2026-09-01 live hotfix,
// upstreamed 2026-09-02). Word attachments (.doc/.docx) are converted to PDF
// via headless LibreOffice at the two entry points where files enter the
// system: email attachment download (pipeline) and manual file attach.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('docConvert converts in place with a unique LibreOffice profile, timeout, and output validation', () => {
  const src = read('modules/invoices/services/docConvert.js');

  // Isolation: unique UserInstallation per invocation (concurrent-safe)
  assert.match(src, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'lo-convert-'\)\)/);
  assert.match(src, /-env:UserInstallation=file:\/\/\$\{profileDir\}/);
  // Bounded: conversion cannot hang the caller
  assert.match(src, /CONVERT_TIMEOUT_MS = 30_000/);
  assert.match(src, /timeout: CONVERT_TIMEOUT_MS/);
  // Output validation: missing or empty PDF is an error, never silently kept
  assert.match(src, /did not produce expected PDF/);
  assert.match(src, /0-byte PDF/);
  // Cleanup: temp profile removed even on failure
  assert.match(src, /finally \{[\s\S]*rmSync\(profileDir, \{ recursive: true, force: true \}\)/);
  // Scope: only .doc/.docx are Word docs
  assert.match(src, /WORD_EXTENSIONS = new Set\(\['\.doc', '\.docx'\]\)/);
});

test('pipeline converts Word attachments at download and fails open on conversion errors', () => {
  const src = read('modules/invoices/services/pipeline.js');

  assert.match(src, /require\('\.\/docConvert'\)/);
  // Conversion happens inside downloadAttachments, gated on isWordDoc
  const block = src.match(/if \(isWordDoc\(filePath\)\) \{[\s\S]*?\n {6}\}/);
  assert.ok(block, 'pipeline should gate conversion on isWordDoc');
  // Success path records the converted file
  assert.match(block[0], /convertedFromWord: true/);
  // Failure path keeps the original file and continues (fail-open — a bad
  // Word doc must not kill ingestion of the whole email)
  assert.match(block[0], /catch \(convErr\)/);
  assert.match(block[0], /conversionFailed: true/);
});

test('manual attach converts Word uploads before the PDF/image type gate and cleans up on failure', () => {
  const src = read('modules/invoices/services/attachFileService.js');

  assert.match(src, /require\('\.\/docConvert'\)/);
  // Word uploads are renamed to their real extension (LibreOffice needs it)
  // and converted BEFORE the unsupported-type rejection
  const wordIdx = src.indexOf('convertToPdf(wordTmpPath)');
  const gateIdx = src.indexOf("Unsupported file type");
  assert.ok(wordIdx > -1 && gateIdx > -1 && wordIdx < gateIdx,
    'Word conversion must precede the unsupported-type gate');
  // Stored name/path are rebuilt for the .pdf result
  assert.match(src, /originalName\.replace\(\/\\\.docx\?\$\/i, '\.pdf'\)/);
  // Failure cleanup removes the renamed Word temp file too
  assert.match(src, /if \(wordTmpPath\) fs\.rmSync\(wordTmpPath, \{ force: true \}\)/);
});

test('file-types knows Word documents', () => {
  const src = read('modules/invoices/services/file-types.js');

  // Legacy .doc via OLE magic bytes; .docx is ZIP-based so extension-only
  assert.match(src, /d0cf11e0.*ext: '\.doc'/);
  assert.match(src, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(src, /isWordDoc: \['\.doc', '\.docx'\]\.includes\(ext\)/);
});
