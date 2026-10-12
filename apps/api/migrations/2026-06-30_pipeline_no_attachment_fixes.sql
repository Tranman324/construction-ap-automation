-- ============================================================================
-- Migration: Pipeline no-attachment fixes
-- Date:      2026-06-30
-- Purpose:   Add email_conversation_id for thread-aware dedup, and
--            discarded_reason to documents for tracking discard context.
-- ============================================================================

BEGIN;

-- Track Graph API conversationId for thread-level dedup
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS email_conversation_id TEXT;

-- Index for thread dedup lookups: "does this conversation already have a doc with attachments?"
CREATE INDEX IF NOT EXISTS idx_documents_conversation_id
  ON documents (email_conversation_id)
  WHERE email_conversation_id IS NOT NULL;

COMMIT;
