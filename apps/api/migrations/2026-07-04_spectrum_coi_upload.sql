-- Spectrum COI upload tracking columns on documents table
-- Tracks upload status for the POST /api/documents/:id/upload-to-spectrum endpoint

BEGIN;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_status TEXT DEFAULT NULL;
  -- NULL = never attempted
  -- 'queued' = waiting in serial queue
  -- 'processing' = active upload in progress
  -- 'success' = upload completed
  -- 'failed' = upload failed (see spectrum_upload_error)

ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_queued_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_started_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_completed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_error TEXT DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_trans_id TEXT DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_tracking_code TEXT DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_vendor_code TEXT DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS spectrum_upload_attempts INTEGER DEFAULT 0;

-- Add the submit_spectrum permission if it doesn't exist
INSERT INTO permissions (key, module, description)
VALUES ('accounting.invoices.submit_spectrum', 'invoices', 'Upload COI documents to Spectrum ERP')
ON CONFLICT (key) DO NOTHING;

-- Grant to admin role (admins get all permissions via code, but explicit row ensures consistency)
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'accounting.invoices.submit_spectrum'
FROM roles r WHERE r.name = 'admin' AND r.is_system = true
ON CONFLICT DO NOTHING;

COMMIT;
