-- BE-A (Invoices UI Refresh spec T5): 'needs-review' is retired as a STATUS.
-- Review state lives in flagged_at / flagged_by / flag_reason (additive
-- columns from 2026-07-17_document_flag_columns.sql) and coexists with any
-- lifecycle status.
--
-- Census (2026-09-04, prod): ZERO documents rows carry status
-- 'needs_review' or 'needs-review' — the value was vestigial (one reader in
-- rematch.js, no writers). This migration is defensive/idempotent: if any
-- such row ever exists, it becomes a review-flagged pending row instead of
-- silently disappearing from every list filter.
--
-- NOTE: the documents.needs_review BOOLEAN column is UNRELATED (it is the
-- matcher's confidence marker) and is deliberately untouched here.

BEGIN;

UPDATE documents
SET flagged_at = COALESCE(flagged_at, NOW()),
    flagged_by = COALESCE(flagged_by, 'migration:retire-needs-review'),
    flag_reason = COALESCE(flag_reason, 'Migrated from retired needs-review status'),
    status = 'pending',
    updated_at = NOW()
WHERE status IN ('needs_review', 'needs-review')
  AND deleted_at IS NULL;

COMMIT;
