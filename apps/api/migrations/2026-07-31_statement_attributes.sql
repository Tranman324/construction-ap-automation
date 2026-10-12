BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS statement_attributes JSONB;

COMMENT ON COLUMN documents.statement_attributes IS 'Statement period and balance values grouped by manual, extracted, and computed source.';

COMMIT;
