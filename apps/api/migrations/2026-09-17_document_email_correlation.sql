-- Additive inbound correlation state for deployments where the historical
-- document email table migration has already been applied.
BEGIN;

ALTER TABLE document_email_messages
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS correlation_state TEXT NOT NULL DEFAULT 'matched',
  ADD COLUMN IF NOT EXISTS correlation_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS document_email_inbound_internet_uidx
  ON document_email_messages(internet_message_id)
  WHERE direction = 'in' AND internet_message_id IS NOT NULL;

COMMIT;
