-- Attachment junk filtering: content-hash junk cache + persistent skip log.
-- junk_attachments: content hashes of known-junk email attachments (signature
--   images, logos, footers); the pipeline skips matches before classification.
-- attachment_skip_log: audit trail of every attachment skipped without
--   queuing a document (all filter layers).
-- See docs/specs/invoices/ATTACHMENT-FILTERING.md for the full design.

BEGIN;

CREATE TABLE IF NOT EXISTS junk_attachments (
  sha256           TEXT PRIMARY KEY,
  file_name        TEXT,
  file_size_bytes  INTEGER,
  reason           TEXT,
  source           TEXT,          -- 'manual-discard' | 'auto-other' | 'seed'
  hit_count        INTEGER DEFAULT 0,
  last_hit_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachment_skip_log (
  id               BIGSERIAL PRIMARY KEY,
  file_name        TEXT,
  file_size_bytes  INTEGER,
  sha256           TEXT,
  reason           TEXT,
  email_from       TEXT,
  email_subject    TEXT,
  email_message_id TEXT,
  skipped_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachment_skip_log_skipped_at ON attachment_skip_log (skipped_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachment_skip_log_sha256 ON attachment_skip_log (sha256);

COMMIT;
