-- Enable RLS on feature request tables (missed in initial creation)
-- Pattern: explicit allow-all for postgres + service_role (see 2026-04-11_rls_hardening.sql)

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_postgres_feature_requests" ON feature_requests FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "allow_service_role_feature_requests" ON feature_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "allow_postgres_feature_votes" ON feature_votes FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "allow_service_role_feature_votes" ON feature_votes FOR ALL TO service_role USING (true) WITH CHECK (true);
