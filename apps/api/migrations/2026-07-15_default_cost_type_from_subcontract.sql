-- 2026-07-15: Derive cost_type = 'S' at the database layer when a subcontract
-- match is present and cost_type is empty.
--
-- Root cause: cost_type was derived in the frontend (SpectrumSubmitSection)
-- and only persisted at approval/submit time, so compute_lien_waiver_required()
-- evaluated NULL cost_type and invoices with matched subcontracts skipped the
-- lien waiver gate (e.g. doc-1783605766913-e76s, Core Roofing, job 26-402).
--
-- Fills ONLY empty cost_type — never overwrites user-entered values.
-- Named trg_default_cost_type so it fires before trg_lien_waiver_detection
-- (PostgreSQL fires same-event triggers in alphabetical order).

CREATE OR REPLACE FUNCTION public.default_cost_type_from_subcontract()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.classification IN ('invoice', 'pay-application')
     AND TRIM(COALESCE(NEW.subcontract_number, '')) <> ''
     AND TRIM(COALESCE(NEW.cost_type, '')) = '' THEN
    NEW.cost_type := 'S';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_default_cost_type ON documents;

CREATE TRIGGER trg_default_cost_type
  BEFORE INSERT OR UPDATE OF subcontract_number, classification
  ON documents
  FOR EACH ROW
  EXECUTE FUNCTION default_cost_type_from_subcontract();

-- trg_lien_waiver_detection previously fired only on UPDATE OF cost_type,
-- job_match_number, phase_code, classification. UPDATE OF matches columns in
-- the statement's SET clause — not columns changed by other triggers — so a
-- matcher UPDATE that sets only subcontract_number would get cost_type='S'
-- from trg_default_cost_type without re-evaluating the waiver gate.
-- Recreate it with subcontract_number in the column list.

DROP TRIGGER IF EXISTS trg_lien_waiver_detection ON documents;

CREATE TRIGGER trg_lien_waiver_detection
  BEFORE INSERT OR UPDATE OF cost_type, job_match_number, phase_code, classification, subcontract_number
  ON documents
  FOR EACH ROW
  EXECUTE FUNCTION compute_lien_waiver_required();
