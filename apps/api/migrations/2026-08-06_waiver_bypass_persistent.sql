BEGIN;

-- Persistent lien-waiver bypass (2026-08-06).
--
-- Problem: the waiver-bypass action used to flip the computed
-- lien_waiver_required flag to false. trg_lien_waiver_detection recomputes
-- that flag on ANY update touching cost_type / job_match_number / phase_code /
-- classification / subcontract_number, so any later edit or background write
-- silently re-armed the requirement and erased the human's bypass decision.
--
-- Fix: record the bypass in its own columns. lien_waiver_required stays a
-- pure detection output owned by the trigger; the effective requirement is
-- (lien_waiver_required AND NOT waiver_bypassed), enforced in
-- approvalValidator, submitState and submitWorkflow.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS waiver_bypassed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_bypassed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiver_bypassed_by TEXT;

COMMENT ON COLUMN documents.waiver_bypassed IS 'Explicit human bypass of the lien-waiver requirement; persists across trigger recomputes of lien_waiver_required.';

-- Backfill from audit history: a document whose most recent bypass action is
-- waiver-bypass-set (never subsequently reverted) is still bypassed, even if
-- the detection trigger has since re-armed lien_waiver_required.
UPDATE documents d
SET waiver_bypassed = true,
    waiver_bypassed_at = a.created_at,
    waiver_bypassed_by = COALESCE(a.actor, 'backfill-2026-08-06')
FROM (
  SELECT DISTINCT ON (document_id) document_id, action, actor, created_at
  FROM audit_log
  WHERE action IN ('waiver-bypass-set', 'waiver-bypass-reverted')
  ORDER BY document_id, created_at DESC
) a
WHERE a.document_id = d.id
  AND a.action = 'waiver-bypass-set'
  AND d.waiver_bypassed = false;

COMMIT;
