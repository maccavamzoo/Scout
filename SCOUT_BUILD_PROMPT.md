# Build Scout — comprehensive build prompt

You are building **Scout**, a personal cycling-news agent, from scratch. Single comprehensive build. Read this entire document before starting work, then execute end-to-end. No legacy fallback handling, no scaffolding I'll "fill in later" — produce a working app.

---

## 1. Goal

Each morning a scheduled GitHub Actions workflow wakes up and runs an agent that:
1. **Decides** — Claude (Opus 4.7) decides where to look today, given a profile of my YouTube channel and a 7-day memory of what's been checked recently. It picks a mix of YouTube channels and open web searches.
2. **Collects** — fetches recent uploads from picked YouTube channels and runs picked web searches in parallel.
3. **Judges** — for each candidate item, Claude (Haiku 4.5) decides whether it's relevant to my channel and writes a one-sentence "why this matters."
4. **Writes** — inserts results into Neon Postgres.

A Next.js page on Vercel reads the latest run from Neon and displays the editorial-style card list (design provided in §10).

This is a single-user app. No auth.

---

## 2. Tech stack

- **Next.js 14** App Router, TypeScript, Tailwind CSS
- **Neon Postgres** (serverless)
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Opus 4.7 for planning, Haiku 4.5 for judging
- **YouTube Data API v3** (`googleapis` package, or direct fetch — your choice, prefer fetch)
- **GitHub Actions** for the daily cron + manual trigger (no Vercel Cron — Hobby plan only)
- **Vercel Hobby** for hosting the page

Model strings:
- `claude-opus-4-7` (planning)
- `claude-haiku-4-5-20251001` (judging)

---

## 3. Repo structure

```
scout/
  app/
    page.tsx                    # The morning page (port from Scout.html)
    layout.tsx
    globals.css                 # Tailwind + custom CSS vars from design
    api/
      run/route.ts              # POST → triggers GitHub Actions workflow_dispatch
      latest/route.ts           # GET  → latest completed run + items
  scripts/
    scout.ts                    # The agent (runs in GitHub Actions)
  config/
    channel.ts                  # My channel profile (placeholder I'll fill)
  lib/
    db.ts                       # Neon connection
    youtube.ts                  # YouTube API helpers
    types.ts                    # Shared types
  .github/
    workflows/
      scout.yml                 # Daily cron + workflow_dispatch
  .npmrc                        # legacy-peer-deps=true
  package.json
  tsconfig.json
  tailwind.config.ts
  postcss.config.js
  next.config.js
  vercel.json
  README.md
  CLUES.md                      # Conventions doc (see §11)
  schema.sql                    # Output the SQL — I run it in Neon manually
```

---

## 4. Database schema (output as `schema.sql`)

I run migrations manually in Neon's SQL editor. Output the file; do not try to run it.

```sql
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
```

---

## 5. Channel profile (`config/channel.ts`)

Create a placeholder I'll fill in:

```ts
export const CHANNEL_PROFILE = `
Ben's YouTube channel covers [TODO: I'll fill this in].

Audience: [TODO]
Tone: [TODO]
Topics that fit: [TODO]
Topics that DON'T fit: [TODO]
`;

// Optional starter list of YouTube channel handles or IDs Scout can consider.
// Scout is not constrained to this list — it can find new sources via web search.
export const STARTER_YOUTUBE_CHANNELS: string[] = [
  // e.g. "@gcn", "@dcrainmaker"
];
```

---

## 6. The Scout agent (`scripts/scout.ts`)

Run with `npx tsx scripts/scout.ts` from GitHub Actions. Single file, top-to-bottom flow. Use `Promise.all` aggressively — every step that can parallelise must.

**Step 1 — Plan (Opus 4.7)**

Send Claude:
- The channel profile
- A summary of `scout_memory` from the last 7 days (sources already checked + when)
- Today's date

Ask for a JSON manifest:

```json
{
  "reasoning": "one paragraph explaining today's picks",
  "youtube_channels": [
    { "handle_or_query": "@gcn", "why": "..." }
  ],
  "web_searches": [
    { "query": "UCI rule changes April 2026", "why": "..." }
  ]
}
```

Hard caps: max 5 YouTube channels + max 3 web searches per run. Tell Claude this in the prompt.

Use the Anthropic SDK with `tools` for structured output, OR ask for raw JSON in a single response and parse it. Whichever is cleaner.

**Step 2 — Collect (parallel)**

For YouTube: resolve each handle/query to a channel ID via YouTube `search.list`, then fetch its uploads playlist and pull videos published in the last 24h. Get title, description, thumbnail URL, published time, video URL.

For web: use Anthropic's web search tool (`web_search_20250305`) inside Claude API calls, OR direct fetch to a search API of your choice. **Prefer Anthropic web search** — it's simpler and one less integration. Fire one Claude call per `web_searches[i].query` with the web_search tool enabled, ask Claude to return the top 3-5 hits as JSON `{ title, url, source_name, snippet, published_at }`.

All YouTube + web fetches run in `Promise.all`.

**Step 3 — Judge (Haiku 4.5, parallel)**

Cap to 30 candidate items max (truncate from the top). For each item, one Haiku call:

- Input: channel profile (concise version), item title + description/snippet + source name
- Output JSON: `{ relevant: boolean, why_matters: string }`
- `why_matters` should be one sentence, editorial tone (not corporate), explaining why **this specific channel's audience** would care.

All 30 calls run in `Promise.all`.

Filter to `relevant: true`. Cap final list at 8 items.

**Step 4 — Write**

In a transaction:
- Insert `runs` row with `status='done'`, `sources_checked` = total things looked at, `items_found` = surviving count, `scout_reasoning` = the Opus reasoning paragraph.
- Insert each surviving item into `items` with `display_order` 0..n.
- Upsert `scout_memory` for each source touched, set `last_checked = NOW()`.

On error: insert a `runs` row with `status='failed'` and the error message in `error`. Don't throw uncaught.

Log progress with `console.log` so I can read it in the GitHub Actions log.

---

## 7. GitHub Actions workflow (`.github/workflows/scout.yml`)

```yaml
name: Scout
on:
  schedule:
    - cron: '0 6 * * *'    # 06:00 UTC daily — adjust later if I want
  workflow_dispatch:

jobs:
  scout:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci --legacy-peer-deps
      - name: Run Scout
        run: npx tsx scripts/scout.ts
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          YOUTUBE_API_KEY:   ${{ secrets.YOUTUBE_API_KEY }}
          DATABASE_URL:      ${{ secrets.DATABASE_URL }}
```

---

## 8. API routes

**`app/api/latest/route.ts`** — GET

Returns the most recent `runs` row with `status='done'` and its associated `items` ordered by `display_order`. Shape:

```ts
{
  ran_at: string,
  sources_checked: number,
  items_found: number,
  items: Array<{
    id: string,
    type: 'youtube' | 'web',
    title: string,
    source_name: string,
    source_url: string,
    thumbnail_url: string | null,
    favicon_char: string | null,
    published_at: string | null,
    why_matters: string,
  }>
}
```

**`app/api/run/route.ts`** — POST

Triggers `workflow_dispatch` on the Scout workflow via GitHub's REST API:

```
POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/scout.yml/dispatches
Authorization: Bearer {GITHUB_TOKEN}
Body: { "ref": "main" }
```

Reads `GITHUB_TOKEN`, `GITHUB_REPO` (format `owner/repo`) from env. Returns `{ ok: true }` immediately. The Anthropic SDK is **not** instantiated in this route — only in the script.

---

## 9. The page (`app/page.tsx`)

Port the design from `Scout.html` (provided in §10). Server component that fetches `/api/latest` on render. Use `dynamic(() => import('...'), { ssr: false })` for any client-side bits that touch `Date` or `toLocaleDateString` to avoid hydration mismatches.

Structure:
- Header: "Morning, Ben." + today's date (client-rendered to avoid hydration issues), "Run now" button + settings cog (cog is a placeholder)
- Summary line: "Scout checked **N sources** · found **M things** worth your time."
- Divider
- Card list — two card variants (YouTube with thumbnail, Web with favicon block)
- Empty state if items_found === 0

"Run now" → POSTs to `/api/run`, shows a brief "Scout is running. Refresh in a minute or two." toast/inline message. Does not poll. I'll just refresh.

Tailwind config must include the custom OKLCH colours, DM Serif Display + DM Sans fonts, and the radius/shadow tokens from the original HTML's `:root`. Load the fonts via `next/font/google`.

Animations: keep the fadeSlideIn cascade on cards.

---

## 10. Reference design (`Scout.html`)

The Claude Design output. Use this as the source of truth for layout, colours, typography, animations. I will provide this file alongside this prompt; treat it as authoritative for visual decisions. The card markup, OKLCH colour palette, fonts, spacing, and "why this matters" italic block all come from here. Do not invent your own design.

---

## 11. Conventions (`CLUES.md`)

Write this file with:

- Anthropic SDK is instantiated **inside** API route handlers and the scout script only. Never at module top-level.
- No date libraries — native `Intl` and `Date` only.
- Migrations are manual SQL via the Neon SQL editor. The `schema.sql` file is the source of truth; never run migrations from code.
- `legacy-peer-deps=true` in `.npmrc`.
- `window.location.href` for any post-action navigation, not `router.push`.
- One scout run = one row in `runs`, many rows in `items`. The page reads only the latest `status='done'` run.
- Scout caps: 5 YouTube channels, 3 web searches, 30 items judged, 8 items surfaced.
- All parallel work uses `Promise.all`. Sequential calls inside a parallel-able loop are a bug.

---

## 12. Environment variables

**Vercel** (page + API routes):
- `DATABASE_URL` — Neon
- `GITHUB_TOKEN` — fine-grained PAT, `actions:write` on the repo
- `GITHUB_REPO` — e.g. `maccavamzoo/scout`

**GitHub Actions** secrets:
- `ANTHROPIC_API_KEY`
- `YOUTUBE_API_KEY`
- `DATABASE_URL`

The Anthropic key is **not** needed on Vercel — the page only reads from Neon, never calls Claude.

---

## 13. README.md

Brief setup steps for me:
1. Create Neon DB, run `schema.sql` in SQL editor
2. Get YouTube Data API key (Google Cloud Console)
3. Add GitHub Actions secrets (3 of them)
4. Deploy to Vercel, add env vars (3 of them)
5. Fill in `config/channel.ts`
6. Trigger the workflow manually once from GitHub Actions tab to seed the first run

---

## 14. Out of scope (do not build)

- Auth, multi-user
- Email / Telegram / push delivery
- Reddit, Strava, RSS sources
- Cross-day trend detection
- Settings screen behind the cog (cog is a visual placeholder only)
- Mobile-app-specific behaviour beyond responsive CSS already in the HTML
- Unit tests

---

## 15. Build sequence

1. Project scaffolding (package.json, tsconfig, tailwind, next config, .npmrc)
2. `schema.sql`
3. `lib/db.ts`, `lib/types.ts`, `lib/youtube.ts`
4. `config/channel.ts` (placeholder)
5. `scripts/scout.ts` — agent end-to-end
6. `app/api/latest/route.ts`
7. `app/api/run/route.ts`
8. `app/layout.tsx`, `app/globals.css`, `app/page.tsx` — port the HTML
9. `.github/workflows/scout.yml`
10. `CLUES.md`, `README.md`

Verify each file compiles before moving on. Output `schema.sql` and stop short of running it. When everything's done, give me a single summary message listing the files created, the env vars I need to set, and the one-liner to manually trigger the first scout run.
