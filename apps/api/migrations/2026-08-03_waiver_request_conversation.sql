BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS waiver_request_conversation_id TEXT;

COMMIT;
