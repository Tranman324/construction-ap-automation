'use strict';

const { randomUUID } = require('node:crypto');

const { emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { errorBody } = require('../../../lib/response');
const { safeError } = require('../../../middleware/errorResponse');
const { pool } = require('./supabase');
const { withTransaction } = require('./transaction');
const { evaluateCoiCompliance } = require('./coiComplianceService');
const { getEffectiveCoiConfig } = require('./coiConfigService');

function normalizeJson(value) {
  if (!value || typeof value === 'object') return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

function legacyConfigId(updatedAt) {
  const value = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt || 'unversioned');
  return `legacy-singleton:${value}`;
}


function overrideRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    checkId: row.check_id,
    originalStatus: row.original_status,
    reason: row.reason || null,
    configVersionId: row.config_version_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at,
    revokedBy: row.revoked_by || null,
    revokedAt: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at || null,
  };
}

function outcome(status, message, code) {
  return { status, body: errorBody(message, code) };
}

async function activeOverrides(db, documentId) {
  const result = await db.query(
    'SELECT * FROM coi_overrides WHERE document_id = $1 AND revoked_at IS NULL ORDER BY approved_at ASC, id ASC',
    [documentId]
  );
  return result.rows.map(overrideRow);
}

async function applyCoiOverride(req, res) {
  try {
    const result = await withTransaction(pool, async (db) => {
      const docResult = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!docResult.rows[0]) return outcome(404, 'Invoice not found', 'INVOICE_NOT_FOUND');
      const document = docResult.rows[0];
      if (document.classification !== 'coi') return outcome(409, 'Document is not classified as coi', 'CLASSIFICATION_MISMATCH');
      const effective = await getEffectiveCoiConfig(db, req.coiNow instanceof Date ? req.coiNow : new Date());
      const config = effective?.config || {};
      const evaluation = evaluateCoiCompliance(document, { config, configVersionId: effective?.id || 'legacy-singleton:unversioned', now: req.coiNow instanceof Date ? req.coiNow : new Date(), overrides: [] });
      const originalStatus = evaluation.checks.find((check) => check.id === req.body.checkId)?.rawStatus;
      if (!originalStatus) return outcome(422, 'Unknown COI compliance check', 'UNKNOWN_COI_CHECK');
      if (originalStatus === 'pass') return outcome(422, 'COI override is not required for a passing check', 'OVERRIDE_NOT_REQUIRED');
      const reason = req.body.reason?.trim() || null;
      if (originalStatus === 'fail' && !reason) return outcome(422, 'A reason is required to override a failing COI check', 'OVERRIDE_REASON_REQUIRED');
      const existing = await db.query('SELECT id FROM coi_overrides WHERE document_id = $1 AND check_id = $2 AND revoked_at IS NULL FOR UPDATE', [document.id, req.body.checkId]);
      if (existing.rows.length) return outcome(409, 'An active COI override already exists for this check', 'ACTIVE_OVERRIDE_EXISTS');
      const actor = getRequestAuditActor(req, res);
      const inserted = await db.query(
        `INSERT INTO coi_overrides (id, document_id, check_id, original_status, reason, config_version_id, approved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [randomUUID(), document.id, req.body.checkId, originalStatus, reason, effective?.id || 'legacy-singleton:unversioned', actor.name]
      );
      const override = overrideRow(inserted.rows[0]);
      await emitInvoiceAuditEvent(req, res, {
        client: db,
        type: 'document.coi_override_applied',
        invoiceId: document.id,
        row: document,
        changes: { checkId: [null, override.checkId] },
        beforeState: { activeOverride: null },
        afterState: { activeOverride: override },
        summary: `COI override applied for ${override.checkId}`,
      });
      const active = await activeOverrides(db, document.id);
      return { status: 200, body: { override, activeOverrides: active, compliance: evaluateCoiCompliance(document, { config, configVersionId: effective?.id || 'legacy-singleton:unversioned', now: req.coiNow instanceof Date ? req.coiNow : new Date(), overrides: active }) } };
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json(errorBody('An active COI override already exists for this check', 'ACTIVE_OVERRIDE_EXISTS'));
    return safeError(res, err, 'POST /api/invoices/:id/coi-overrides');
  }
}

async function revokeCoiOverride(req, res) {
  try {
    const result = await withTransaction(pool, async (db) => {
      const docResult = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!docResult.rows[0]) return outcome(404, 'Invoice not found', 'INVOICE_NOT_FOUND');
      const document = docResult.rows[0];
      if (document.classification !== 'coi') return outcome(409, 'Document is not classified as coi', 'CLASSIFICATION_MISMATCH');
      const actor = getRequestAuditActor(req, res);
      const revoked = await db.query(
        `UPDATE coi_overrides SET revoked_at = NOW(), revoked_by = $3
         WHERE document_id = $1 AND check_id = $2 AND revoked_at IS NULL
         RETURNING *`,
        [document.id, req.params.checkId, actor.name]
      );
      if (!revoked.rows[0]) return outcome(404, 'No active COI override exists for this check', 'ACTIVE_OVERRIDE_NOT_FOUND');
      const revokedOverride = overrideRow(revoked.rows[0]);
      await emitInvoiceAuditEvent(req, res, {
        client: db,
        type: 'document.coi_override_revoked',
        invoiceId: document.id,
        row: document,
        changes: { checkId: [revokedOverride.checkId, null] },
        beforeState: { activeOverride: { ...revokedOverride, revokedAt: null, revokedBy: null } },
        afterState: { activeOverride: revokedOverride },
        summary: `COI override revoked for ${revokedOverride.checkId}`,
      });
      const effective = await getEffectiveCoiConfig(db, req.coiNow instanceof Date ? req.coiNow : new Date());
      const active = await activeOverrides(db, document.id);
      return { status: 200, body: { revokedOverride, activeOverrides: active, compliance: evaluateCoiCompliance(document, { config: effective?.config || {}, configVersionId: effective?.id || 'legacy-singleton:unversioned', now: req.coiNow instanceof Date ? req.coiNow : new Date(), overrides: active }) } };
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return safeError(res, err, 'DELETE /api/invoices/:id/coi-overrides/:checkId');
  }
}

async function getActiveCoiOverrides(documentId, db = pool) {
  return activeOverrides(db, documentId);
}

module.exports = { applyCoiOverride, getActiveCoiOverrides, revokeCoiOverride };
