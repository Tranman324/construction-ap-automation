-- Add phone column to toolbox_users
-- Stores mobilePhone from Azure Graph, pulled during SSO enrollment
-- 2026-05-07

ALTER TABLE toolbox_users ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN toolbox_users.phone IS 'Mobile phone from Azure AD, synced at login';
