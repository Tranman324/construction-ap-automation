BEGIN;

CREATE TABLE IF NOT EXISTS subject_job_mappings (
  vendor_code TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  job_number TEXT NOT NULL,
  subject_raw TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (vendor_code, subject_hash)
);

CREATE TABLE IF NOT EXISTS sender_job_mappings (
  vendor_code TEXT NOT NULL,
  sender_domain TEXT NOT NULL,
  job_number TEXT NOT NULL,
  hit_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (vendor_code, sender_domain)
);

COMMIT;
