-- Shared Activity read cutoff and server-arrival defaults.
-- Rollback: DROP INDEX IF EXISTS idx_document_email_unread_inbound;
-- ALTER TABLE document_email_messages ALTER COLUMN created_at SET DEFAULT now();
-- ALTER TABLE document_comments ALTER COLUMN created_at SET DEFAULT now();
-- ALTER TABLE documents DROP COLUMN activity_viewed_at;
BEGIN;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS activity_viewed_at TIMESTAMPTZ;
ALTER TABLE document_comments ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE document_email_messages ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS idx_document_email_unread_inbound
  ON document_email_messages(document_id, created_at, id)
  WHERE direction = 'in' AND kind = 'inbound' AND read_at IS NULL;
COMMIT;
