BEGIN;

-- Subject feedback is only eligible after two matching human confirmations.
ALTER TABLE subject_job_mappings
  ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_subject_job_mappings_confirmed
  ON subject_job_mappings (vendor_code, subject_hash)
  WHERE hit_count >= 2;

COMMIT;
