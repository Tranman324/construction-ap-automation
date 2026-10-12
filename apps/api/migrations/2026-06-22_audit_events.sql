-- Platform-wide audit events.
-- Frontend-compatible shape:
-- id, type, timestamp, actor, target, changes, summary, module, severity.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_label TEXT,
  changes JSONB,
  summary TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
  ON audit_events(timestamp DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_type
  ON audit_events(type);

CREATE INDEX IF NOT EXISTS idx_audit_events_module
  ON audit_events(module);

CREATE INDEX IF NOT EXISTS idx_audit_events_severity
  ON audit_events(severity);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON audit_events(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_target
  ON audit_events(target_type, target_id);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access ON audit_events;
CREATE POLICY service_role_full_access ON audit_events
  FOR ALL TO postgres, service_role
  USING (true) WITH CHECK (true);

COMMIT;
