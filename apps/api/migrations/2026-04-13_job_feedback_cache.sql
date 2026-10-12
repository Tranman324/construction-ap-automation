-- ============================================================================
-- Migration: Job Feedback Cache
-- Date:      2026-04-13
-- Author:    platform team
-- Purpose:   When Dana corrects a job number, cache the vendor + address →
--            job mapping so the same vendor at the same address auto-resolves
--            correctly next time. Same pattern as vendor_mappings and
--            subcontract_mappings.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS job_mappings (
  id SERIAL PRIMARY KEY,
  vendor_code TEXT NOT NULL,
  address_hash TEXT NOT NULL,         -- normalized, lowercase address hash
  job_number TEXT NOT NULL,
  address_raw TEXT,                    -- original address for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vendor_code, address_hash)
);

-- RLS: match the pattern from the rest of the schema
ALTER TABLE job_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON job_mappings
  FOR ALL TO postgres, service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_job_mappings_lookup
  ON job_mappings(vendor_code, address_hash);

COMMIT;
