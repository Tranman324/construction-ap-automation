'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../../../lib/logger');
const { ensurePdf, mergePdfs } = require('./pdf');

async function mergeWaiverPdfForInvoice({ pool, invoice, waiver, invoiceId, waiverId, requestId, requestLog, now }) {
  const log = requestLog || logger;
  const invoicePath = await ensurePdf(invoice);
  const waiverPath = await ensurePdf(waiver);

  if (!invoicePath || !waiverPath) return null;

  const mergedOutputPath = path.join(path.dirname(invoicePath), `merged_${invoiceId}.pdf`);
  await mergePdfs(invoicePath, waiverPath, mergedOutputPath);
  // Re-check the link before publishing: the merge runs outside the linking
  // transaction (fire-and-forget after approval), so the waiver may have been
  // unlinked in the meantime. Never overwrite merged_file_path for a stale link.
  const updateResult = await pool.query(
    'UPDATE documents SET merged_file_path = $1, updated_at = $2 WHERE id = $3 AND linked_lien_waiver_id = $4',
    [mergedOutputPath, now || new Date().toISOString(), invoiceId, waiverId]
  );
  if (updateResult.rowCount === 0) {
    deleteMergedPdf(mergedOutputPath, { invoiceId, waiverId }, log);
    log.warn({ requestId, invoiceId, waiverId }, 'Skipped merged PDF publish — waiver link changed during merge');
    return null;
  }
  log.info({ requestId, invoiceId, waiverId, mergedOutputPath }, 'Merged invoice waiver PDF');
  return mergedOutputPath;
}

function queueApprovedInvoiceWaiverMerge({ pool, invoice, invoiceId, waiverId, requestId, requestLog }) {
  const log = requestLog || logger;
  setImmediate(async () => {
    try {
      const waiverResult = await pool.query('SELECT * FROM documents WHERE id = $1', [waiverId]);
      if (waiverResult.rows.length === 0) return;

      const mergedOutputPath = await mergeWaiverPdfForInvoice({
        pool,
        invoice,
        waiver: waiverResult.rows[0],
        invoiceId,
        waiverId,
        requestId,
        requestLog: log,
      });
      if (mergedOutputPath) {
        log.info({ requestId, invoiceId, mergedOutputPath }, 'Merged approved invoice PDF');
      }
    } catch (mergeErr) {
      log.error({
        operation: 'invoice.approval.merge_pdf',
        context: { invoiceId },
        error: mergeErr && mergeErr.message ? mergeErr.message : String(mergeErr),
        err: mergeErr,
        requestId,
      }, 'PDF merge failed after approval');
    }
  });
}

function deleteMergedPdf(filePath, logContext, requestLog) {
  if (!filePath) return;
  const log = requestLog || logger;
  try {
    fs.unlinkSync(filePath);
    log.info({ ...logContext, mergedFilePath: filePath }, 'Deleted merged waiver PDF');
  } catch (unlinkErr) {
    log.warn({
      operation: 'invoice.waiver_unlink.delete_merged_pdf',
      context: logContext || {},
      error: unlinkErr && unlinkErr.message ? unlinkErr.message : String(unlinkErr),
      err: unlinkErr,
      mergedFilePath: filePath,
    }, 'Could not delete merged PDF during waiver unlink');
  }
}

module.exports = {
  deleteMergedPdf,
  mergeWaiverPdfForInvoice,
  queueApprovedInvoiceWaiverMerge,
};
