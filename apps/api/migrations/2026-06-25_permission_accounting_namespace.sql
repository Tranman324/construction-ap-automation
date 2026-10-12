-- Rename invoices.* permission keys to accounting.invoices.* namespace.
-- Frontend (Toolbox 3.0) already uses accounting.invoices.* in PermissionGate
-- components and the permission manifest. This migration aligns the DB keys
-- so the JWT token, frontend gates, and backend middleware all use the same
-- namespace.
--
-- FK constraints are NOT DEFERRABLE, so we drop and re-add them within a
-- single transaction to keep referential integrity.

BEGIN;

-- Step 1: Drop FK constraints on child tables.
ALTER TABLE role_permissions
  DROP CONSTRAINT role_permissions_permission_key_fkey;

ALTER TABLE user_permission_overrides
  DROP CONSTRAINT user_permission_overrides_permission_key_fkey;

-- Step 2: Rename keys in all three tables.
UPDATE permissions
SET key = 'accounting.' || key,
    module = 'accounting'
WHERE key LIKE 'invoices.%'
  AND key NOT LIKE 'accounting.%';

UPDATE role_permissions
SET permission_key = 'accounting.' || permission_key
WHERE permission_key LIKE 'invoices.%'
  AND permission_key NOT LIKE 'accounting.%';

UPDATE user_permission_overrides
SET permission_key = 'accounting.' || permission_key
WHERE permission_key LIKE 'invoices.%'
  AND permission_key NOT LIKE 'accounting.%';

-- Step 3: Re-add FK constraints.
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_permission_key_fkey
  FOREIGN KEY (permission_key) REFERENCES permissions(key)
  ON DELETE CASCADE;

ALTER TABLE user_permission_overrides
  ADD CONSTRAINT user_permission_overrides_permission_key_fkey
  FOREIGN KEY (permission_key) REFERENCES permissions(key)
  ON DELETE CASCADE;

COMMIT;
