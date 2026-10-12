CREATE TABLE IF NOT EXISTS vendor_contacts (
  vendor_code TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'observed',
  last_seen_at TIMESTAMPTZ,
  added_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vendor_code, email)
);

COMMENT ON COLUMN vendor_contacts.source IS 'observed (backfilled/seen as sender), confirmed_send (waiver actually sent here), manual (typed in by a user)';
