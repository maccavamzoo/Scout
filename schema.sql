-- Scout schema. Run this manually in the Neon SQL editor.

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  sources_checked INT,
  items_found INT,
  scout_reasoning TEXT,
  error TEXT
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

CREATE TABLE scout_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX idx_items_run ON items(run_id);
CREATE INDEX idx_runs_ran_at ON runs(ran_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_memory_source ON scout_memory(source);
CREATE INDEX idx_memory_checked ON scout_memory(last_checked DESC);
