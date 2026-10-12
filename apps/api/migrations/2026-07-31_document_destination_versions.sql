BEGIN;

-- Immutable, effective-dated successor to the document_destinations singleton.
-- The legacy singleton remains in place for compatibility; this table becomes
-- the authoritative history source once the settings history surface lands.
CREATE TABLE IF NOT EXISTS document_destination_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  author TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS document_destination_versions_version_key
  ON document_destination_versions (version);

CREATE INDEX IF NOT EXISTS document_destination_versions_effective_order
  ON document_destination_versions (effective_from DESC, created_at DESC, id DESC);

-- Preserve the currently served singleton as physical version v1. The
-- singleton's timestamps/actor are retained when present, with deterministic
-- fallbacks for legacy rows that predate those columns.
INSERT INTO document_destination_versions (id, version, effective_from, config, created_at, author)
SELECT
  'v1',
  1,
  COALESCE(updated_at, NOW()),
  config,
  COALESCE(updated_at, NOW()),
  COALESCE(updated_by, 'seed')
FROM document_destinations
WHERE id = 1
ON CONFLICT (id) DO NOTHING;

COMMIT;
