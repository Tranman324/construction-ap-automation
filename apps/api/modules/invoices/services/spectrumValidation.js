'use strict';
/**
 * Pre-flight validator for Spectrum AP Invoice Multi-Line submissions.
 *
 * Why this exists:
 *   Spectrum's Vendor Invoice Multi-Line endpoint silently returns an empty
 *   array (or partial success) when payloads are malformed. Field name
 *   mismatches, missing required fields, wrong types, and stale references
 *   all look like "empty response" to the caller. We've been burned by this
 *   before (Image_File vs Image, the field-name-casing bug that lost months
 *   of Feb/March debugging). This module catches the obvious issues BEFORE
 *   the POST so a bad payload never hits Spectrum in the first place.
 *
 * Strategy:
 *   - Hard-fail on structural problems (missing required fields, wrong types)
 *   - Hard-fail on references that don't exist in the cached Spectrum data
 *     (vendor code not in vendors.json, GL account not in gl_accounts.json,
 *     routing code not in routing_codes.json, phase code not in
 *     phase_codes.json when a job is present)
 *   - Return a { ok, errors, warnings } object — the submit handler decides
 *     how to surface it. All-or-nothing: if ANY invoice in the batch fails
 *     validation, the whole batch is refused so partial submits don't happen.
 *
 * This is NOT a business-rule validator. Approval paths, over-budget checks,
 * multi-phase allocation, and routing assignment still live in invoices.js.
 * This module only catches schema / reference errors.
 */

const fs = require('fs');
const path = require('path');

const {
  VENDORS_PATH,
  JOBS_PATH,
  GL_ACCOUNTS_PATH,
  PHASE_CODES_PATH,
  ROUTING_CODES_PATH,
} = require('../../../config');

// ─── Reference data loaders (cached, lazy) ─────────────────────────────────
// JSON files are refreshed nightly by refresh-spectrum.sh. We load once per
// request, not once per boot, so a refresh mid-request is picked up on the
// next submit. File reads are ~5ms each and submits are rare events.

function safeReadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Trim utility — Spectrum's REST API returns fixed-width padded strings
// (e.g., "    RRCA01", "25-554    "). The database stores trimmed versions,
// and we want membership tests to work both ways.
function trim(v) {
  return typeof v === 'string' ? v.trim() : v;
}

function loadReferenceData() {
  const vendorsRaw = safeReadJSON(VENDORS_PATH) || [];
  const vendors = new Set(
    (Array.isArray(vendorsRaw) ? vendorsRaw : vendorsRaw.Vendors || [])
      .map((v) => trim(v.Vendor_Code))
      .filter(Boolean)
  );

  const jobsRaw = safeReadJSON(JOBS_PATH) || [];
  const jobs = new Set(
    (Array.isArray(jobsRaw) ? jobsRaw : jobsRaw.Jobs || [])
      .map((j) => trim(j.Job_Number))
      .filter(Boolean)
  );

  const glRaw = safeReadJSON(GL_ACCOUNTS_PATH) || [];
  const glAccounts = new Set(
    (Array.isArray(glRaw) ? glRaw : glRaw.gl_accounts || [])
      .map((g) => trim(g.GL_Account))
      .filter(Boolean)
  );

  const phaseRaw = safeReadJSON(PHASE_CODES_PATH) || {};
  const phaseArr = phaseRaw.phase_codes || phaseRaw;
  const phaseCodes = new Set(
    (Array.isArray(phaseArr) ? phaseArr : [])
      .map((p) => trim(p.phase_code))
      .filter(Boolean)
  );

  const routingRaw = safeReadJSON(ROUTING_CODES_PATH) || {};
  const routingArr = routingRaw.routing_codes || routingRaw;
  const routingCodes = new Set(
    (Array.isArray(routingArr) ? routingArr : [])
      .map((r) => trim(r.code))
      .filter(Boolean)
  );
  // 'D' is the AP Default routing code and MUST always be valid even if
  // the SQL refresh hasn't populated it yet.
  routingCodes.add('D');

  return { vendors, jobs, glAccounts, phaseCodes, routingCodes };
}

// ─── Type helpers ──────────────────────────────────────────────────────────
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isMMDDYYYY(v) {
  // Spectrum wants MM/DD/YYYY. formatDate() in services/utils.js produces
  // this format; if it didn't fire (missing date) we get an empty string.
  return isNonEmptyString(v) && /^\d{2}\/\d{2}\/\d{4}$/.test(v);
}

function roundToCents(n) {
  return Math.round(n * 100) / 100;
}

// ─── Single invoice validator ──────────────────────────────────────────────
/**
 * Validate one APInvoice payload object in-place (mutates nothing).
 * Returns an array of error strings; empty array = valid.
 *
 * @param {object} inv  - The APInvoice object as built by the submit handler
 * @param {number} idx  - 1-indexed position in the batch (for error messages)
 * @param {object} ref  - Reference data from loadReferenceData()
 */
function validateInvoice(inv, idx, ref) {
  const errors = [];
  const prefix = `Invoice #${idx}`;

  // ─── Required structural fields ───────────────────────────────────────
  if (inv.Company_Code !== 'NCG') {
    errors.push(`${prefix}: Company_Code must be "NCG" (got: ${inv.Company_Code || 'missing'})`);
  }
  if (!isNonEmptyString(inv.Vendor_Code)) {
    errors.push(`${prefix}: Vendor_Code is required`);
  }
  if (!isNonEmptyString(inv.Invoice_Number)) {
    errors.push(`${prefix}: Invoice_Number is required`);
  }
  if (!isMMDDYYYY(inv.Invoice_Date)) {
    errors.push(`${prefix}: Invoice_Date must be in MM/DD/YYYY format (got: "${inv.Invoice_Date || ''}")`);
  }
  if (!isMMDDYYYY(inv.GL_Date)) {
    errors.push(`${prefix}: GL_Date must be in MM/DD/YYYY format (got: "${inv.GL_Date || ''}")`);
  }
  if (!isFiniteNumber(inv.Invoice_Amount) || inv.Invoice_Amount <= 0) {
    errors.push(`${prefix}: Invoice_Amount must be a positive number (got: ${inv.Invoice_Amount})`);
  }
  if (inv.Approval_Status !== 'A' && inv.Approval_Status !== 'U') {
    errors.push(`${prefix}: Approval_Status must be "A" or "U" (got: ${inv.Approval_Status || 'missing'})`);
  }
  if (!isNonEmptyString(inv.Routing_Code)) {
    errors.push(`${prefix}: Routing_Code is required`);
  }
  if (!isNonEmptyString(inv.Batch_Code)) {
    errors.push(`${prefix}: Batch_Code is required`);
  }

  // ─── Reference integrity ──────────────────────────────────────────────
  // Trim on the lookup side so we match regardless of stray whitespace.
  const trimmedVendor = inv.Vendor_Code ? String(inv.Vendor_Code).trim() : null;
  const trimmedRouting = inv.Routing_Code ? String(inv.Routing_Code).trim() : null;
  if (trimmedVendor && !ref.vendors.has(trimmedVendor)) {
    errors.push(
      `${prefix}: Vendor_Code "${trimmedVendor}" does not exist in Spectrum vendor cache`
    );
  }
  if (trimmedRouting && !ref.routingCodes.has(trimmedRouting)) {
    errors.push(
      `${prefix}: Routing_Code "${trimmedRouting}" does not exist in Spectrum routing cache`
    );
  }

  // ─── Details array ────────────────────────────────────────────────────
  if (!Array.isArray(inv.APInvoiceDetails) || inv.APInvoiceDetails.length === 0) {
    errors.push(`${prefix}: APInvoiceDetails must be a non-empty array`);
    return errors;
  }

  let detailSum = 0;
  inv.APInvoiceDetails.forEach((d, di) => {
    const dPrefix = `${prefix} detail[${di + 1}]`;

    // Distribution / GL
    if (!d.Distribution || !isNonEmptyString(d.Distribution.GL_Account)) {
      errors.push(`${dPrefix}: Distribution.GL_Account is required`);
    } else {
      const gl = String(d.Distribution.GL_Account).trim();
      if (!ref.glAccounts.has(gl)) {
        errors.push(
          `${dPrefix}: GL_Account "${gl}" does not exist in Spectrum GL cache`
        );
      }
    }

    // Amount
    if (!isFiniteNumber(d.Amount) || d.Amount <= 0) {
      errors.push(`${dPrefix}: Amount must be a positive number (got: ${d.Amount})`);
    } else {
      detailSum += d.Amount;
    }

    // Job (optional — SG&A invoices have no job)
    if (d.Job) {
      if (!isNonEmptyString(d.Job.Job_Number)) {
        errors.push(`${dPrefix}: Job.Job_Number is required when Job is present`);
      } else {
        const jobNum = String(d.Job.Job_Number).trim();
        if (!ref.jobs.has(jobNum)) {
          errors.push(
            `${dPrefix}: Job_Number "${jobNum}" does not exist in Spectrum job cache`
          );
        }
      }
      if (!isNonEmptyString(d.Job.Phase_Code)) {
        errors.push(`${dPrefix}: Job.Phase_Code is required when Job is present`);
      } else {
        const phaseNum = String(d.Job.Phase_Code).trim();
        if (!ref.phaseCodes.has(phaseNum)) {
          errors.push(
            `${dPrefix}: Phase_Code "${phaseNum}" does not exist in Spectrum phase code cache`
          );
        }
      }
      if (!isNonEmptyString(d.Job.Cost_Type)) {
        errors.push(`${dPrefix}: Job.Cost_Type is required when Job is present`);
      } else if (!/^[SMLOEB]$/.test(String(d.Job.Cost_Type).trim())) {
        errors.push(
          `${dPrefix}: Job.Cost_Type must be one of S/M/L/O/E/B (got: ${d.Job.Cost_Type})`
        );
      }
    }
  });

  // Detail sum must match header amount to the cent.
  if (isFiniteNumber(inv.Invoice_Amount) && detailSum > 0) {
    const sumRounded = roundToCents(detailSum);
    const headerRounded = roundToCents(inv.Invoice_Amount);
    if (Math.abs(sumRounded - headerRounded) > 0.01) {
      errors.push(
        `${prefix}: Sum of detail Amounts ($${sumRounded.toFixed(2)}) does not match Invoice_Amount ($${headerRounded.toFixed(2)})`
      );
    }
  }

  // ─── Images (if present, field names must be exact) ──────────────────
  if (inv.Images !== undefined) {
    if (!Array.isArray(inv.Images)) {
      errors.push(`${prefix}: Images must be an array when present`);
    } else {
      inv.Images.forEach((img, ii) => {
        const iPrefix = `${prefix} Images[${ii + 1}]`;
        if (!isNonEmptyString(img.Image_File)) {
          errors.push(
            `${iPrefix}: Image_File (base64) is required. ` +
            `This field name is case-sensitive — Spectrum silently ignores "Image"/"File".`
          );
        }
        if (!isNonEmptyString(img.Image_Type)) {
          errors.push(`${iPrefix}: Image_Type is required (e.g., "PDF")`);
        }
      });
    }
  }

  return errors;
}

// ─── Batch validator ────────────────────────────────────────────────────
/**
 * Validate the complete APInvoices batch payload.
 * @param {object} payload  - { APInvoices: [...] }
 * @returns {{ ok: boolean, errors: string[] }}
 *
 * Philosophy: ALL-OR-NOTHING. If any invoice in the batch fails, the whole
 * batch is refused. Spectrum accepts partial batches, but mixing good and
 * bad invoices makes it impossible to reconcile submit_error state cleanly.
 * The frontend already shows per-invoice validation — bad invoices should
 * never reach the submit handler, and if they do, we fail fast.
 */
function validatePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Payload must be an object'] };
  }
  if (!Array.isArray(payload.APInvoices)) {
    return { ok: false, errors: ['APInvoices must be an array'] };
  }
  if (payload.APInvoices.length === 0) {
    return { ok: false, errors: ['APInvoices array is empty'] };
  }

  const ref = loadReferenceData();

  // If reference data is missing entirely, refuse rather than let everything
  // past with no validation. This shouldn't happen in production.
  if (ref.vendors.size === 0) {
    return {
      ok: false,
      errors: [
        'Spectrum vendor cache is empty or unreadable — cannot validate. ' +
          'Run `bash scripts/refresh-spectrum.sh` and try again.',
      ],
    };
  }

  payload.APInvoices.forEach((inv, i) => {
    const invErrors = validateInvoice(inv, i + 1, ref);
    errors.push(...invErrors);
  });

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validatePayload,
  // Exported for unit tests
  validateInvoice,
  loadReferenceData,
};
