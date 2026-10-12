'use strict';

const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { pool, audit, rowToDoc } = require('./supabase');

async function getSiblings(req, res) {
  try {
    const doc = await pool.query('SELECT email_message_id FROM documents WHERE id = $1', [req.params.id]);
    if (doc.rows.length === 0) return fail(res, 404, 'Document not found');
    if (!doc.rows[0].email_message_id) return res.json([]);

    const { limit, offset } = getPagination(req.query);
    const result = await pool.query(
      `SELECT * FROM documents
       WHERE email_message_id = $1
         AND id != $2
         AND deleted_at IS NULL
       ORDER BY queued_at ASC, id ASC
       LIMIT $3 OFFSET $4`,
      [doc.rows[0].email_message_id, req.params.id, limit, offset]
    );
    res.json(result.rows.map(rowToDoc));
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/siblings');
  }
}

async function linkDocument(req, res) {
  try {
    const { targetId } = req.body || {};
    const doc = await pool.query('SELECT id, linked_to FROM documents WHERE id = $1', [req.params.id]);
    if (doc.rows.length === 0) return fail(res, 404, 'Document not found');

    if (!targetId) {
      const now = new Date().toISOString();
      await pool.query('UPDATE documents SET linked_to = NULL, updated_at = $1 WHERE id = $2', [now, req.params.id]);
      await audit(req.params.id, 'unlinked', { linkedTo: [doc.rows[0].linked_to, null] });
      const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return res.json(rowToDoc(updated.rows[0]));
    }

    const target = await pool.query('SELECT id FROM documents WHERE id = $1', [targetId]);
    if (target.rows.length === 0) return fail(res, 404, 'Target document not found');

    const now = new Date().toISOString();
    await pool.query('UPDATE documents SET linked_to = $1, updated_at = $2 WHERE id = $3', [targetId, now, req.params.id]);
    await audit(req.params.id, 'linked', { linkedTo: [doc.rows[0].linked_to, targetId] });

    const updated = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    res.json(rowToDoc(updated.rows[0]));
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/link');
  }
}

async function getLinkedDocuments(req, res) {
  try {
    const doc = await pool.query('SELECT id FROM documents WHERE id = $1', [req.params.id]);
    if (doc.rows.length === 0) return fail(res, 404, 'Document not found');

    const { limit, offset } = getPagination(req.query);
    const result = await pool.query(
      `SELECT * FROM documents
       WHERE linked_to = $1
         AND deleted_at IS NULL
       ORDER BY queued_at ASC, id ASC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json(result.rows.map(rowToDoc));
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/linked');
  }
}

module.exports = {
  getLinkedDocuments,
  getSiblings,
  linkDocument,
};
