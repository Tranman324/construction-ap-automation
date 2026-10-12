BEGIN;

-- Authoritative lien waiver requirement detection (agreed scope 2026-07-14).
--
-- Rule: an invoice/pay-application requires a lien waiver when
--   1. cost_type = 'S' (subcontractor labor), AND
--   2. job_match_number is present (project work, not overhead), AND
--   3. phase_code is NOT in the exempt list (general conditions with no
--      permanent improvement to the property).
-- Cost types M/E/etc. are exempt regardless of phase.
--
-- Implemented as a trigger so EVERY write path (pipeline ingestion, rules
-- engine, manual edits, approval overrides) keeps the flag correct. The
-- trigger only fires when the detection inputs change, so an explicit manual
-- write to lien_waiver_required alone is preserved.

CREATE OR REPLACE FUNCTION compute_lien_waiver_required()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.classification IN ('invoice', 'pay-application') THEN
    NEW.lien_waiver_required :=
      UPPER(TRIM(COALESCE(NEW.cost_type, ''))) = 'S'
      AND TRIM(COALESCE(NEW.job_match_number, '')) <> ''
      AND TRIM(COALESCE(NEW.phase_code, '')) NOT IN
        ('01502', '01503', '01812', '01850', '01900');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lien_waiver_detection ON documents;

CREATE TRIGGER trg_lien_waiver_detection
  BEFORE INSERT OR UPDATE OF cost_type, job_match_number, phase_code, classification
  ON documents
  FOR EACH ROW
  EXECUTE FUNCTION compute_lien_waiver_required();

-- Backfill: recompute for all active (non-terminal) invoices/pay-apps.
-- Terminal documents (submitted/discarded) are left untouched.
UPDATE documents
SET lien_waiver_required = (
  UPPER(TRIM(COALESCE(cost_type, ''))) = 'S'
  AND TRIM(COALESCE(job_match_number, '')) <> ''
  AND TRIM(COALESCE(phase_code, '')) NOT IN
    ('01502', '01503', '01812', '01850', '01900')
)
WHERE classification IN ('invoice', 'pay-application')
  AND status IN ('pending', 'modified', 'approved', 'reviewed');

COMMIT;
