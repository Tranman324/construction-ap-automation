'use strict';

const {
  emitInvoiceAuditEvent,
  getRequestAuditActor,
} = require('../../../lib/auditEvents');
const { failFromBody, safeError } = require('../../../middleware/errorResponse');
const { pool, audit, rowToDoc } = require('./supabase');
const { checkPermission } = require('../../../middleware/permissions');
const { withTransaction } = require('./transaction');
const {
  matchStatementLine,
  matchStatementLineWithEvidence,
  normalizeStatementLines,
} = require('./statementLines');

function parseStatementLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeStatementInvoice(row, req) {
  return rowToDoc(row, {
    includeStatementReconcile: true,
    canReconcile: checkPermission(req, 'accounting.invoices.approve'),
  });
}

function buildManualLineId(invoiceNumber, existingLines) {
  const base = String(invoiceNumber || 'manual-line').trim() || 'manual-line';
  const existingIds = new Set(
    existingLines
      .map((line) => line && line.id)
      .filter(Boolean)
      .map(String)
  );
  if (!existingIds.has(base)) return base;

  let index = 2;
  while (existingIds.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function buildStatementLineLookups(statementId) {
  return {
    async findToolboxInvoice(input) {
      const result = await pool.query(
        `SELECT id, invoice_number, vendor_code, amount
         FROM documents
         WHERE REGEXP_REPLACE(invoice_number, '[^a-zA-Z0-9]', '', 'g')
             = REGEXP_REPLACE($1, '[^a-zA-Z0-9]', '', 'g')
           AND vendor_code = $2
           AND id <> $3
           AND COALESCE(status, '') NOT IN ('discarded', 'duplicate', 'split')
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [input.invoiceNumber, input.vendorCode, statementId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        invoiceNumber: row.invoice_number,
        vendorCode: row.vendor_code,
        amount: row.amount,
      };
    },
    async findSpectrumInvoice(input) {
      const { findSpectrumInvoice } = require('./spectrum');
      return findSpectrumInvoice({
        invoiceNumber: input.invoiceNumber,
        vendorCode: input.vendorCode,
      });
    },
  };
}

function hasVendorScope(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function rematchLine(line, vendorCode, lookups) {
  const { line: rematched, hasForeignVendorEvidence } = await matchStatementLineWithEvidence({ ...line }, vendorCode, lookups);
  if (!rematched) return line;

  // A foreign-vendor lookup is intentionally treated as no match by the
  // matcher. Do not let that incomplete evidence clear a confirmed match.
  if (line.status === 'matched' && rematched.status === 'not_received' && hasForeignVendorEvidence) return line;

  return { ...rematched, id: line.id, source: line.source };
}

async function addStatementLine(req, res, options = {}) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { statusCode: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      if (row.classification !== 'statement') {
        return {
          statusCode: 400,
          body: { error: 'Statement lines can only be added to statement documents' },
        };
      }

      const existingLines = parseStatementLines(row.statement_lines);
      const [manualLine] = normalizeStatementLines({
        statementLines: [{
          invoiceNumber: req.body.invoiceNumber,
          date: req.body.date ?? null,
          amount: req.body.amount,
          source: 'manual',
          status: 'not_received',
        }],
      }, {
        source: 'manual',
        defaultStatus: 'not_received',
      });

      if (!manualLine) return { statusCode: 400, body: { error: 'Invalid statement line' } };

      manualLine.id = buildManualLineId(manualLine.invoiceNumber, existingLines);
      const matchedLine = await matchStatementLine(
        manualLine,
        row.vendor_code,
        options.lookups || buildStatementLineLookups(row.id)
      );
      const lineToPersist = matchedLine || manualLine;
      const updatedLines = [...existingLines, lineToPersist];
      const beforeState = { statement_lines: existingLines };
      const afterState = { statement_lines: updatedLines };

      await db.query(
        `UPDATE documents
         SET statement_lines = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedLines), row.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [row.id]);
      return {
        row,
        updatedRow: updated.rows[0],
        beforeState,
        afterState,
        lineToPersist,
      };
    });

    if (outcome.body) {
      return failFromBody(res, outcome.statusCode, outcome.body);
    }

    const { row, updatedRow, beforeState, afterState, lineToPersist } = outcome;
    const actor = getRequestAuditActor(req, res).name || 'system';

    await audit(row.id, 'statement-line-added', {
      lineId: lineToPersist.id,
      invoiceNumber: lineToPersist.invoiceNumber,
      status: lineToPersist.status,
    }, actor);
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.statement_line_added',
      invoiceId: row.id,
      targetType: 'document',
      targetId: row.id,
      row,
      changes: {
        lineId: lineToPersist.id,
        invoiceNumber: lineToPersist.invoiceNumber,
        status: lineToPersist.status,
      },
      beforeState,
      afterState,
      undoable: false,
      summary: 'Statement line added',
      severity: 'info',
    });

    const invoice = serializeStatementInvoice(updatedRow, req);
    return res.json({
      invoice,
      statementLines: invoice.statementLines,
      addedLine: lineToPersist,
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/statement-lines');
  }
}

// Lines already reconciled/matched are protected from destructive edits.
const PROTECTED_LINE_STATUSES = new Set(['matched', 'in_toolbox_not_spectrum']);
const RESOLUTION_BY_STATUS = {
  amount_differs: 'use_ap_amount',
  not_received: 'accept_line',
};

function findLineIndex(lines, lineId) {
  const target = String(lineId);
  return lines.findIndex((line) => line && String(line.id) === target);
}

async function setStatementLineResolution(req, res, resolved) {
  const routeLabel = resolved ? 'resolve' : 'unresolve';
  try {
    const actor = getRequestAuditActor(req, res).name || 'system';
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { statusCode: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      if (row.classification !== 'statement') {
        return { statusCode: 400, body: { error: 'Statement lines only exist on statement documents' } };
      }

      const existingLines = parseStatementLines(row.statement_lines);
      const index = findLineIndex(existingLines, req.params.lineId);
      if (index === -1) return { statusCode: 404, body: { error: 'Statement line not found' } };

      const currentLine = existingLines[index];
      if (resolved) {
        const expectedResolution = RESOLUTION_BY_STATUS[currentLine.status];
        if (!expectedResolution) {
          return {
            statusCode: 409,
            body: { error: 'Matched statement lines do not require resolution', code: 'LINE_ALREADY_CLEAR' },
          };
        }
        if (req.body.resolutionType !== expectedResolution) {
          return {
            statusCode: 400,
            body: { error: `Resolution type "${req.body.resolutionType}" is not valid for status "${currentLine.status}"` },
          };
        }
      }

      const updatedLine = { ...currentLine };
      if (resolved) {
        updatedLine.resolvedAt = new Date().toISOString();
        updatedLine.resolutionType = req.body.resolutionType;
        updatedLine.resolvedBy = actor;
      } else {
        delete updatedLine.resolvedAt;
        delete updatedLine.resolutionType;
        delete updatedLine.resolvedBy;
      }

      const updatedLines = [...existingLines];
      updatedLines[index] = updatedLine;
      const beforeState = { statement_lines: existingLines };
      const afterState = { statement_lines: updatedLines };

      await db.query(
        `UPDATE documents
         SET statement_lines = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedLines), row.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [row.id]);
      return { row, updatedRow: updated.rows[0], beforeState, afterState, updatedLine };
    });

    if (outcome.body) return failFromBody(res, outcome.statusCode, outcome.body);

    const { row, updatedRow, beforeState, afterState, updatedLine } = outcome;
    const auditType = resolved ? 'statement-line-resolved' : 'statement-line-unresolved';
    await audit(row.id, auditType, {
      lineId: updatedLine.id,
      invoiceNumber: updatedLine.invoiceNumber,
      resolutionType: updatedLine.resolutionType || null,
    }, actor);
    await emitInvoiceAuditEvent(req, res, {
      type: resolved ? 'document.statement_line_resolved' : 'document.statement_line_unresolved',
      invoiceId: row.id,
      targetType: 'document',
      targetId: row.id,
      row,
      changes: {
        lineId: updatedLine.id,
        invoiceNumber: updatedLine.invoiceNumber,
        resolutionType: updatedLine.resolutionType || null,
      },
      beforeState,
      afterState,
      undoable: false,
      summary: resolved ? 'Statement line resolved' : 'Statement line resolution removed',
      severity: 'info',
    });

    const invoice = serializeStatementInvoice(updatedRow, req);
    return res.json({ invoice, statementLines: invoice.statementLines, updatedLine });
  } catch (err) {
    return safeError(res, err, `POST /api/invoices/:id/statement-lines/:lineId/${routeLabel}`);
  }
}

function resolveStatementLine(req, res) {
  return setStatementLineResolution(req, res, true);
}

function unresolveStatementLine(req, res) {
  return setStatementLineResolution(req, res, false);
}

async function updateStatementLine(req, res, options = {}) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { statusCode: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      if (row.classification !== 'statement') {
        return { statusCode: 400, body: { error: 'Statement lines only exist on statement documents' } };
      }

      const existingLines = parseStatementLines(row.statement_lines);
      const index = findLineIndex(existingLines, req.params.lineId);
      if (index === -1) return { statusCode: 404, body: { error: 'Statement line not found' } };

      const currentLine = existingLines[index];
      if (PROTECTED_LINE_STATUSES.has(currentLine.status)) {
        return {
          statusCode: 409,
          body: {
            error: `Cannot edit a line with status "${currentLine.status}". Unmatch it first.`,
            code: 'LINE_STATUS_PROTECTED',
          },
        };
      }

      // Merge the allowed edits over the current line, then renormalize.
      const candidate = {
        ...currentLine,
        ...(('invoiceNumber' in req.body) ? { invoiceNumber: req.body.invoiceNumber } : {}),
        ...(('date' in req.body) ? { date: req.body.date } : {}),
        ...(('amount' in req.body) ? { amount: req.body.amount } : {}),
      };
      const [normalized] = normalizeStatementLines(
        { statementLines: [candidate] },
        { source: currentLine.source || 'extracted', defaultStatus: 'not_received' }
      );
      if (!normalized) return { statusCode: 400, body: { error: 'Invalid statement line after edit' } };

      normalized.id = currentLine.id;
      // Invoice number changed → re-run matching so status reflects reality.
      const matchedLine = await matchStatementLine(
        normalized,
        row.vendor_code,
        options.lookups || buildStatementLineLookups(row.id)
      );
      const lineToPersist = matchedLine || normalized;

      const updatedLines = [...existingLines];
      updatedLines[index] = lineToPersist;
      const beforeState = { statement_lines: existingLines };
      const afterState = { statement_lines: updatedLines };

      await db.query(
        `UPDATE documents
         SET statement_lines = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedLines), row.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [row.id]);
      return { row, updatedRow: updated.rows[0], beforeState, afterState, previousLine: currentLine, lineToPersist };
    });

    if (outcome.body) return failFromBody(res, outcome.statusCode, outcome.body);

    const { row, updatedRow, beforeState, afterState, previousLine, lineToPersist } = outcome;
    const actor = getRequestAuditActor(req, res).name || 'system';

    await audit(row.id, 'statement-line-edited', {
      lineId: lineToPersist.id,
      invoiceNumber: [previousLine.invoiceNumber, lineToPersist.invoiceNumber],
      amount: [previousLine.amount, lineToPersist.amount],
      date: [previousLine.date, lineToPersist.date],
      status: [previousLine.status, lineToPersist.status],
    }, actor);
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.statement_line_edited',
      invoiceId: row.id,
      targetType: 'document',
      targetId: row.id,
      row,
      changes: {
        lineId: lineToPersist.id,
        invoiceNumber: [previousLine.invoiceNumber, lineToPersist.invoiceNumber],
        amount: [previousLine.amount, lineToPersist.amount],
      },
      beforeState,
      afterState,
      undoable: false,
      summary: 'Statement line edited',
      severity: 'info',
    });

    const invoice = serializeStatementInvoice(updatedRow, req);
    return res.json({
      invoice,
      statementLines: invoice.statementLines,
      updatedLine: lineToPersist,
    });
  } catch (err) {
    return safeError(res, err, 'PATCH /api/invoices/:id/statement-lines/:lineId');
  }
}

async function deleteStatementLine(req, res) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { statusCode: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      if (row.classification !== 'statement') {
        return { statusCode: 400, body: { error: 'Statement lines only exist on statement documents' } };
      }

      const existingLines = parseStatementLines(row.statement_lines);
      const index = findLineIndex(existingLines, req.params.lineId);
      if (index === -1) return { statusCode: 404, body: { error: 'Statement line not found' } };

      const removedLine = existingLines[index];
      if (PROTECTED_LINE_STATUSES.has(removedLine.status)) {
        return {
          statusCode: 409,
          body: {
            error: `Cannot delete a line with status "${removedLine.status}". Unmatch it first.`,
            code: 'LINE_STATUS_PROTECTED',
          },
        };
      }

      const updatedLines = existingLines.filter((_, i) => i !== index);
      const beforeState = { statement_lines: existingLines };
      const afterState = { statement_lines: updatedLines };

      await db.query(
        `UPDATE documents
         SET statement_lines = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedLines), row.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [row.id]);
      return { row, updatedRow: updated.rows[0], beforeState, afterState, removedLine };
    });

    if (outcome.body) return failFromBody(res, outcome.statusCode, outcome.body);

    const { row, updatedRow, beforeState, afterState, removedLine } = outcome;
    const actor = getRequestAuditActor(req, res).name || 'system';

    await audit(row.id, 'statement-line-removed', {
      lineId: removedLine.id,
      invoiceNumber: removedLine.invoiceNumber,
      amount: removedLine.amount,
      status: removedLine.status,
      source: removedLine.source,
    }, actor);
    await emitInvoiceAuditEvent(req, res, {
      type: 'document.statement_line_removed',
      invoiceId: row.id,
      targetType: 'document',
      targetId: row.id,
      row,
      changes: {
        lineId: removedLine.id,
        invoiceNumber: removedLine.invoiceNumber,
        amount: removedLine.amount,
      },
      beforeState,
      afterState,
      undoable: false,
      summary: 'Statement line removed',
      severity: 'info',
    });

    const invoice = serializeStatementInvoice(updatedRow, req);
    return res.json({
      invoice,
      statementLines: invoice.statementLines,
      removedLine,
    });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/invoices/:id/statement-lines/:lineId');
  }
}

async function rematchStatementLines(req, res, options = {}) {
  try {
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { statusCode: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      if (row.classification !== 'statement') {
        return { statusCode: 400, body: { error: 'Statement lines only exist on statement documents' } };
      }

      const existingLines = parseStatementLines(row.statement_lines);
      if (existingLines.length === 0) {
        return { statusCode: 400, body: { error: 'Statement has no lines to re-check' } };
      }
      if (!hasVendorScope(row.vendor_code)) {
        return {
          statusCode: 422,
          body: {
            error: 'Statement vendor is required before re-matching lines',
            code: 'STATEMENT_VENDOR_REQUIRED',
          },
        };
      }

      const lookups = options.lookups || buildStatementLineLookups(row.id);
      const rematchedLines = [];
      const statusChanges = [];
      for (const line of existingLines) {
        const next = await rematchLine(line, row.vendor_code.trim(), lookups);
        if (next.status !== line.status) {
          statusChanges.push({ lineId: line.id, invoiceNumber: line.invoiceNumber, status: [line.status, next.status] });
        }
        rematchedLines.push(next);
      }

      const beforeState = { statement_lines: existingLines };
      const afterState = { statement_lines: rematchedLines };

      if (statusChanges.length > 0) {
        await db.query(
          `UPDATE documents
           SET statement_lines = $1::jsonb,
               updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(rematchedLines), row.id]
        );
      }
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [row.id]);
      return { row, updatedRow: updated.rows[0], beforeState, afterState, statusChanges };
    });

    if (outcome.body) return failFromBody(res, outcome.statusCode, outcome.body);

    const { row, updatedRow, beforeState, afterState, statusChanges } = outcome;

    if (statusChanges.length > 0) {
      const actor = getRequestAuditActor(req, res).name || 'system';
      await audit(row.id, 'statement-lines-rematched', { changes: statusChanges }, actor);
      await emitInvoiceAuditEvent(req, res, {
        type: 'document.statement_lines_rematched',
        invoiceId: row.id,
        targetType: 'document',
        targetId: row.id,
        row,
        changes: { statusChanges },
        beforeState,
        afterState,
        undoable: false,
        summary: `Statement lines re-checked (${statusChanges.length} status change${statusChanges.length === 1 ? '' : 's'})`,
        severity: 'info',
      });
    }

    const invoice = serializeStatementInvoice(updatedRow, req);
    return res.json({
      invoice,
      statementLines: invoice.statementLines,
      statusChanges,
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/statement-lines/rematch');
  }
}

/**
 * Internal (non-HTTP) rematch used by other services — e.g. after vendor
 * assignment on a statement. Returns { statusChanges, statementLines } or
 * null when the doc is missing / not a statement / has no lines.
 */
async function rematchStatementLinesForDocument(documentId, options = {}) {
  return withTransaction(pool, async (db) => {
    const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (row.classification !== 'statement') return null;

    const existingLines = parseStatementLines(row.statement_lines);
    if (existingLines.length === 0) return null;
    if (!hasVendorScope(row.vendor_code)) return null;

    const lookups = options.lookups || buildStatementLineLookups(row.id);
    const rematchedLines = [];
    const statusChanges = [];
    for (const line of existingLines) {
      const next = await rematchLine(line, row.vendor_code.trim(), lookups);
      if (next.status !== line.status) {
        statusChanges.push({ lineId: line.id, invoiceNumber: line.invoiceNumber, status: [line.status, next.status] });
      }
      rematchedLines.push(next);
    }

    if (statusChanges.length > 0) {
      await db.query(
        `UPDATE documents
         SET statement_lines = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(rematchedLines), row.id]
      );
    }
    return { statusChanges, statementLines: rematchedLines };
  });
}

module.exports = {
  addStatementLine,
  updateStatementLine,
  deleteStatementLine,
  rematchStatementLines,
  rematchStatementLinesForDocument,
  resolveStatementLine,
  unresolveStatementLine,
  buildManualLineId,
  buildStatementLineLookups,
  parseStatementLines,
};
