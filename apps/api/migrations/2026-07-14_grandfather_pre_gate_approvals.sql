BEGIN;

-- Grandfather clause (the product owner, 2026-07-14): invoices approved BEFORE the lien
-- waiver gate went live are exempted via the existing waiver-on-document
-- override so they are not retroactively blocked from Spectrum submission.
-- The gate applies in full to everything approved after this migration.
--
-- Uses the override field (not lien_waiver_required = false) because:
--   1. The detection trigger would recompute lien_waiver_required on the
--      next edit, silently re-blocking the invoice.
--   2. The override is the sanctioned gate-satisfier and is visible in the
--      UI and audit metadata ("waiver_on_document_by" shows the reason).

UPDATE documents
SET waiver_on_document = true,
    waiver_on_document_at = NOW(),
    waiver_on_document_by = 'grandfathered-pre-gate-2026-07-14',
    updated_at = NOW()
WHERE classification IN ('invoice', 'pay-application')
  AND status = 'approved'
  AND lien_waiver_required = true
  AND linked_lien_waiver_id IS NULL
  AND waiver_on_document IS NOT TRUE;

COMMIT;
