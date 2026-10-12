BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_email_message_id TEXT REFERENCES document_email_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_attachment_id TEXT;

CREATE TABLE IF NOT EXISTS document_inbound_promotions (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_email_message_id TEXT NOT NULL REFERENCES document_email_messages(id) ON DELETE CASCADE,
  source_attachment_id TEXT NOT NULL,
  resulting_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'completed')),
  actor_user_id TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (source_email_message_id, source_attachment_id)
);

CREATE INDEX IF NOT EXISTS document_inbound_promotions_result_idx
  ON document_inbound_promotions(resulting_document_id);

COMMIT;
