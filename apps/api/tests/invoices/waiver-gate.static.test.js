'use strict';

/**
 * Static contract tests for the lien waiver gate backend (2026-07-14 scope).
 * Mirrors the style of submit-idempotency.static.test.js — asserts the
 * enforcement points exist in source so regressions fail loudly.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('waiver recipient routes use dedicated permission and pass the validated override', () => {
  const route = read('modules/invoices/routes/invoices.js');
  assert.match(route, /router\.get\('\/:id\/waiver-recipient', requirePermission\('accounting\.invoices\.request_waiver'\)/);
  assert.match(route, /router\.post\('\/:id\/request-waiver', requirePermission\('accounting\.invoices\.request_waiver'\)/);
  assert.match(route, /validate\(waiverRequestSchema\)/);
  assert.match(route, /resend: req\.body\?\.resend === true/);
  assert.match(route, /recipientOverride: req\.body\?\.recipientOverride \|\| null/);
});

test('waiver request service enforces double-send guard and strips subject prefixes', () => {
  const service = read('modules/invoices/services/waiverRequestService.js');
  const recipientService = read('modules/invoices/services/waiverRecipientService.js');
  assert.match(service, /doc\.waiver_requested_at && opts\.resend !== true/);
  assert.match(service, /statusCode = 409/);
  assert.match(service, /function baseSubject\(subject\)/);
  assert.match(service, /\((re|\|fw|\|fwd).*\)/i);
  assert.match(service, /— Lien Waiver Request/);
  // Only invoices and pay-applications
  assert.match(service, /\['invoice', 'pay-application'\]/);
  // Atomic recording: transaction around update + audit insert
  assert.match(service, /BEGIN/);
  assert.match(service, /INSERT INTO audit_log/);
  assert.match(service, /COMMIT/);
  // Structured audit event
  assert.match(service, /type: 'invoice\.waiver_requested'/);
  // Reply must preserve the quoted original chain: createReply draft →
  // prepend template above the quote → send (direct /reply with a body
  // override would drop the vendor's original email).
  assert.match(service, /createReply/);
  assert.match(service, /\$\{EMAIL_TEMPLATE\}\$\{buildBodyToken\(documentId\)\}\$\{quotedChain\}/);
  assert.match(service, /\/send/);
  assert.match(service, /toRecipients/);
  assert.match(service, /originalEmailFrom: doc\.email_from/);
  assert.match(service, /UPDATE vendor_mappings/);
  assert.match(service, /\[doc\.vendor_code, sentTo\]/);
  // Trust model (2026-07-15): recipient resolution checks the sender against
  // the vendor's known domains + cached email, and the send path enforces the
  // same trust gate server-side (not just the platform blocklist).
  assert.match(recipientService, /SELECT domain, vendor_email FROM vendor_mappings/);
  assert.match(recipientService, /checkSenderTrust/);
  assert.match(recipientService, /senderTrusted: trusted/);
  assert.match(service, /checkSenderTrust/);
  // W5 rescope (2026-08-26): the contacts DIRECTORY may feed the candidate
  // list, but recipient TRUST must never read it. checkSenderTrust's body and
  // the parsing/resolution module stay vendor_contacts-free; the directory is
  // only consulted after resolveRecipient, and the request-service send path
  // only WRITES to it (organic capture) inside the recording transaction.
  const trustFn = recipientService.match(/async function checkSenderTrust[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(trustFn.length > 0, 'checkSenderTrust body not found');
  assert.doesNotMatch(trustFn, /vendor[_]contacts/i);
  const parsing = read('modules/invoices/services/waiverRecipientParsing.js');
  assert.doesNotMatch(parsing, /vendor[_]contacts/i);
  // Directory reads happen only after resolution in the recipient service.
  const beforeResolution = recipientService.split('resolveRecipient({')[0];
  assert.doesNotMatch(beforeResolution, /listVendorContacts\(/);
  // Send path: no directory READS feed sentTo/trust; only the capture upsert.
  assert.doesNotMatch(service, /listVendorContacts/);
  assert.match(service, /upsertVendorContact/);
});

test('auto-link service only links unambiguous conversation-thread matches transactionally', () => {
  const service = read('modules/invoices/services/waiverAutoLinkService.js');
  // Exactly-one eligibility check
  assert.match(service, /invoicesResult\.rows\.length !== 1/);
  // Row locks + transaction
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /BEGIN/);
  assert.match(service, /COMMIT/);
  assert.match(service, /ROLLBACK/);
  // Eligibility criteria
  assert.match(service, /lien_waiver_required = true/);
  assert.match(service, /linked_lien_waiver_id IS NULL/);
  assert.match(service, /\(email_conversation_id = \$1 OR waiver_request_conversation_id = \$1\)/);
  // Multi-waiver bundle safeguard
  assert.match(service, /waiverPageCount > 2/);
  // Link source markers for UI label (tier 1 thread match + tier 2 subject-vendor fallback)
  assert.match(service, /email-thread/);
  assert.match(service, /request-thread/);
  assert.match(service, /subject-vendor/);
});

test('pipeline calls auto-link after inserting a lien-waiver document', () => {
  const pipeline = read('modules/invoices/services/pipeline.js');
  assert.match(pipeline, /queueEntry\.classification === 'lien-waiver'/);
  assert.match(pipeline, /autoLinkWaiver/);
});

test('link service records source and unlink clears it', () => {
  const service = read('modules/invoices/services/lienWaiverLinkService.js');
  assert.match(service, /waiver_link_source = \$2/);
  assert.match(service, /waiver_link_source = NULL/);
});

test('approved invoices are frozen for waiver changes (F3)', () => {
  const service = read('modules/invoices/services/lienWaiverLinkService.js');
  const merge = read('modules/invoices/services/pdfMergeService.js');
  // Link block-list includes approved
  assert.match(service, /\['approved', 'submitted', 'submitting', 'split-processing', 'discarded'\]\.includes\(invoice\.status\)/);
  // Unlink blocks approved
  assert.match(service, /invoice\.status === 'approved'/);
  // Dead link-to-approved merge branch deleted
  assert.doesNotMatch(service, /mergeWaiverPdfForInvoice/);
  // Publisher re-checks the reciprocal link before writing merged_file_path
  assert.match(merge, /UPDATE documents SET merged_file_path = \$1, updated_at = \$2 WHERE id = \$3 AND linked_lien_waiver_id = \$4/);
  assert.match(merge, /rowCount === 0/);
});

test('bypass is approve-gated, changes only requirement, and remains the exact inverse of both submit gates', () => {
  const routes = read('modules/invoices/routes/invoices.js');
  const status = read('modules/invoices/services/invoiceStatusService.js');
  const submitState = read('modules/invoices/services/submitState.js');
  const submitWorkflow = read('modules/invoices/services/submitWorkflow.js');
  const approvalValidator = read('modules/invoices/services/approvalValidator.js');

  assert.match(routes, /router\.post\('\/:id\/waiver-bypass', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(routes, /router\.post\('\/:id\/waiver-bypass\/revert', requirePermission\('accounting\.invoices\.approve'\)/);
  // Persistent bypass (2026-08-06): the bypass writes its OWN columns and never
  // touches lien_waiver_required, which stays a pure detection-trigger output.
  assert.match(status, /SET waiver_bypassed = true,[\s\S]*waiver_bypassed_at = NOW\(\),[\s\S]*waiver_bypassed_by = \$1,[\s\S]*updated_at = NOW\(\)/);
  assert.match(status, /SET waiver_bypassed = false,[\s\S]*waiver_bypassed_at = NULL,[\s\S]*waiver_bypassed_by = NULL,[\s\S]*updated_at = NOW\(\)/);
  const bypassSection = status.match(/async function setLienWaiverBypass[\s\S]*?async function revertLienWaiverBypass/)?.[0] || '';
  assert.doesNotMatch(bypassSection, /SET[\s\S]*lien_waiver_status/);
  assert.doesNotMatch(bypassSection, /SET lien_waiver_required/);
  assert.match(status, /type: 'document\.waiver_bypass_set'/);
  assert.match(status, /type: 'document\.waiver_bypass_reverted'/);
  assert.match(submitState, /lien_waiver_required IS NOT TRUE[\s\S]*waiver_bypassed IS TRUE[\s\S]*linked_lien_waiver_id IS NOT NULL[\s\S]*lien_waiver_status IS NOT DISTINCT FROM 'attached'[\s\S]*waiver_on_document IS TRUE/);
  assert.match(submitWorkflow, /lien_waiver_required IS NOT TRUE[\s\S]*waiver_bypassed IS TRUE[\s\S]*linked_lien_waiver_id IS NOT NULL[\s\S]*lien_waiver_status IS NOT DISTINCT FROM 'attached'[\s\S]*waiver_on_document IS TRUE/);
  assert.match(approvalValidator, /Boolean\(row\.lien_waiver_required\)[\s\S]*row\.waiver_bypassed !== true[\s\S]*!row\.linked_lien_waiver_id[\s\S]*row\.lien_waiver_status !== 'attached'[\s\S]*!row\.waiver_on_document/);
});

test('persistent bypass migration adds columns and backfills from audit history', () => {
  const migration = read('migrations/2026-08-06_waiver_bypass_persistent.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS waiver_bypassed BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS waiver_bypassed_at TIMESTAMPTZ/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS waiver_bypassed_by TEXT/);
  // Backfill: latest bypass audit event wins, only ever sets true
  assert.match(migration, /DISTINCT ON \(document_id\)/);
  assert.match(migration, /'waiver-bypass-set', 'waiver-bypass-reverted'/);
  assert.match(migration, /a\.action = 'waiver-bypass-set'/);
  assert.doesNotMatch(migration, /SET waiver_bypassed = false/);
});

test('detection migration computes lien_waiver_required with exempt phases and backfills', () => {
  const migration = read('migrations/2026-07-14_waiver_requirement_detection.sql');
  assert.match(migration, /CREATE OR REPLACE FUNCTION compute_lien_waiver_required/);
  assert.match(migration, /CREATE TRIGGER trg_lien_waiver_detection/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF cost_type, job_match_number, phase_code, classification/);
  assert.match(migration, /= 'S'/);
  for (const phase of ['01502', '01503', '01812', '01850', '01900']) {
    assert.match(migration, new RegExp(phase));
  }
  // Backfill present
  assert.match(migration, /UPDATE documents\s+SET lien_waiver_required =/);
});

test('grandfather migration exempts pre-gate approvals via the override field', () => {
  const migration = read('migrations/2026-07-14_grandfather_pre_gate_approvals.sql');
  assert.match(migration, /waiver_on_document = true/);
  assert.match(migration, /grandfathered-pre-gate-2026-07-14/);
  assert.match(migration, /status = 'approved'/);
});

test('response mapping exposes waiver fields to the frontend', () => {
  const supabase = read('modules/invoices/services/supabase.js');
  assert.match(supabase, /waiverType: r\.waiver_type \|\| null/);
  assert.match(supabase, /waiverRequestedAt: r\.waiver_requested_at/);
  assert.match(supabase, /waiverRequestedBy: r\.waiver_requested_by \|\| null/);
  assert.match(supabase, /waiverLinkSource: r\.waiver_link_source \|\| null/);
  // Effective requirement + persistent bypass exposure (2026-08-06)
  assert.match(supabase, /lienWaiverRequired: \(r\.lien_waiver_required === true\) && r\.waiver_bypassed !== true/);
  assert.match(supabase, /waiverBypassed: r\.waiver_bypassed === true/);
  assert.match(supabase, /waiverBypassedAt: r\.waiver_bypassed_at/);
  assert.match(supabase, /waiverBypassedBy: r\.waiver_bypassed_by \|\| null/);

  const collection = read('modules/invoices/services/invoiceCollectionService.js');
  assert.match(collection, /waiver_type, waiver_requested_at, waiver_requested_by, waiver_link_source/);
  assert.match(collection, /lien_waiver_required, waiver_bypassed, waiver_bypassed_at, waiver_bypassed_by/);

  const schemas = read('lib/schemas.js');
  assert.match(schemas, /waiverType: stringOrNull\(100\)\.optional\(\)/);
});
