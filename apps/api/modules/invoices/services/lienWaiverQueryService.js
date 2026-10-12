'use strict';

const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { pool } = require('./supabase');

function formatOrphanWaiver(row) {
  return {
    id: row.id,
    fileName: row.file_name || null,
    vendorCode: row.vendor_code || null,
    vendorName: row.vendor_name || null,
    jobNumber: row.job_match_number || null,
    amountWaived: row.amount != null ? parseFloat(row.amount) : null,
    receivedAt: row.email_received_at
      ? row.email_received_at.toISOString()
      : (row.queued_at ? row.queued_at.toISOString() : null),
    emailFrom: row.email_from || null,
    filed: Boolean(row.filed),
  };
}

async function listFiledOrphanWaivers({ vendorCode, jobNumber, search, limit, offset }) {
  const conditions = [
    "classification = 'lien-waiver'",
    'filed = true',
    'linked_lien_waiver_id IS NULL',
  ];
  const params = [];
  let parameter = 1;
  if (vendorCode) {
    conditions.push(`vendor_code = $${parameter++}`);
    params.push(vendorCode);
  }
  if (jobNumber) {
    conditions.push(`job_match_number = $${parameter++}`);
    params.push(jobNumber);
  }
  if (search) {
    conditions.push(`(file_name ILIKE $${parameter} OR vendor_name ILIKE $${parameter})`);
    params.push(`%${search}%`);
    parameter += 1;
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const countResult = await pool.query(`SELECT COUNT(*) FROM documents ${where}`, params);
  const result = await pool.query(
    `SELECT id, file_name, vendor_code, vendor_name, job_match_number, amount, email_received_at, queued_at, email_from
     FROM documents ${where}
     ORDER BY queued_at DESC, id DESC
     LIMIT $${parameter++} OFFSET $${parameter++}`,
    [...params, limit, offset]
  );
  return { rows: result.rows, total: parseInt(countResult.rows[0].count, 10) };
}

const ORPHAN_PAGE_SIZE = 10;

function formatDocumentSummary(row) {
  return {
    id: row.id,
    fileName: row.file_name || null,
    vendorName: row.vendor_name || row.matched_vendor_name || null,
    vendorCode: row.vendor_code || null,
    amount: row.amount != null ? parseFloat(row.amount) : null,
    invoiceNumber: row.invoice_number || null,
    jobNumber: row.job_match_number || row.job_number || null,
    status: row.status || null,
    receivedAt: row.email_received_at ? row.email_received_at.toISOString() : (row.queued_at ? row.queued_at.toISOString() : null),
  };
}

function formatPairedDocumentSummary(row) {
  return {
    id: row.id,
    fileName: row.file_name || null,
    vendorName: row.vendor_name || row.matched_vendor_name || null,
    vendorCode: row.vendor_code || null,
    amount: row.amount != null ? parseFloat(row.amount) : null,
    invoiceNumber: row.invoice_number || null,
    jobNumber: row.job_match_number || row.job_number || null,
    status: row.status || null,
  };
}

async function loadPairedDocumentSummary(pairedDocumentId) {
  if (!pairedDocumentId) return null;

  const result = await pool.query(
    `SELECT id, file_name, vendor_name, matched_vendor_name, vendor_code, amount, invoice_number,
            job_match_number, job_number, status
       FROM documents
      WHERE id = $1 AND deleted_at IS NULL`,
    [pairedDocumentId]
  );

  return result.rows[0] ? formatPairedDocumentSummary(result.rows[0]) : null;
}

function orphanSearchCondition(parameter, query) {
  if (!query) return { clause: '', params: [], parameter };
  const value = `%${query}%`;
  return {
    clause: ` AND (
      file_name ILIKE $${parameter}
      OR vendor_name ILIKE $${parameter}
      OR matched_vendor_name ILIKE $${parameter}
      OR vendor_code ILIKE $${parameter}
      OR invoice_number ILIKE $${parameter}
      OR job_match_number ILIKE $${parameter}
      OR job_number ILIKE $${parameter}
      OR CAST(amount AS TEXT) ILIKE $${parameter}
      OR email_from ILIKE $${parameter}
      OR email_subject ILIKE $${parameter}
    )`,
    params: [value],
    parameter: parameter + 1,
  };
}

async function getOrphanCandidates({ id, targetClassifications, candidateWhere, query, collectionKey }) {
  const parentResult = await pool.query(
    `SELECT id, classification, file_name, vendor_name, matched_vendor_name, vendor_code,
            amount, invoice_number, job_match_number, job_number, status, email_received_at, queued_at,
            linked_lien_waiver_id
       FROM documents
      WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const target = parentResult.rows[0] || null;
  if (!target) return { missing: true };
  if (!targetClassifications.includes(target.classification)) return { invalidTarget: true };

  const paired = await loadPairedDocumentSummary(target.linked_lien_waiver_id);

  const countSearch = orphanSearchCondition(1, query?.q);
  const dataSearch = orphanSearchCondition(3, query?.q);
  const countWhere = `WHERE ${candidateWhere}${countSearch.clause}`;
  const dataWhere = `WHERE ${candidateWhere}${dataSearch.clause}`;
  const priorityParams = [target.vendor_code || null, target.vendor_name || target.matched_vendor_name || null];
  const countResult = await pool.query(`SELECT COUNT(*) FROM documents ${countWhere}`, countSearch.params);
  const page = query?.page || 1;
  const offset = (page - 1) * ORPHAN_PAGE_SIZE;
  const dataResult = await pool.query(
    `SELECT id, file_name, vendor_name, matched_vendor_name, vendor_code, amount, invoice_number,
            job_match_number, job_number, status, email_received_at, queued_at
       FROM documents ${dataWhere}
      ORDER BY CASE WHEN (vendor_code = $1 OR LOWER(COALESCE(vendor_name, matched_vendor_name)) = LOWER($2)) THEN 0 ELSE 1 END,
               email_received_at DESC NULLS LAST,
               queued_at DESC NULLS LAST,
               id DESC
      LIMIT $${dataSearch.parameter} OFFSET $${dataSearch.parameter + 1}`,
    [...priorityParams, ...dataSearch.params, ORPHAN_PAGE_SIZE, offset]
  );

  return {
    [collectionKey]: dataResult.rows.map(formatDocumentSummary),
    target: formatDocumentSummary(target),
    paired,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit: ORPHAN_PAGE_SIZE,
  };
}

async function getOrphanWaiversForInvoice({ id, query }) {
  return getOrphanCandidates({
    id,
    targetClassifications: ['invoice', 'pay-application'],
    candidateWhere: `classification = 'lien-waiver'
       AND linked_lien_waiver_id IS NULL
       AND deleted_at IS NULL
       AND (status IS NULL OR status NOT IN ('submitted', 'submitting', 'split-processing', 'discarded'))`,
    query,
    collectionKey: 'waivers',
  });
}

async function getOrphanInvoicesForWaiver({ id, query }) {
  return getOrphanCandidates({
    id,
    targetClassifications: ['lien-waiver'],
    candidateWhere: `classification IN ('invoice', 'pay-application')
       AND linked_lien_waiver_id IS NULL
       AND deleted_at IS NULL
       AND (status IS NULL OR status NOT IN ('submitted', 'submitting', 'split-processing', 'discarded'))`,
    query,
    collectionKey: 'invoices',
  });
}

module.exports = {
  listFiledOrphanWaivers,
  getOrphanWaiversForInvoice,
  getOrphanInvoicesForWaiver,
  formatDocumentSummary,
  formatPairedDocumentSummary,
  loadPairedDocumentSummary,
};
