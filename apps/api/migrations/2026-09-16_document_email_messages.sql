BEGIN;
-- Outbox and inbound correlation. Rollback: migrations/rollback/2026-09-16_document_email_messages.sql
CREATE TABLE IF NOT EXISTS document_email_messages (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  kind TEXT NOT NULL CHECK (kind IN ('reply','forward','inbound','ndr')),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','ambiguous')),
  internet_message_id TEXT,
  graph_message_id TEXT,
  conversation_id TEXT,
  from_address TEXT,
  to_json JSONB NOT NULL DEFAULT '[]',
  subject TEXT,
  body_preview TEXT CHECK (char_length(body_preview) <= 200),
  sanitized_body_html TEXT CHECK (direction = 'in' OR sanitized_body_html IS NULL),
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  verified_participant BOOLEAN,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  actor_user_id TEXT,
  send_token UUID,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_started_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (direction <> 'out' OR (actor_user_id IS NOT NULL AND send_token IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS document_email_internet_idx ON document_email_messages(internet_message_id);
CREATE INDEX IF NOT EXISTS document_email_conversation_idx ON document_email_messages(conversation_id);
CREATE INDEX IF NOT EXISTS document_email_document_idx ON document_email_messages(document_id, created_at, id);
CREATE INDEX IF NOT EXISTS document_email_actor_attempt_idx ON document_email_messages(actor_user_id, attempted_at);
CREATE INDEX IF NOT EXISTS document_email_actor_token_idx ON document_email_messages(actor_user_id, send_token);
ALTER TABLE document_email_messages ENABLE ROW LEVEL SECURITY;
-- API server owns writes; no browser-role policies are granted.
COMMIT;
