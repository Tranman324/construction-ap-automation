'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { BOX_SCRIPT } = require('/etc/toolbox/paths.js');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { ensurePdf } = require('./pdf');
const { pool } = require('./supabase');
const { sanitizeFilename } = require('./sanitize');

function getContentType(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

async function streamInvoicePdf(req, res) {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    const filePath = await ensurePdf(row);
    if (filePath && fs.existsSync(filePath)) {
      const abs = path.resolve(filePath);
      res.setHeader('Content-Type', getContentType(abs));
      res.setHeader('Content-Disposition', `inline; filename="${row.file_name || path.basename(abs)}"`);
      return fs.createReadStream(abs).pipe(res);
    }

    return fail(res, 404, 'No PDF data available — could not recover from email');
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/pdf');
  }
}

async function getInvoiceEmail(req, res) {
  try {
    const result = await pool.query(
      'SELECT email_from, email_subject, email_received_at, email_body_preview, email_body, email_body_content_type FROM documents WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');
    const row = result.rows[0];

    if (req.query.raw === 'true' && row.email_body) {
      res.set('Content-Type', row.email_body_content_type === 'html' ? 'text/html' : 'text/plain');
      return res.send(row.email_body);
    }

    res.json({
      from: row.email_from,
      subject: row.email_subject,
      receivedAt: row.email_received_at ? row.email_received_at.toISOString() : null,
      bodyPreview: row.email_body_preview,
      body: row.email_body,
      bodyContentType: row.email_body_content_type || 'text',
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/email');
  }
}

async function headInvoiceFile(req, res) {
  try {
    const result = await pool.query('SELECT file_name, file_path FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const { file_name, file_path: filePath } = result.rows[0];
    if (filePath && fs.existsSync(filePath)) {
      res.set('Content-Type', getContentType(file_name));
      return res.status(200).end();
    }
    return fail(res, 404, 'No file available');
  } catch (err) {
    return safeError(res, err, 'HEAD /api/invoices/:id/file');
  }
}

async function streamInvoiceFile(req, res) {
  try {
    const result = await pool.query('SELECT file_name, file_path, box_file_id FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const { file_name, file_path: filePath, box_file_id } = result.rows[0];
    if (filePath && fs.existsSync(filePath)) {
      res.set('Content-Type', getContentType(file_name));
      return fs.createReadStream(filePath).pipe(res);
    }

    if (box_file_id) {
      const tmpPath = path.join(
        '/tmp',
        `box-${sanitizeFilename(String(req.params.id))}-${sanitizeFilename(file_name || 'file.pdf')}`
      );
      try {
        execFileSync('node', [BOX_SCRIPT, 'download', String(box_file_id), tmpPath], { timeout: 30000 });
        res.set('Content-Type', getContentType(file_name));
        const stream = fs.createReadStream(tmpPath);
        stream.on('end', () => { try { fs.unlinkSync(tmpPath); } catch {} });
        return stream.pipe(res);
      } catch (boxErr) {
        req.log.warn({
          operation: 'invoice.file.box_download',
          context: { invoiceId: req.params.id },
          error: boxErr && boxErr.message ? boxErr.message : String(boxErr),
          err: boxErr,
        }, 'Box download failed while streaming invoice file');
      }
    }

    return fail(res, 404, 'No file available — file expired from local storage and Box download failed');
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/file');
  }
}

async function getInvoiceAudit(req, res) {
  try {
    const doc = await pool.query('SELECT id FROM documents WHERE id = $1', [req.params.id]);
    if (doc.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const { limit, offset } = getPagination(req.query);
    const result = await pool.query(
      `SELECT id, type, actor_name, changes, before_state, after_state, undoable,
              undone_at, undone_by, summary, severity, timestamp, created_at
       FROM audit_events
       WHERE target_id = $1
       ORDER BY timestamp DESC, created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      action: row.type,
      actor: row.actor_name,
      changes: row.changes,
      beforeState: row.before_state || null,
      afterState: row.after_state || null,
      undoable: row.undoable || false,
      undoneAt: row.undone_at ? row.undone_at.toISOString() : null,
      undoneBy: row.undone_by || null,
      summary: row.summary,
      severity: row.severity,
      createdAt: row.timestamp ? row.timestamp.toISOString() : null,
    })));
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/audit');
  }
}

module.exports = {
  getContentType,
  getInvoiceAudit,
  getInvoiceEmail,
  headInvoiceFile,
  streamInvoiceFile,
  streamInvoicePdf,
};
