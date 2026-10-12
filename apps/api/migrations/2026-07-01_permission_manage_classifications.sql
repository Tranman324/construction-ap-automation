-- Add manage_classifications permission for classification write routes (POST/PUT/DELETE).
-- GET /api/classifications remains open to any authenticated user.

INSERT INTO permissions (key, module, description, created_at)
VALUES ('accounting.invoices.manage_classifications', 'accounting', 'Create, update, and delete document classification types', NOW())
ON CONFLICT (key) DO NOTHING;

-- Grant to admin role
INSERT INTO role_permissions (role_id, permission_key, granted)
SELECT roles.id, 'accounting.invoices.manage_classifications', TRUE
FROM roles WHERE roles.name = 'admin'
ON CONFLICT (role_id, permission_key) DO UPDATE
  SET granted = TRUE;
