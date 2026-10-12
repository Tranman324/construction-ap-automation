-- Document Type Mapping: extend custom_classifications for opensAs routing
-- Decision: A2 — built-in types are code-defined, not remappable from Settings

ALTER TABLE custom_classifications
  ADD COLUMN IF NOT EXISTS opens_as TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Constraint: opens_as must be a valid association
DO $$ BEGIN
  ALTER TABLE custom_classifications
    ADD CONSTRAINT valid_opens_as CHECK (
      opens_as IN ('invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Constraint: status must be valid
DO $$ BEGIN
  ALTER TABLE custom_classifications
    ADD CONSTRAINT valid_status CHECK (status IN ('active', 'disabled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
