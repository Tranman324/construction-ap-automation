-- COI compliance extraction data (structured JSONB)
-- Stores coverage lines, endorsements, holder info, carrier data extracted from COI documents.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS coi_data JSONB DEFAULT NULL;

COMMENT ON COLUMN documents.coi_data IS 'Structured COI compliance data: coverageLines, endorsements, holder, carrier, cancellationNoticeDays, policyNumbers';
