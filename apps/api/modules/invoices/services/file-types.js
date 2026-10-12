'use strict';
/**
 * File type helpers for invoice ingestion.
 */

const fs = require('fs');
const path = require('path');

const MAGIC_SIGNATURES = [
  { prefix: '25504446', ext: '.pdf', mediaType: 'application/pdf' },
  { prefix: '89504e47', ext: '.png', mediaType: 'image/png' },
  { prefix: 'ffd8ff', ext: '.jpg', mediaType: 'image/jpeg' },
  { prefix: '47494638', ext: '.gif', mediaType: 'image/gif' },
  { prefix: '49492a00', ext: '.tiff', mediaType: 'image/tiff' },
  { prefix: '4d4d002a', ext: '.tiff', mediaType: 'image/tiff' },
  // Legacy Word (.doc) — OLE compound document magic bytes
  { prefix: 'd0cf11e0', ext: '.doc', mediaType: 'application/msword' },
  // Note: .docx is ZIP-based (504b0304) which is shared with .xlsx/.pptx/etc.
  // Detection for .docx relies on file extension, not magic bytes.
];

function extToMediaType(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.tif':
    case '.tiff': return 'image/tiff';
    case '.doc': return 'application/msword';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default: return 'application/octet-stream';
  }
}

function sniffMagic(filePath) {
  try {
    const header = Buffer.alloc(8);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    const hex = header.toString('hex').slice(0, 16).toLowerCase();
    return MAGIC_SIGNATURES.find(sig => hex.startsWith(sig.prefix)) || null;
  } catch {
    return null;
  }
}

function detectFileType(filePath, fallbackName = null) {
  const name = fallbackName || filePath || '';
  const extFromName = path.extname(name).toLowerCase();
  const magic = filePath ? sniffMagic(filePath) : null;
  const ext = magic?.ext || extFromName;
  const mediaType = magic?.mediaType || extToMediaType(ext);

  return {
    ext,
    mediaType,
    isPdf: ext === '.pdf',
    isImage: ['.png', '.jpg', '.jpeg', '.gif', '.tif', '.tiff'].includes(ext),
    isWordDoc: ['.doc', '.docx'].includes(ext),
    detectedByMagic: Boolean(magic),
  };
}

function buildStoredFilename(id, sourceName, sourcePath = null) {
  const { ext } = detectFileType(sourcePath, sourceName);
  return `${id}${ext || '.bin'}`;
}

module.exports = {
  buildStoredFilename,
  detectFileType,
  extToMediaType,
};
