BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS sharepoint_item_id TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_filename TEXT,
  ADD COLUMN IF NOT EXISTS statement_lines JSONB,
  ADD COLUMN IF NOT EXISTS waiver_on_document BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_on_document_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiver_on_document_by TEXT;

COMMIT;
