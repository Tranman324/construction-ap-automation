-- Toolbox 3.0 — Invoice Pipeline Schema
-- Database: toolbox, User: toolbox

-- Documents (invoices, lien waivers, COIs, W-9s, etc.)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,                    -- e.g. doc-1771889202286-ykcn
  classification TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, modified, rejected, reviewed, discarded, duplicate, submitted, retry-pending, needs-split, split-processing, split
  confidence REAL,

  -- File
  file_name TEXT,
  file_path TEXT,                         -- path to PDF on disk (replaces base64 in JSON)
  file_size_bytes INTEGER,

  -- Email metadata
  email_message_id TEXT,
  email_from TEXT,
  email_subject TEXT,
  email_received_at TIMESTAMPTZ,
  email_body_preview TEXT,
  email_body TEXT,
  email_body_content_type TEXT DEFAULT 'html',

  -- Extracted fields (from Haiku vision)
  vendor_name TEXT,
  vendor_address TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  amount NUMERIC(12,2),
  job_number TEXT,
  project_name TEXT,
  project_address TEXT,
  description TEXT,
  line_items JSONB DEFAULT '[]',          -- array of line item objects

  -- Matching results
  vendor_code TEXT,
  vendor_match_confidence REAL,
  vendor_match_method TEXT,
  matched_vendor_name TEXT,
  job_match_number TEXT,
  job_match_confidence REAL,
  job_match_method TEXT,
  subcontract_number TEXT,
  subcontract_match_confidence REAL,
  subcontract_match_method TEXT,
  overall_confidence REAL,
  needs_review BOOLEAN DEFAULT true,

  -- Relationships
  split_from TEXT REFERENCES documents(id),
  duplicate_of TEXT REFERENCES documents(id),

  -- Status metadata
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,

  -- Multi-page split review (see docs/specs/2026-04-08-multi-page-split-review.md)
  split_suggestion JSONB,                 -- Haiku's per-page analysis + suggested groups
  suggested_split BOOLEAN DEFAULT false,  -- Flagged by pipeline as likely multi-invoice; user can confirm via UI

  -- Multi-phase subcontract allocation (see docs/specs/2026-04-10-multi-phase-subcontract.md)
  multi_phase_candidate BOOLEAN DEFAULT false,  -- Matched subcontract has 2+ distinct phase codes; user must allocate
  phase_allocations JSONB,                -- User's allocation: [{phase_code, cost_type, amount, description}]

  -- Timestamps
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit trail
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                   -- queued, edited, approved, rejected, reviewed, submitted, discarded, reclassified, deleted
  actor TEXT NOT NULL DEFAULT 'system',   -- pipeline, dashboard, system, or username when SSO
  changes JSONB,                          -- { field: [oldVal, newVal] } for edits
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feedback caches (vendor corrections, subcontract corrections)
CREATE TABLE IF NOT EXISTS vendor_feedback (
  id SERIAL PRIMARY KEY,
  domain TEXT,
  vendor_name TEXT,
  vendor_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain, vendor_name)
);

CREATE TABLE IF NOT EXISTS subcontract_feedback (
  id SERIAL PRIMARY KEY,
  vendor_code TEXT NOT NULL,
  job_number TEXT NOT NULL,
  subcontract_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vendor_code, job_number)
);

-- Ignore rules
CREATE TABLE IF NOT EXISTS ignore_rules (
  id SERIAL PRIMARY KEY,
  field TEXT NOT NULL,                    -- sender, subject, filename
  pattern TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Custom classification types
CREATE TABLE IF NOT EXISTS custom_classifications (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'view-only',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_classification ON documents(classification);
CREATE INDEX IF NOT EXISTS idx_documents_vendor_code ON documents(vendor_code);
CREATE INDEX IF NOT EXISTS idx_documents_queued_at ON documents(queued_at);
CREATE INDEX IF NOT EXISTS idx_documents_invoice_number ON documents(invoice_number);
CREATE INDEX IF NOT EXISTS idx_documents_email_message_id ON documents(email_message_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_document_id ON audit_log(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
