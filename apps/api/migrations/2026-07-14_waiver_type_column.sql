BEGIN;

-- Persists the waiver classification type selected by the user in the
-- lien waiver document panel (e.g. "Conditional progress waiver",
-- "Conditional final waiver", "Unconditional progress waiver",
-- "Unconditional final waiver").
-- Previously this was derived client-side from email subject/filename
-- heuristics and never persisted.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS waiver_type TEXT;

COMMIT;
