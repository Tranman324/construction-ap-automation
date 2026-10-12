-- Add page_classifications JSONB column to documents table.
-- Stores the per-page classification array from the pipeline (e.g. ["invoice","lien-waiver"]).
-- Nullable — no backfill needed (only new documents will have this populated).
ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS page_classifications JSONB;
