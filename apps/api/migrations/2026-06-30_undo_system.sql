-- ============================================================================
-- Migration: Invoice undo support
-- Date:      2026-06-30
-- Purpose:   Extend audit_events with undo snapshots and add document fields
--            used by local invoice actions.
-- ============================================================================

BEGIN;

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS before_state JSONB,
  ADD COLUMN IF NOT EXISTS after_state JSONB,
  ADD COLUMN IF NOT EXISTS undoable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_events_target_undoable
  ON audit_events(target_id)
  WHERE undoable = true;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS filed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discarded_by TEXT,
  ADD COLUMN IF NOT EXISTS reconciled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiver_released BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_released_at TIMESTAMPTZ;

COMMIT;
