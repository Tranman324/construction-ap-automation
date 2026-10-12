BEGIN;

DROP TABLE IF EXISTS document_inbound_promotions;

ALTER TABLE documents
  DROP COLUMN IF EXISTS source_attachment_id,
  DROP COLUMN IF EXISTS source_email_message_id,
  DROP COLUMN IF EXISTS source_document_id;

COMMIT;
