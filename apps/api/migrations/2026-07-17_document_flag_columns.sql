BEGIN;

-- Server-side "needs attention" flag for a document, distinct from the existing
-- ingestion `flagged` boolean (manual-split marker). Flag state is defined as
-- `flagged_at IS NOT NULL`; there is no separate boolean for this flag. Records
-- who raised the flag and an optional free-text reason so reviewers (e.g.
-- Dana) can triage flagged items. Additive-only; never applied by workers.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS flagged_by TEXT;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;

COMMIT;
