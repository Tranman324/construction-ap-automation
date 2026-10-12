-- Document filing metadata (2026-07-01)
-- Backend support for doc-panel filing actions that previously ran as FE stubs:
--   filed_destination: SharePoint folder path chosen in the DestinationPicker
--   filing_note:       optional note entered when filing a document
--   hold_reason:       lien-waiver "hold without invoice pair" justification
--   sp_file_url:       webUrl of the uploaded SharePoint copy (when uploaded)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS filed_destination TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS filing_note TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sp_file_url TEXT;
