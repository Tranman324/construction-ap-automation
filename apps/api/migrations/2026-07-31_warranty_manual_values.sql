BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS warranty_manual_values JSONB;

COMMIT;
