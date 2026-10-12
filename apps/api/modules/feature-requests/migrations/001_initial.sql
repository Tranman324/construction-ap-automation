-- Feature Request Board — Initial Schema
-- Run against Supabase (same DB as invoice pipeline)

BEGIN;

CREATE TABLE IF NOT EXISTS feature_requests (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title         VARCHAR(120) NOT NULL,
  description   VARCHAR(500) NOT NULL,
  category      VARCHAR(20)  NOT NULL CHECK (category IN ('workflow','reporting','integration','design','admin')),
  status        VARCHAR(20)  NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','declined')),
  author_email  VARCHAR(255) NOT NULL,
  author_name   VARCHAR(100) NOT NULL,
  deleted_at    TIMESTAMPTZ  DEFAULT NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_votes (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  feature_request_id  TEXT         NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_email          VARCHAR(255) NOT NULL,
  user_name           VARCHAR(100) NOT NULL,
  vote_type           VARCHAR(20)  NOT NULL CHECK (vote_type IN ('must_have','nice_to_have')),
  created_at          TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(feature_request_id, user_email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fr_status ON feature_requests(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fr_category ON feature_requests(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fv_request ON feature_votes(feature_request_id);
CREATE INDEX IF NOT EXISTS idx_fv_user ON feature_votes(user_email);

COMMIT;
