-- Dedicated permission for sending lien waiver request emails to vendors.
-- Granted to admin role. Non-admin accounting users can be granted individually.

INSERT INTO permissions (key, module, description, created_at)
VALUES (
  'accounting.invoices.request_waiver',
  'invoices',
  'Send lien waiver request emails to vendors via Graph reply-on-thread',
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key, granted)
SELECT roles.id, 'accounting.invoices.request_waiver', TRUE
FROM roles
WHERE roles.name = 'admin'
ON CONFLICT (role_id, permission_key) DO UPDATE
SET granted = EXCLUDED.granted;
