BEGIN;

-- Records HOW a lien waiver link was made so the UI can distinguish
-- "Auto-linked from email thread" from manual/suggestion links.
-- Values: 'email-thread' (automatic), 'manual', 'suggestion'.
-- Set on the invoice row; cleared on unlink.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS waiver_link_source TEXT;

COMMIT;
