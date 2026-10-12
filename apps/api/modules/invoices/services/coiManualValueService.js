'use strict';

const { emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { errorBody } = require('../../../lib/response');
const { safeError } = require('../../../middleware/errorResponse');
const { pool } = require('./supabase');
const { withTransaction } = require('./transaction');
const { evaluateCoiCompliance } = require('./coiComplianceService');
const { getEffectiveCoiConfig } = require('./coiConfigService');
const fs = require('node:fs');
const { VENDORS_PATH } = require('../../../config');

function outcome(status, message, code) { return { status, body: errorBody(message, code) }; }
function parse(value) { if (!value || typeof value === 'object') return value || {}; try { return JSON.parse(value); } catch { return {}; } }
function configId(updatedAt) { return `legacy-singleton:${updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt || 'unversioned')}`; }
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function safeReadJSON(filePath) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; } }

function lookupVendorName(vendorCode) {
  const raw = safeReadJSON(process.env.VENDORS_PATH || VENDORS_PATH);
  const vendors = Array.isArray(raw) ? raw : raw?.Vendors;
  if (!Array.isArray(vendors)) return null;
  const entry = vendors.find((vendor) => String(vendor?.Vendor_Code || '').trim() === vendorCode);
  return entry ? (String(entry.Name || '').trim() || null) : null;
}

async function validateVendor(req, vendorCode) {
  if (vendorCode === null) return null;
  const lookup = req.vendorMasterLookup || req.app?.locals?.vendorMasterLookup;
  if (typeof lookup === 'function') { try { return (await lookup(vendorCode)) ? null : { unknown: true }; } catch { return { unavailable: true }; } }
  const raw = safeReadJSON(process.env.VENDORS_PATH || VENDORS_PATH);
  const vendors = Array.isArray(raw) ? raw : raw?.Vendors;
  if (!Array.isArray(vendors)) return { unavailable: true };
  return vendors.some((vendor) => String(vendor?.Vendor_Code || '').trim() === String(vendorCode).trim()) ? null : { unknown: true };
}

async function updateCoiManualValues(req, res) {
  try {
    const body = req.body || {}; const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => key !== 'vendorCode' && key !== 'expirationDate')) return res.status(422).json(errorBody('Provide vendorCode and/or expirationDate only', 'INVALID_MANUAL_VALUES'));
    if ('vendorCode' in body && body.vendorCode !== null && typeof body.vendorCode !== 'string') return res.status(422).json(errorBody('Vendor code must be a string or null', 'INVALID_MANUAL_VALUES'));
    if ('expirationDate' in body && body.expirationDate !== null && !validDate(body.expirationDate)) return res.status(422).json(errorBody('Expiration date must be YYYY-MM-DD', 'INVALID_EXPIRATION_DATE'));
    const result = await withTransaction(pool, async (db) => {
      const found = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!found.rows[0]) return outcome(404, 'Invoice not found', 'INVOICE_NOT_FOUND');
      const document = found.rows[0];
      if (document.classification !== 'coi') return outcome(409, 'Document is not classified as coi', 'CLASSIFICATION_MISMATCH');
      const vendorFailure = 'vendorCode' in body && body.vendorCode !== null ? await validateVendor(req, body.vendorCode) : null;
      if (vendorFailure?.unavailable) return outcome(503, 'Vendor master is unavailable', 'VENDOR_MASTER_UNAVAILABLE');
      if (vendorFailure?.unknown) return outcome(422, 'Vendor code was not found', 'UNKNOWN_VENDOR_CODE');
      const actor = getRequestAuditActor(req, res); const manual = parse(document.coi_manual_values); const before = { ...manual };
      for (const key of keys) { if (body[key] === null) delete manual[key]; else manual[key] = { value: body[key], setBy: actor.name, setAt: new Date().toISOString() }; }
      // Keep the queue-facing vendor fields in sync with the manual selection
      // (the document list renders matching.vendor, not coi_manual_values).
      const sets = ['coi_manual_values = $2']; const params = [document.id, manual];
      if ('vendorCode' in body) {
        const code = body.vendorCode === null ? null : String(body.vendorCode).trim();
        const name = code ? lookupVendorName(code) : null;
        let i = params.length + 1;
        sets.push(`vendor_code = $${i++}`); params.push(code);
        sets.push(`matched_vendor_name = $${i++}`); params.push(name);
        sets.push(`vendor_match_confidence = $${i++}`); params.push(code ? 1 : null);
        sets.push(`vendor_match_method = $${i++}`); params.push(code ? 'manual' : null);
      }
      const updated = await db.query(`UPDATE documents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
      await emitInvoiceAuditEvent(req, res, { client: db, type: 'document.coi_manual_values_updated', invoiceId: document.id, row: updated.rows[0], changes: { coiManualValues: [before, manual] }, beforeState: { coiManualValues: before }, afterState: { coiManualValues: manual }, summary: 'COI manual values updated' });
      const config = await getEffectiveCoiConfig(db, req.coiNow instanceof Date ? req.coiNow : new Date());
      const overrides = await db.query('SELECT * FROM coi_overrides WHERE document_id = $1 AND revoked_at IS NULL ORDER BY approved_at ASC, id ASC', [document.id]);
      const row = updated.rows[0]; return { status: 200, body: { manualValues: manual, compliance: evaluateCoiCompliance(row, { config: config?.config || {}, configVersionId: config?.id || 'legacy-singleton:unversioned', now: req.coiNow instanceof Date ? req.coiNow : new Date(), overrides: overrides.rows }) } };
    });
    return res.status(result.status).json(result.body);
  } catch (error) { return safeError(res, error, 'PATCH /api/invoices/:id/coi-manual-values'); }
}
module.exports = { updateCoiManualValues, validateVendor };
