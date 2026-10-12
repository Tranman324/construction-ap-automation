BEGIN;

-- Track when/who sent a lien waiver request email to the vendor.
-- Separate from waiver_on_document (override toggle) — this records the
-- outbound email request via Graph API reply-on-thread.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS waiver_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiver_requested_by TEXT;

COMMIT;
