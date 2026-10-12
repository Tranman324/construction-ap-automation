BEGIN;

CREATE TABLE IF NOT EXISTS coi_overrides (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  original_status TEXT NOT NULL,
  reason TEXT,
  config_version_id TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS coi_overrides_one_active_check
  ON coi_overrides (document_id, check_id)
  WHERE revoked_at IS NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS coi_manual_values JSONB;

INSERT INTO permissions (key, module, description, created_at)
VALUES
  ('accounting.invoices.coi_override', 'accounting', 'Apply and revoke COI compliance overrides', NOW()),
  ('accounting.invoices.manage_settings', 'accounting', 'Manage invoice compliance settings', NOW())
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key, granted)
VALUES
  ('6ae067e6-6b6c-44f1-8765-9b745e21e7e5', 'accounting.invoices.coi_override', TRUE),
  ('0782c7ec-4f29-4f0b-8a19-277ab6aa4b86', 'accounting.invoices.coi_override', TRUE)
ON CONFLICT (role_id, permission_key) DO UPDATE
SET granted = EXCLUDED.granted;

UPDATE toolbox_users
SET role_version = role_version + 1
WHERE role_id IN (
  '6ae067e6-6b6c-44f1-8765-9b745e21e7e5',
  '0782c7ec-4f29-4f0b-8a19-277ab6aa4b86'
);

COMMIT;
