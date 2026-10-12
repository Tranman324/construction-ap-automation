-- Trash-tab exposure for filtered attachments (follow-up to
-- 2026-08-05_attachment_junk_filter.sql — see docs/specs/invoices/ATTACHMENT-FILTERING.md).
--
-- documents.discard_source: why a row is in the Trash tab.
--   'manual'      — human discard (legacy NULL rows are treated as 'manual')
--   'auto-ai'     — layer-4 auto-discard of high-confidence 'other' images
--   'rule-filter' — name-pattern / dimension / size pre-filter skips
--   'junk-hash'   — sha256 junk-cache match
--
-- documents.sha256: content hash, populated only on filter-created trash rows
-- and layer-4 auto-discards; used to dedupe trash rows (first hit only) and to
-- un-junk the hash when a filtered doc is restored.

BEGIN;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS discard_source TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents (sha256) WHERE sha256 IS NOT NULL;

COMMIT;
