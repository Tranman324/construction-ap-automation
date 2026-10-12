ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access ON vendor_contacts;
CREATE POLICY service_role_full_access ON vendor_contacts
  FOR ALL TO postgres, service_role
  USING (true) WITH CHECK (true);
