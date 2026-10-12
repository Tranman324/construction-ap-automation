-- Immutable comments; actor snapshots are forward-only. Rollback: DROP TABLE document_comments;
BEGIN;
CREATE TABLE IF NOT EXISTS document_comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_comments_document_id
  ON document_comments(document_id, created_at DESC, id DESC);
ALTER TABLE document_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access ON document_comments;
CREATE POLICY service_role_full_access ON document_comments
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);
COMMIT;
