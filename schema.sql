-- Scout schema. Run this manually in the Neon SQL editor.

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  items_found INT,
  error TEXT,
  stage TEXT,
  stage_detail TEXT,
  stage_updated_at TIMESTAMPTZ,
  input_tokens INT,
  output_tokens INT,
  cost_usd NUMERIC(10, 4)
);

CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('youtube','web')),
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  thumbnail_url TEXT,
  favicon_char TEXT,
  published_at TIMESTAMPTZ,
  why_matters TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE diary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_on DATE NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_run ON items(run_id);
CREATE INDEX idx_runs_ran_at ON runs(ran_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE UNIQUE INDEX idx_ratings_item ON ratings(item_id);
CREATE INDEX idx_ratings_created ON ratings(created_at DESC);
CREATE INDEX idx_diary_ran_on ON diary(ran_on DESC);


-- ── Migration from v2 → v3 (run once manually in Neon) ──────────────────────
-- Skip if you're starting from a fresh database.
--
-- DROP TABLE IF EXISTS scout_memory;
-- ALTER TABLE runs DROP COLUMN IF EXISTS session_id;
-- ALTER TABLE runs DROP COLUMN IF EXISTS sources_checked;
-- ALTER TABLE runs DROP COLUMN IF EXISTS scout_reasoning;
-- DROP INDEX IF EXISTS idx_memory_source;
-- DROP INDEX IF EXISTS idx_memory_checked;
--
-- CREATE TABLE diary (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   ran_on DATE NOT NULL UNIQUE,
--   summary TEXT NOT NULL,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
-- CREATE INDEX idx_diary_ran_on ON diary(ran_on DESC);
