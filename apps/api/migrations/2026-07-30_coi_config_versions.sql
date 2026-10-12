BEGIN;

CREATE TABLE IF NOT EXISTS coi_config_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  author TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS coi_config_versions_version_key
  ON coi_config_versions (version);

CREATE INDEX IF NOT EXISTS coi_config_versions_effective_order
  ON coi_config_versions (effective_from DESC, created_at DESC, id DESC);

INSERT INTO coi_config_versions (id, version, effective_from, config, created_at, author)
SELECT
  'v1',
  1,
  COALESCE(updated_at, NOW()),
  config,
  COALESCE(updated_at, NOW()),
  COALESCE(updated_by, 'seed')
FROM coi_compliance_config
WHERE id = 1
ON CONFLICT (id) DO NOTHING;

COMMIT;
