'use strict';
const path = require('node:path');
const { EmailError } = require('./errors');
const { stampSubjectRefTag, buildBodyToken } = require('../refTag');
const LIMIT = 3 * 1024 * 1024;
function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function attachment(doc, fs) {
  if (!doc.file_path) return { file: null, oversized: false };
  try {
    const stat = await fs.stat(doc.file_path);
    if (!stat.isFile()) throw new Error('not file');
    if (stat.size > LIMIT) return { file: null, oversized: true };
    const bytes = await fs.readFile(doc.file_path);
    if (bytes.length > LIMIT) return { file: null, oversized: true };
    return { oversized: false, file: {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: path.basename(doc.file_name || doc.file_path), contentType: 'application/pdf',
      contentBytes: bytes.toString('base64'),
    } };
  } catch { throw new EmailError(422, 'Document file is unavailable', 'EMAIL_FILE_UNAVAILABLE'); }
}
function content(doc, actor, input, kind, oversized, config) {
  const label = doc.invoice_number || doc.doc_title || doc.file_name || doc.id;
  const rawSubject = kind === 'reply'
    ? `RE: ${(doc.email_subject || label).replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')}`
    : `FW: ${label} — ${doc.vendor_name || ''}`;
  const subject = stampSubjectRefTag(rawSubject, doc.id);
  let html = `<p>${escape(input.body).replace(/\r?\n/g, '<br>')}</p>`;
  if (kind === 'forward') {
    // Forward summary block intentionally omitted — invoice details are in the
    // attached PDF and not all recipients have Toolbox context.
  }
  if (oversized) html += '<p>PDF too large to attach — attachment omitted.</p>';
  html += `<p>${escape(actor.name || actor.email || 'Toolbox user')}</p>`;
  html += buildBodyToken(doc.id);
  return { subject, html };
}
module.exports = { attachment, content, LIMIT };
