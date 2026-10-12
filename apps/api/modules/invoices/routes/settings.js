'use strict';
/**
 * /api/settings routes
 * /api/routing-codes, /api/phase-codes, /api/gl-accounts
 * /api/classifications
 */

const express = require('express');
const router = express.Router();
const {
  createCustomClassification,
  createRetentionSetting,
  deleteCustomClassification,
  deleteRetentionSetting,
  getClassificationOverride,
  getDocumentById,
  listRetentionSettings,
  loadClassificationRows,
  updateCustomClassification,
  updateRetentionSetting,
  upsertBuiltInClassificationOverride,
} = require('../services/settingsService');
const { getGlAccounts } = require('../services/spectrum');
const { ensureApDefaultRoutingCode } = require('../services/routingCatalogService');
const { readJSON } = require('../services/utils');
const { ROUTING_CODES_PATH, PHASE_CODES_PATH } = require('../../../config');
const { getApprovalSchema } = require('../services/approvalValidator');
const { validate } = require('../../../middleware/validate');
const {
  classificationSchema,
  classificationsQuerySchema,
  glAccountsQuerySchema,
  paginationQuerySchema,
  resourceIdParamsSchema,
  retentionSettingSchema,
  retentionUpdateSchema,
} = require('../../../lib/schemas');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { getPagination } = require('../../../lib/pagination');
const { emitPlatformAuditEvent } = require('../../../lib/auditEvents');
const {
  RULE_ACTIONS,
  RULE_FIELDS,
  RULE_OPERATORS,
  RULE_STATUSES,
  COST_TYPE_OPTIONS,
} = require('../../../lib/ruleCatalog');

// ─── Classifications ──────────────────────────────────────────────────────────

const BUILT_IN_CLASSIFICATIONS = [
  { name: 'invoice',         label: 'Invoice',                    action: 'extract-match', builtIn: true, opensAs: 'invoice',      status: 'active' },
  { name: 'receipt',         label: 'Receipt',                    action: 'extract-match', builtIn: true, opensAs: 'receipt',      status: 'active' },
  { name: 'pay-application', label: 'Pay Application',            action: 'extract-match', builtIn: true, opensAs: 'invoice',      status: 'active' },
  { name: 'statement',       label: 'Statement',                  action: 'view-only',     builtIn: true, opensAs: 'statement',    status: 'active' },
  { name: 'coi',             label: 'Certificate of Insurance',   action: 'view-only',     builtIn: true, opensAs: 'coi',          status: 'active' },
  { name: 'w9',              label: 'W-9 Tax Form',               action: 'view-only',     builtIn: true, opensAs: 'w9',           status: 'active' },
  { name: 'lien-waiver',     label: 'Lien Waiver',                action: 'view-only',     builtIn: true, opensAs: 'lien-waiver',  status: 'active' },
  { name: 'purchase-order',  label: 'Purchase Order',             action: 'extract-match', builtIn: true, opensAs: 'invoice',      status: 'active' },
  { name: 'credit-memo',     label: 'Credit Memo / Adjustment',   action: 'extract-match', builtIn: true, opensAs: 'invoice',      status: 'active' },
  { name: 'building-permit',  label: 'Building Permit',             action: 'view-only',     builtIn: true, opensAs: 'other',        status: 'active' },
  { name: 'other',           label: 'Other / Unclassified',       action: 'view-only',     builtIn: true, opensAs: 'other',        status: 'active' },
];

const AVAILABLE_ASSOCIATIONS = [
  { key: 'invoice',      label: 'Invoice Workflow',               description: 'Full approval workflow with routing, matching, and Spectrum submission' },
  { key: 'receipt',      label: 'Receipt Panel',                  description: 'Receipt document viewer with job code tagging' },
  { key: 'statement',    label: 'Statement Panel',                description: 'Statement document viewer' },
  { key: 'coi',          label: 'Certificate of Insurance Panel', description: 'COI viewer with expiration tracking' },
  { key: 'w9',           label: 'W-9 Panel',                      description: 'W-9 tax form viewer' },
  { key: 'lien-waiver',  label: 'Lien Waiver Panel',              description: 'Lien waiver viewer with type selection' },
  { key: 'other',        label: 'Generic Panel',                  description: 'Fallback document viewer' },
];

const VALID_OPENS_AS = AVAILABLE_ASSOCIATIONS.map(a => a.key);

// Names that would cause the classifier to misfire
const BLOCKED_TYPE_NAMES = ['document', 'file', 'page', 'attachment', 'email', 'pdf', 'image', 'text', 'unknown'];

function stableCacheValue(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableCacheValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCacheValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cachedSortValue(item, key) {
  const value = typeof item === 'object' && item !== null ? item[key] : item;
  return String(value ?? '').trim().toLowerCase();
}

function stableCachedSlice(items, offset, limit, keys) {
  return [...items]
    .sort((left, right) => {
      for (const key of keys) {
        const leftValue = cachedSortValue(left, key);
        const rightValue = cachedSortValue(right, key);
        if (leftValue === rightValue) continue;
        return leftValue < rightValue ? -1 : 1;
      }
      const leftTie = stableCacheValue(left);
      const rightTie = stableCacheValue(right);
      if (leftTie === rightTie) return 0;
      return leftTie < rightTie ? -1 : 1;
    })
    .slice(offset, offset + limit);
}

// Additive panel/filter metadata derived from `opensAs` so the frontend can
// route documents and build dashboard filter pills from the API instead of the
// hardcoded documentRouting.ts / DashboardPanelFilters.tsx tables. Complete for
// EVERY classification (built-in AND custom) — `opensAs` always resolves (custom
// rows default to 'other'), so `surface`/`filterGroup` are never null.
//   surface:     invoice -> invoice_workflow; other -> generic_panel; else document_panel
//   filterGroup: the dashboard panel group the classification's documents appear under (= opensAs)
function classificationPanelMetadata(opensAs) {
  const filterGroup = opensAs || 'other';
  const surface = filterGroup === 'invoice'
    ? 'invoice_workflow'
    : (filterGroup === 'other' ? 'generic_panel' : 'document_panel');
  return { surface, filterGroup };
}

// Shared merge helper — deduplicates built-in overrides stored in custom_classifications
async function getMergedClassifications(pagination) {
  const builtInNames = BUILT_IN_CLASSIFICATIONS.map((classification) => classification.name);
  const overrideMap = new Map();
  const customList = [];
  const { overrides, customRows } = await loadClassificationRows({ builtInNames, pagination });
  for (const row of overrides) overrideMap.set(row.name, row);

  for (const row of customRows) {
    const isOverride = BUILT_IN_CLASSIFICATIONS.some((classification) => classification.name === row.name);
    if (isOverride) {
      overrideMap.set(row.name, row);
      continue;
    }
    customList.push({
      name: row.name, label: row.label, action: row.action, builtIn: false,
      opensAs: row.opens_as || 'other', status: row.status || 'active',
      addedAt: row.added_at?.toISOString(),
      updatedAt: row.updated_at?.toISOString() || undefined,
      updatedBy: row.updated_by || undefined,
    });
  }
  const visibleBuiltIns = pagination
    ? BUILT_IN_CLASSIFICATIONS.slice(pagination.offset, pagination.offset + pagination.limit)
    : BUILT_IN_CLASSIFICATIONS;
  const builtIns = visibleBuiltIns.map(c => {
    const override = overrideMap.get(c.name);
    if (override && override.opens_as) {
      return { ...c, opensAs: override.opens_as, updatedAt: override.updated_at?.toISOString(), updatedBy: override.updated_by };
    }
    return c;
  });
  // Additive-only: append `panel` metadata to every classification; all existing
  // fields keep their values and order.
  return [...builtIns, ...customList].map((classification) => ({
    ...classification,
    panel: classificationPanelMetadata(classification.opensAs),
  }));
}

async function getActiveClassificationNames() {
  const classifications = await getMergedClassifications();
  return new Set(
    classifications
      .filter((classification) => classification.status === 'active')
      .map((classification) => classification.name)
  );
}

router.get('/classifications', requirePermission('accounting.invoices.view'), validate(classificationsQuerySchema, 'query'), async (req, res) => {
  try {
    const classifications = await getMergedClassifications(getPagination(req.query));

    if (req.query.include === 'associations') {
      return res.json({ classifications, availableAssociations: AVAILABLE_ASSOCIATIONS });
    }
    res.json(classifications);
  } catch (err) {
    return safeError(res, err, 'GET /api/classifications');
  }
});

router.post('/classifications', requirePermission('accounting.invoices.manage_classifications'), validate(classificationSchema), async (req, res) => {
  try {
    const { name, label, action = 'view-only', opensAs = 'other' } = req.body;
    if (!name || !label) return fail(res, 400, 'name and label required');

    const kebab = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!kebab || kebab.length > 50) {
      return fail(res, 400, 'name must be 1-50 characters, kebab-case');
    }
    if (BLOCKED_TYPE_NAMES.includes(kebab)) {
      return fail(res, 400, `"${kebab}" is a blocked type name — too generic for the classifier`);
    }
    if (BUILT_IN_CLASSIFICATIONS.some(c => c.name === kebab)) {
      return fail(res, 409, 'Built-in classification already exists');
    }
    if (!VALID_OPENS_AS.includes(opensAs)) {
      return fail(res, 400, `opensAs must be one of: ${VALID_OPENS_AS.join(', ')}`);
    }

    const r = await createCustomClassification({ name: kebab, label, action, opensAs, actor: req.user?.email || 'dashboard' });
    res.status(201).json({
      name: r.name, label: r.label, action: r.action, builtIn: false,
      opensAs: r.opens_as, status: r.status,
      addedAt: r.added_at?.toISOString(),
      updatedAt: r.updated_at?.toISOString(),
      updatedBy: r.updated_by,
    });
  } catch (err) {
    if (err.code === '23505') return fail(res, 409, 'Custom classification already exists');
    return safeError(res, err, 'POST /api/classifications');
  }
});

router.put('/classifications', requirePermission('accounting.invoices.manage_classifications'), async (req, res) => {
  try {
    const { updates } = req.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      return fail(res, 400, 'updates array required');
    }

    const actor = req.user?.email || 'dashboard';
    let updatedCount = 0;

    for (const upd of updates) {
      if (!upd.name) continue;

      const builtInEntry = BUILT_IN_CLASSIFICATIONS.find(c => c.name === upd.name);
      const isBuiltIn = !!builtInEntry;

      if (isBuiltIn) {
        // Built-in types: only opensAs can be changed (not label, status, action)
        // Hard guard: 'invoice' classification cannot be remapped away from Invoice Workflow
        if (upd.name === 'invoice') {
          return fail(res, 400, 'The "invoice" type cannot be remapped — it must use Invoice Workflow');
        }
        if (upd.status !== undefined || upd.label !== undefined) {
          return fail(res, 400, `Built-in type "${upd.name}": only opensAs can be changed`);
        }
        if (upd.opensAs === undefined) continue; // nothing to do
        if (!VALID_OPENS_AS.includes(upd.opensAs)) {
          return fail(res, 400, `opensAs must be one of: ${VALID_OPENS_AS.join(', ')}`);
        }

        // Upsert override into custom_classifications
        const beforeOverride = await getClassificationOverride(upd.name);
        const beforeOpensAs = beforeOverride ? beforeOverride.opens_as : builtInEntry.opensAs;
        await upsertBuiltInClassificationOverride({ name: upd.name, label: builtInEntry.label, action: builtInEntry.action, opensAs: upd.opensAs, status: builtInEntry.status, actor });
        updatedCount++;

        // Audit event
        await emitPlatformAuditEvent(req, res, {
          id: `ae-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          actor: { name: actor, role: 'admin' },
          module: 'settings',
          type: 'classification.mapping_updated',
          targetType: 'classification',
          targetId: upd.name,
          targetLabel: builtInEntry.label,
          changes: { opensAs: upd.opensAs },
          beforeState: { opensAs: beforeOpensAs },
          afterState: { opensAs: upd.opensAs },
          summary: `Remapped built-in "${upd.name}" from ${beforeOpensAs} to ${upd.opensAs}`,
        });
        continue;
      }

      // Custom type — validate allowed fields
      const changes = {};

      if (upd.opensAs !== undefined) {
        if (!VALID_OPENS_AS.includes(upd.opensAs)) {
          return fail(res, 400, `opensAs must be one of: ${VALID_OPENS_AS.join(', ')}`);
        }
        changes.opensAs = upd.opensAs;
      }
      if (upd.status !== undefined) {
        if (!['active', 'disabled'].includes(upd.status)) {
          return fail(res, 400, 'status must be "active" or "disabled"');
        }
        changes.status = upd.status;
      }
      if (upd.label !== undefined) {
        if (!upd.label || upd.label.length > 100) {
          return fail(res, 400, 'label must be 1-100 characters');
        }
        changes.label = upd.label;
      }

      if (!Object.keys(changes).length) continue;
      const changed = await updateCustomClassification(upd.name, changes, actor);
      if (!changed) {
        return fail(res, 404, `Classification "${upd.name}" not found`);
      }
      if (changed.row) {
        updatedCount++;
        // Write audit event
        const beforeState = { opensAs: changed.before.opens_as, status: changed.before.status, label: changed.before.label };
        const afterState = {};
        if (upd.opensAs !== undefined) afterState.opensAs = upd.opensAs;
        if (upd.status !== undefined) afterState.status = upd.status;
        if (upd.label !== undefined) afterState.label = upd.label;
        const changedFields = Object.keys(afterState);
        await emitPlatformAuditEvent(req, res, {
          id: `ae-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          actor: { name: actor, role: 'admin' },
          module: 'settings',
          type: 'classification.mapping_updated',
          targetType: 'classification',
          targetId: upd.name,
          targetLabel: upd.label || changed.before.label,
          changes: afterState,
          beforeState,
          afterState,
          summary: `Updated ${changedFields.join(', ')} for classification "${upd.name}"`,
        });
      }
    }

    // Return full updated list (using merge helper to avoid duplicate built-in rows)
    const classifications = await getMergedClassifications();

    res.json({ updated: updatedCount, classifications });
  } catch (err) {
    return safeError(res, err, 'PUT /api/classifications');
  }
});

router.delete('/classifications/:name', requirePermission('accounting.invoices.manage_classifications'), async (req, res) => {
  try {
    const { name } = req.params;

    if (BUILT_IN_CLASSIFICATIONS.some(c => c.name === name)) {
      return fail(res, 403, 'Cannot delete built-in classifications');
    }

    const deleted = await deleteCustomClassification(name);
    if (deleted.kind === 'missing') {
      return fail(res, 404, 'Classification not found');
    }

    if (deleted.kind === 'in_use') {
      return fail(res, 409, 'Cannot delete type with existing documents. Reclassify them first.');
    }

    res.json({ deleted: name });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/classifications/:name');
  }
});

// ─── Routing codes ────────────────────────────────────────────────────────────

function handleRoutingCodes(req, res) {
  try {
    const data = readJSON(ROUTING_CODES_PATH, null);
    if (!data) return fail(res, 404, 'Routing codes not yet synced — run a Spectrum refresh first');
    const { limit, offset } = getPagination(req.query);
    if (data.routing_codes) {
      return res.json({
        ...data,
        routing_codes: stableCachedSlice(ensureApDefaultRoutingCode(data.routing_codes), offset, limit, ['code', 'Code', 'routing_code'])
          .map((routingCode) => ({ ...routingCode, label: routingCode.code })),
      });
    }
    res.json(Array.isArray(data) ? stableCachedSlice(data, offset, limit, ['code', 'Code', 'routing_code']) : data);
  } catch (err) {
    return safeError(res, err, 'GET /api/routing-codes');
  }
}

router.get('/routing-codes', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), handleRoutingCodes);
router.get('/backend/routing-codes', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), handleRoutingCodes);

// ─── Phase codes ──────────────────────────────────────────────────────────────

function handlePhaseCodes(req, res) {
  try {
    const data = readJSON(PHASE_CODES_PATH, null);
    if (!data) return fail(res, 404, 'Phase codes not yet synced — run a Spectrum refresh first');
    const { limit, offset } = getPagination(req.query);
    if (data.phase_codes) {
      return res.json({
        ...data,
        phase_codes: stableCachedSlice(data.phase_codes, offset, limit, ['phase_code', 'Phase_Code', 'code']),
      });
    }
    res.json(Array.isArray(data) ? stableCachedSlice(data, offset, limit, ['phase_code', 'Phase_Code', 'code']) : data);
  } catch (err) {
    return safeError(res, err, 'GET /api/phase-codes');
  }
}

router.get('/phase-codes', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), handlePhaseCodes);
router.get('/backend/phase-codes', requirePermission('accounting.invoices.view_details'), validate(paginationQuerySchema, 'query'), handlePhaseCodes);

// ─── GL accounts ──────────────────────────────────────────────────────────────

async function handleGlAccounts(req, res) {
  try {
    const { type, search, costType } = req.query;
    const { limit, offset } = getPagination(req.query);
    const accounts = await getGlAccounts({ type, search, costType, limit, offset });
    res.json(accounts);
  } catch (err) {
    return safeError(res, err, 'GET /api/gl-accounts');
  }
}

router.get('/gl-accounts', requirePermission('accounting.invoices.view_details'), validate(glAccountsQuerySchema, 'query'), handleGlAccounts);
router.get('/backend/gl-accounts', requirePermission('accounting.invoices.view_details'), validate(glAccountsQuerySchema, 'query'), handleGlAccounts);

// Spectrum cost-type reference catalog (code/label option list), alongside the
// GL-accounts family. Option lists only — cost-type default derivation is owned
// elsewhere. Value-identical to the frontend COST_TYPE_LABELS at introduction.
router.get('/cost-types', requirePermission('accounting.invoices.view_details'), (req, res) => {
  return res.json({ costTypes: COST_TYPE_OPTIONS });
});

// ─── Rule-builder catalogs ────────────────────────────────────────────────────

// Composite catalog for the rule builder. The action/field/operator sets are the
// SAME definitions rule validation uses (lib/ruleCatalog.js → lib/schemas.js), so
// serving and validation cannot drift.
router.get('/rule-options', requirePermission('accounting.invoices.view_details'), (req, res) => {
  return res.json({
    actions: RULE_ACTIONS,
    fields: RULE_FIELDS,
    operators: RULE_OPERATORS,
    statuses: RULE_STATUSES,
  });
});

// ─── Retention settings ───────────────────────────────────────────────────────

/**
 * Compute a human-readable description for a retention rule.
 */
function describeRule(r) {
  const classLabel = r.classification === '*' ? 'All classifications' : `Classification: ${r.classification}`;
  const actions = [];
  if (r.delete_pdf) actions.push('PDFs deleted');
  if (r.delete_box) actions.push('Box copies removed');
  const actionStr = actions.length ? actions.join(', ') : 'no files deleted';
  return `${classLabel} — status: ${r.status} — after ${r.retention_days} days: ${actionStr}`;
}

/** GET /api/settings/retention */
router.get('/retention', requirePermission('accounting.invoices.manage_settings'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);
    const rows = (await listRetentionSettings({ limit, offset })).map(r => ({ ...r, appliesTo: describeRule(r) }));
    res.json(rows);
  } catch (err) {
    return safeError(res, err, 'GET /api/retention');
  }
});

/** PUT /api/settings/retention/:id */
router.put('/retention/:id', requirePermission('accounting.invoices.manage_settings'), validate(retentionUpdateSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { retention_days, delete_pdf, delete_box } = req.body;

    const r = await updateRetentionSetting(id, { retention_days, delete_pdf, delete_box }, req.user?.email || 'dashboard');
    if (r?.kind === 'empty') return fail(res, 400, 'No fields to update');
    if (!r) return fail(res, 404, 'Retention rule not found');
    res.json({ ...r, appliesTo: describeRule(r) });
  } catch (err) {
    return safeError(res, err, 'PUT /api/retention/:id');
  }
});

/** POST /api/settings/retention */
router.post('/retention', requirePermission('accounting.invoices.manage_settings'), validate(retentionSettingSchema), async (req, res) => {
  try {
    const { classification, status, retention_days = 30, delete_pdf = true, delete_box = true } = req.body;

    if (!classification || !status) return fail(res, 400, 'classification and status are required');

    const r = await createRetentionSetting({ classification, status, retentionDays: retention_days, deletePdf: delete_pdf, deleteBox: delete_box, actor: req.user?.email || 'dashboard' });
    res.status(201).json({ ...r, appliesTo: describeRule(r) });
  } catch (err) {
    if (err.code === '23505') return fail(res, 409, 'A rule for this classification+status already exists');
    return safeError(res, err, 'POST /api/retention');
  }
});

/** DELETE /api/settings/retention/:id */
router.delete('/retention/:id', requirePermission('accounting.invoices.manage_settings'), async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await deleteRetentionSetting(id);
    if (deleted.kind === 'missing') return fail(res, 404, 'Retention rule not found');
    if (deleted.kind === 'wildcard') {
      return fail(res, 403, 'Cannot delete wildcard default rules (classification = *)');
    }

    res.json({ success: true, deleted: id });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/retention/:id');
  }
});

// ─── Approval Schema + Validate ──────────────────────────────────────────────────

/** GET /api/approval-schema — returns the shared validation rules JSON.
 *  Frontend fetches this once on app load to drive client-side validation
 *  using the same rules the backend enforces. */
router.get('/approval-schema', requirePermission('accounting.invoices.view'), (req, res) => {
  res.json(getApprovalSchema());
});

/** GET /api/invoices/:id/validate-approval — the complete server-authoritative
 *  approval/coding verdict for a document, composed from the single-source
 *  backend services (see approvalStateService). Returns { path, requiredFields,
 *  blockers, unbilledBalance, asOf, codingDefaults, suggestedRoutingCode,
 *  suggestedRoutingPm } so the client needs no derivation of its own. */
router.get('/validate-approval/:id', requirePermission('accounting.invoices.view_details'), validate(resourceIdParamsSchema, 'params'), async (req, res) => {
  try {
    const row = await getDocumentById(req.params.id);
    if (!row) {
      return fail(res, 404, 'Invoice not found');
    }
    const { buildApprovalState } = require('../services/approvalStateService');
    // Preview matches enforcement: the verdict includes the live duplicate
    // blocker exactly as approve/bulk-approve would evaluate it (spec 2.5).
    const { evaluateDuplicateStatus } = require('../services/duplicateStatusService');
    const duplicateStatus = await evaluateDuplicateStatus(row);
    return res.json(buildApprovalState(row, { invoiceId: req.params.id, log: req.log, duplicateStatus }));
  } catch (err) {
    return safeError(res, err, 'GET /api/validate-approval/:id');
  }
});

module.exports = router;
module.exports.BUILT_IN_CLASSIFICATIONS = BUILT_IN_CLASSIFICATIONS;
module.exports.getActiveClassificationNames = getActiveClassificationNames;
module.exports.getMergedClassifications = getMergedClassifications;
module.exports.handleRoutingCodes = handleRoutingCodes;
module.exports.stableCachedSlice = stableCachedSlice;
