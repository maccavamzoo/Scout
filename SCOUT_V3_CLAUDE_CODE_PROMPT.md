# Scout v3 — strip to one streaming Claude call

Gut Scout's Managed Agents architecture. Replace it with a single streaming `messages.create` call to Claude Sonnet with web search, plus a tiny `diary` table for day-to-day deduplication. Streaming lets us pipe live progress into the existing `runs.stage` / `stage_detail` columns so the page's live-status display still works.

**Read the existing repo first.** Particularly `scripts/scout.ts`, `scripts/setup-agent.ts`, `schema.sql`, `app/api/run/route.ts`, `app/Shell.tsx`, and `CLUES.md`. The shape of `runs` and `items`, and the way the page polls `/api/latest`, must stay identical — only the script that fills them changes.

This is a deliberate simplification. Do not add retries, "if results are thin try again", multi-step reasoning, network reconnect logic, session cleanup, or anything else from v2.

## Files to delete

- `scripts/setup-agent.ts` — the entire agent definition file. Gone.

## Files to replace

### `scripts/scout.ts`

Replace with a ~80-line orchestrator. Flow:

1. Insert a `runs` row, `status='running', stage='collecting', stage_detail='asking Claude'`.
2. Read last 14 days of `diary` rows (`SELECT ran_on, summary FROM diary WHERE ran_on > CURRENT_DATE - INTERVAL '14 days' ORDER BY ran_on DESC`). Format as a bulleted list `- 2026-05-04: <summary>`.
3. Build the user message (see "The prompt" below).
4. Open a streaming `messages.create` call with the system prompt, the user message, and the web_search tool enabled:

   ```ts
   const stream = await client.messages.stream({
     model: 'claude-sonnet-4-6',
     max_tokens: 4096,
     system: SYSTEM_PROMPT,
     messages: [{ role: 'user', content: userMessage }],
     tools: [{ type: 'web_search_20250305', name: 'web_search' }],
   });
   ```

   No `undici` Agent / dispatcher overrides. Default SDK timeout is fine.

5. As the stream emits events, update `runs.stage` / `stage_detail` so the page's live status display works. Use `stream.on('streamEvent', ...)` (or iterate raw events — pick whichever is cleaner with the SDK version pinned in `package.json`):

   - When a `content_block_start` event fires with `content_block.type === 'server_tool_use'` and `name === 'web_search'`: set `stage='collecting', stage_detail='searching the web'` immediately.
   - When the tool block's input is finalised (e.g. on `content_block_stop` for that block, or via the SDK's `inputJson` event): if `input.query` exists, update `stage_detail` to `searching: ${query}`.
   - When a `content_block_start` event fires with `content_block.type === 'web_search_tool_result'`: don't update — keep showing the current query. (Optional polish: set detail to `reading results` between searches; not essential.)
   - After the stream ends: set `stage='writing', stage_detail='saving findings'`.

   Throttle DB writes to at most one per second so a flurry of searches doesn't hammer Neon. A simple `lastWriteAt` timestamp guard is enough.

6. Get the final message via `await stream.finalMessage()`. Find the last text content block (server-tool blocks come earlier in the response); that text is the JSON.

7. Parse the JSON. Be forgiving about ` ```json ` fences but nothing else — if `JSON.parse` fails after stripping fences, fail the run with the raw text saved into the `error` column.

8. Insert items into `items` (preserve `display_order`, `favicon_char` for `type='web'` as `(source_name?.[0] ?? '?').toUpperCase()`, same as v2).

9. Upsert today's diary row: `INSERT INTO diary (ran_on, summary) VALUES (CURRENT_DATE, ${diary_summary}) ON CONFLICT (ran_on) DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()`.

10. Update the `runs` row: `status='done', items_found=N, input_tokens, output_tokens, cost_usd, stage=NULL, stage_detail=NULL, stage_updated_at=NOW()`. Token usage comes from `finalMessage.usage` — sum `input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0)` for input, and `output_tokens` for output.

11. On any error: same failure path as v2 — `status='failed', error=<message + stack>, stage=NULL, stage_detail=NULL`.

**Pricing constants (top of file):**

```ts
const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;
```

These don't include web_search per-query fees ($10/1k searches, billed separately by Anthropic). Acceptable — same caveat we had in v2 for cache pricing. Add a one-line comment to that effect.

**The system prompt (constant at the top of the file):**

```
You are Scout, a daily research agent for Bikotic — a UK cycling YouTube channel and bike comparison website (bikotic.com).

# What you're hunting for

- New bike releases — official launches across road, MTB, gravel, endurance, all-road, cyclocross
- Rumoured or leaked releases — patents, race-prototype spy shots, manufacturer hints
- Trending bikes — gaining traction in press, peloton, or community
- Race results filtered through the bike — which bike won, which spec setup is suddenly winning
- Innovative components, frames, kit, inventions
- Value comparisons across all spec tiers (not just budget — also "is this £10k bike worth 5x the £2k one")

# Out of scope

E-bikes (unless mainstream crossover), commuter/utility, lifestyle content, pure training/nutrition, pure repair tutorials.

# How to research

Decide for yourself where to look. No fixed list — use whatever cycling press, manufacturer sites, race coverage, or YouTube content you can reach via web search. Try multiple angles. Verify URLs before you cite them.

# Output

Return ONLY a JSON object, no preamble or markdown fences:

{
  "diary_summary": "one short comma-separated list of the items you found today, max 20 words, used to deduplicate future runs",
  "items": [
    {
      "type": "youtube" | "web",
      "title": "...",
      "source_name": "...",
      "source_url": "https://...",
      "thumbnail_url": "https://..." | null,
      "published_at": "2026-05-05T..." | null,
      "why_matters": "one sentence — plain-spoken, dry British undertones welcome, editorial, strip marketing language"
    }
  ]
}

If today is genuinely thin, return fewer items. Don't pad. An empty array is acceptable; a dishonest result is not.
```

**The user message (built per-run):**

```
Today is ${today}. I want news from the last 48 hours where possible, last 7 days at the outside. Find me 4–8 cycling news items.

Recently covered (don't repeat):
${diaryBlock || 'Nothing yet — this is the first run.'}
```

Where `${today}` is `new Date().toISOString().slice(0, 10)` and `${diaryBlock}` is the bulleted list of last-14-days diary rows.

### `app/api/run/route.ts`

Strip every trace of Managed Agents:
- Delete the `Anthropic` import.
- Delete the entire `endStuckSession()` function.
- In the stale-row cleanup branch, just mark the row failed and proceed. Drop the `endStuckSession(row.session_id)` call and the `session_id` column from the `SELECT`.
- Remove the comment about "session_id especially" — the migration is now baseline schema.

Keep:
- The double-billing 409 guard (any `running`/`pending` row younger than 10 minutes blocks).
- The GitHub workflow_dispatch POST.

### `lib/types.ts`

Drop these fields from `RunRow`: `sources_checked`, `scout_reasoning`, `session_id`. Drop `sources_checked` from `LatestResponse`. Delete the entire `AgentResults` type — no longer used.

### `app/api/latest/route.ts`

Drop `sources_checked` and `scout_reasoning` from the `SELECT` and the response object. Drop the field from the empty-state placeholder.

### `app/page.tsx`

Same: drop `sources_checked` and `scout_reasoning` from the `SELECT` and response. Drop from the empty-state placeholder.

### `app/Shell.tsx`

`EmptyState` no longer needs the `sourcesChecked` prop. Simplify the component to just:

```tsx
function EmptyState() {
  return (
    <div className="empty-state">
      <svg ...>{/* unchanged */}</svg>
      <h2>Nothing worth your time today.</h2>
      <p>Scout looked but nothing cleared the bar.</p>
    </div>
  );
}
```

And update the call site from `<EmptyState sourcesChecked={data.sources_checked ?? 0} />` to `<EmptyState />`.

### `package.json`

Remove `undici` from dependencies. It only existed to extend the SSE bodyTimeout — irrelevant now. Run `npm install --legacy-peer-deps` after to refresh the lockfile.

### `.github/workflows/scout.yml`

Drop the `SCOUT_AGENT_ID` and `SCOUT_ENVIRONMENT_ID` env vars. Keep `ANTHROPIC_API_KEY` and `DATABASE_URL`. Leave the `cron` line commented out exactly as it is — Ben will uncomment manually when ready to go live.

## `schema.sql`

Rewrite the file as the clean v3 target state — no historical patch comments. The clean state is:

```sql
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
```

The migration block at the bottom is comment-only — Ben uncomments and runs the bits he needs in the Neon SQL editor.

## `CLUES.md`

Replace the v2-specific sections (everything under "## v2 — Managed Agents", "## SSE stream timeouts", "## Network resilience and session cleanup") with one short v3 section. Keep "## Core" and "## Ratings". Update "## Token usage and cost" for the new pricing.

New v3 section:

```markdown
## v3 — single streaming call

- This is a single-shot streaming `messages.create` call with web search enabled. The model decides what to search but does not loop. If you find yourself wanting to add iteration, retry-on-result-quality, or memory beyond the diary table — stop. That's where v2 went wrong.
- Streaming is for live UI feedback only — `runs.stage` / `stage_detail` are updated as `server_tool_use` content blocks for `web_search` arrive. The script throttles DB writes to ~1/sec.
- The diary is a deduplication tool, not a learning system. Last 14 days of summaries get pasted into the user message as "recently covered — don't repeat". Don't grow it into something more.
- No managed agents, no sessions, no environments, no memory stores. Plain Anthropic API only.
- One rating per item; latest click wins (unchanged from v2). Ratings are stored but not yet fed back into the prompt — that's a later optional addition.
```

Update "## Token usage and cost" to:

```markdown
## Token usage and cost

- Token usage comes from `finalMessage.usage`. Input total = `input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0)`.
- Pricing constants live at the top of `scripts/scout.ts` (`SONNET_INPUT_USD_PER_MTOK = 3`, `SONNET_OUTPUT_USD_PER_MTOK = 15`). Hardcoded for `claude-sonnet-4-6`.
- The cost stored in `runs.cost_usd` is an estimate. It does not adjust for cache pricing and does not include web_search per-query fees ($10/1k searches, billed separately). Acceptable for a top-of-page indicator.
```

## `README.md`

Update to reflect v3 — single streaming call, web search, diary deduplication. Drop any references to agents, environments, memory stores, `setup-agent.ts`. Keep it short.

## Don't add

- Retry logic, "if results are thin try again", multi-step reasoning
- Per-source preference learning
- Network resilience / reconnect logic
- Any session, environment, or memory-store concept
- The `undici` dependency
- Any handling for legacy v2 data formats

## Verify

1. `npm install --legacy-peer-deps` — lockfile refreshed.
2. `npm run build` — no TypeScript errors.
3. Commit on `main` with a clear message: `feat: v3 — gut managed agents, single streaming claude call`.

That's it. Don't run the script, don't run any migrations — Ben will trigger the workflow manually and run the migration SQL in Neon himself.
