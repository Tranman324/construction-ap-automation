/**
 * Rules Engine — evaluates rules against invoice documents
 * Pure logic, no DB calls. Called from server.js (apply) and pipeline.js (ingestion hook).
 */

'use strict';

const ALLOWED_PATCH_FIELDS = new Set([
  'status',
  'rejection_reason',
  'filed',
  'hidden',
  'vendor_code',
  'job_match_number',
  'classification',
  'assigned_to',
  'notes',
  'flagged',
  'phase_code',
  'gl_account',
  'cost_type',
  'routing_code',
]);

// ─── Criterion Matching ───────────────────────────────────────────────────────

function resolveField(doc, field) {
  switch (field) {
    case 'vendor_name':    return doc.vendor_name || null;
    case 'vendor_code':    return doc.vendor_code || null;
    case 'amount':         return doc.amount != null ? String(doc.amount) : null;
    case 'description':    return doc.description || null;
    case 'invoice_number': return doc.invoice_number || null;
    case 'job_number':     return doc.job_number || doc.job_match_number || null;
    case 'classification': return doc.classification || null;
    case 'status':         return doc.status || null;
    case 'email_from':     return doc.email_from || null;
    case 'email_subject':  return doc.email_subject || null;
    default:               return null;
  }
}

function matchOperator(fieldVal, operator, values) {
  // Handle null field
  if (fieldVal === null || fieldVal === undefined || fieldVal === '') {
    if (operator === 'is_empty') return true;
    return false;
  }
  if (operator === 'is_not_empty') return true;
  if (operator === 'is_empty') return false;

  const isNumeric = ['gt', 'lt', 'gte', 'lte', 'between'].includes(operator);
  const numVal = isNumeric ? parseFloat(fieldVal) : null;

  // Negative operators use AND (every) — match only if ALL values miss.
  // Positive operators use OR (some) — match if ANY value hits.
  // This matches the frontend helpers.ts logic (De Morgan's law).
  if (operator === 'not_contains') {
    return values.every(v => !fieldVal.toLowerCase().includes(v.toLowerCase()));
  }
  if (operator === 'not_equals') {
    return values.every(v => fieldVal.toLowerCase() !== v.toLowerCase());
  }

  // OR logic within values array for positive/numeric operators
  return values.some(v => {
    switch (operator) {
      case 'contains':     return fieldVal.toLowerCase().includes(v.toLowerCase());
      case 'equals':       return fieldVal.toLowerCase() === v.toLowerCase();
      case 'starts_with':  return fieldVal.toLowerCase().startsWith(v.toLowerCase());
      case 'ends_with':    return fieldVal.toLowerCase().endsWith(v.toLowerCase());
      case 'gt':           return !isNaN(numVal) && numVal > parseFloat(v);
      case 'lt':           return !isNaN(numVal) && numVal < parseFloat(v);
      case 'gte':          return !isNaN(numVal) && numVal >= parseFloat(v);
      case 'lte':          return !isNaN(numVal) && numVal <= parseFloat(v);
      default:             return false;
    }
  });
}

function matchesBetween(fieldVal, values) {
  if (fieldVal === null || fieldVal === undefined) return false;
  const num = parseFloat(fieldVal);
  if (isNaN(num) || values.length < 2) return false;
  return num >= parseFloat(values[0]) && num <= parseFloat(values[1]);
}

function criterionMatches(doc, criterion) {
  const { field, operator, values = [] } = criterion;
  const fieldVal = resolveField(doc, field);

  if (operator === 'between') return matchesBetween(fieldVal, values);
  if (operator === 'is_empty') return fieldVal === null || fieldVal === '' || fieldVal === undefined;
  if (operator === 'is_not_empty') return fieldVal !== null && fieldVal !== '' && fieldVal !== undefined;

  return matchOperator(fieldVal, operator, values);
}

function ruleMatches(doc, rule) {
  // AND logic between criteria rows
  return rule.criteria.every(criterion => criterionMatches(doc, criterion));
}

// ─── Action Application ───────────────────────────────────────────────────────

/**
 * Returns a list of DB update patches to apply to a document.
 * Does NOT touch the DB — caller handles persistence.
 */
function computePatches(doc, actions) {
  const patches = {};

  for (const action of actions) {
    switch (action.type) {
      case 'auto_approve':
        if (doc.status === 'pending') patches.status = 'approved';
        break;
      case 'auto_discard':
        patches.status = 'discarded';
        patches.rejection_reason = action.value || 'Auto-discarded by rule';
        break;
      case 'auto_file':
        patches.filed = true;
        break;
      case 'hide_from_queue':
        patches.hidden = true;
        break;
      case 'set_vendor':
        if (action.clear === true) patches.vendor_code = null;
        else if (action.value) patches.vendor_code = action.value;
        break;
      case 'set_job':
        if (action.clear === true) patches.job_match_number = null;
        else if (action.value) patches.job_match_number = action.value;
        break;
      case 'set_classification':
        // Dedicated link/unlink owns both sides of this relationship. A rule
        // may not silently turn either linked document into another type.
        if (action.value && (!doc.linked_lien_waiver_id || action.value === doc.classification)) {
          patches.classification = action.value;
        }
        break;
      case 'assign_reviewer':
        if (action.value) patches.assigned_to = action.value;
        break;
      case 'add_note':
        if (action.value) {
          const existing = doc.notes ? doc.notes + '\n' : '';
          patches.notes = existing + action.value;
        }
        break;
      case 'flag':
        patches.flagged = true;
        break;
      case 'set_phase_code':
        if (action.clear === true) patches.phase_code = null;
        else if (action.value) patches.phase_code = action.value;
        break;
      case 'set_gl_account':
        if (action.clear === true) patches.gl_account = null;
        else if (action.value) patches.gl_account = action.value;
        break;
      case 'set_cost_type':
        if (action.clear === true) patches.cost_type = null;
        else if (action.value) patches.cost_type = action.value;
        break;
      case 'set_routing_code':
        if (action.clear === true) patches.routing_code = null;
        else if (action.value) patches.routing_code = action.value;
        break;
    }
  }

  return patches;
}

function sanitizePatches(patches) {
  const sanitized = {};
  for (const [field, value] of Object.entries(patches || {})) {
    if (ALLOWED_PATCH_FIELDS.has(field)) {
      sanitized[field] = value;
    }
  }
  return sanitized;
}

function buildPatchUpdate(patches, startParamIndex = 2) {
  const safePatches = sanitizePatches(patches);
  const entries = Object.entries(safePatches);
  return {
    fields: entries.map(([field]) => field),
    values: entries.map(([, value]) => value),
    patches: safePatches,
    setClauses: entries
      .map(([field], index) => `${field} = $${startParamIndex + index}`)
      .join(', '),
  };
}

// ─── Evaluate Rules Against a Single Doc ─────────────────────────────────────

/**
 * Evaluate all rules against one document.
 * Returns { patches, matchedRules } — patches is the merged set of DB updates.
 */
function evaluateDoc(doc, rules) {
  const patches = {};
  const matchedRules = [];

  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (!ruleMatches(doc, rule)) continue;

    matchedRules.push(String(rule.id));
    const p = computePatches(doc, rule.actions);
    Object.assign(patches, p);

    if (rule.stop_on_match) break;
  }

  return { patches: sanitizePatches(patches), matchedRules };
}

// ─── Bulk Evaluate ────────────────────────────────────────────────────────────

/**
 * Evaluate rules against multiple docs.
 * Returns array of { docId, patches, matchedRules } — only docs with patches.
 */
function evaluateBatch(docs, rules) {
  const results = [];
  for (const doc of docs) {
    const { patches, matchedRules } = evaluateDoc(doc, rules);
    if (Object.keys(patches).length > 0) {
      results.push({ docId: doc.id, patches, matchedRules });
    }
  }
  return results;
}

module.exports = {
  ALLOWED_PATCH_FIELDS,
  buildPatchUpdate,
  computePatches,
  criterionMatches,
  evaluateBatch,
  evaluateDoc,
  ruleMatches,
  sanitizePatches,
};
