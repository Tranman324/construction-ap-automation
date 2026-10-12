-- ============================================================================
-- Migration: Soft Delete for documents table
-- Date:      2026-04-11
-- Author:    platform team
-- Purpose:   Close the AP Invoice Module code review finding on hard DELETE.
--
--            Adds tombstone columns so user-initiated DELETE requests are
--            recoverable. Keeps status as a pure workflow field (pending,
--            approved, etc.) — deleted_at is orthogonal.
--
--            The retention purge path (scripts/purge.js) continues to
--            hard-delete rows past their retention window; soft delete is
--            for user-initiated deletes only.
-- ============================================================================

BEGIN;

-- ─── 1. Tombstone columns ───────────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by      TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS restored_at     TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS restored_by     TEXT;

-- ─── 2. Partial indexes ─────────────────────────────────────────────────────
-- The "active records" index covers 99% of queries (listing, stats, detail).
-- The "trash" index covers the rare /trash listing.
CREATE INDEX IF NOT EXISTS idx_documents_active
  ON documents(queued_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_deleted
  ON documents(deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMIT;

-- ─── Verification queries ───────────────────────────────────────────────────
-- Run these after migration to confirm:
--
-- 1) Columns exist:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name='documents' AND column_name LIKE '%deleted%';
--
-- 2) Indexes exist:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename='documents' AND indexname LIKE '%active%' OR indexname LIKE '%deleted%';
--
-- 3) Data intact:
--      SELECT COUNT(*) FROM documents WHERE status='pending';
