-- Duplicate-workflow bypass (DUPLICATE-WORKFLOW-SPEC section 2.3, ratified 2026-09-08).
-- Mirrors the waiver-bypass pattern: detection output (duplicate_of) is never
-- cleared by a human decision; the bypass lives in its own columns and the
-- effective flag is (has duplicate signal AND NOT duplicate_bypassed).
-- Additive and safe to re-run.
BEGIN;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS duplicate_bypassed boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS duplicate_bypassed_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS duplicate_bypassed_by text;

COMMIT;
