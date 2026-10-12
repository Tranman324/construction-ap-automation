BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS doc_title TEXT;

COMMENT ON COLUMN documents.doc_title IS 'Document-visible title or heading extracted during ingestion for filing and display.';

COMMIT;
