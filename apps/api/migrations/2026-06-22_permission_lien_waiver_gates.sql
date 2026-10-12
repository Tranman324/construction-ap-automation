-- Permission gates for feature-request management and irreversible invoice deletion.
-- Live schema confirmed on 2026-06-22:
-- permissions(key, module, description, created_at)
-- roles(id, name, description, is_system, created_at, updated_at)
-- role_permissions(role_id, permission_key, granted)

INSERT INTO permissions (key, module, description, created_at)
VALUES
  (
    'feature_requests.manage',
    'feature_requests',
    'Manage feature request status and deletion',
    NOW()
  ),
  (
    'invoices.permanent_delete',
    'invoices',
    'Permanently delete invoice records',
    NOW()
  )
ON CONFLICT (key) DO UPDATE
SET
  module = EXCLUDED.module,
  description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key, granted)
SELECT roles.id, permission_keys.permission_key, TRUE
FROM roles
CROSS JOIN (
  VALUES
    ('feature_requests.manage'),
    ('invoices.permanent_delete')
) AS permission_keys(permission_key)
WHERE roles.name = 'admin'
ON CONFLICT (role_id, permission_key) DO UPDATE
SET granted = EXCLUDED.granted;
