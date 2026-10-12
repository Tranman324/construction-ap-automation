-- Permission gate for invoice automation rules.
-- Uses the role-system tables confirmed for the 2026-06-22 permission migration:
-- permissions(key, module, description, created_at)
-- roles(id, name, description, is_system, created_at, updated_at)
-- role_permissions(role_id, permission_key, granted)

INSERT INTO permissions (key, module, description, created_at)
VALUES
  (
    'invoices.manage_rules',
    'invoices',
    'Manage and apply invoice automation rules',
    NOW()
  )
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key, granted)
SELECT roles.id, 'invoices.manage_rules', TRUE
FROM roles
WHERE roles.name = 'admin'
ON CONFLICT (role_id, permission_key) DO UPDATE
SET granted = EXCLUDED.granted;
