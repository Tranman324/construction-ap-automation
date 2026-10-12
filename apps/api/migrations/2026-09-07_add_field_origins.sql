-- BE-G: persistent per-field origin for invoice values.
-- Keys are the canonical camelCase edit field names (FIELD_MAP in
-- invoiceEditService). Each value is {"origin":"manual"|"derived","at":ISO,"by":actor}.
-- An ABSENT key means unknown/system provenance — historical rows deliberately
-- stay '{}' so provenance is never fabricated for pre-feature edits.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS field_origins JSONB NOT NULL DEFAULT '{}';
