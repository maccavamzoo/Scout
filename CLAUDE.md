# Scout

A personal cycling-news agent for Ben.

## Project overview

Scout is a Next.js 14 app on Vercel backed by Neon Postgres. A daily GitHub Actions cron runs `scripts/scout.ts`:

1. **Plan** — Opus 4.7 reads the channel profile and 7-day memory of recent sources, returns a JSON manifest of YouTube channels + web searches to check today.
2. **Collect** — YouTube uploads (last 24h via Data API v3) and Anthropic web searches run in parallel.
3. **Judge** — Haiku 4.5 scores each candidate for relevance and writes a one-sentence "why this matters."
4. **Write** — surviving items go to `items`, run summary to `runs`, sources upserted into `scout_memory`.

The page (`app/page.tsx`) fetches the latest `status='done'` run from Neon and renders the editorial card list (two variants: YouTube with thumbnail, Web with favicon block). "Run now" POSTs to `/api/run`, which triggers `workflow_dispatch` on the Scout workflow.

## File map

- `scripts/scout.ts` — the agent
- `app/page.tsx`, `app/Header.tsx` — the morning page
- `app/api/latest/route.ts` — latest done run + items
- `app/api/run/route.ts` — workflow_dispatch trigger
- `lib/db.ts`, `lib/youtube.ts`, `lib/types.ts`
- `config/channel.ts` — channel profile (fill in)
- `schema.sql` — manual Neon migration
- `.github/workflows/scout.yml` — daily cron + manual dispatch
- `CLUES.md` — conventions
- `README.md` — setup steps
- `Scout.html` — original visual reference (kept for posterity)
- `SCOUT_BUILD_PROMPT.md` — the original build spec

## Conventions

- TypeScript / Next.js 14 App Router / Tailwind / Neon Postgres
- `legacy-peer-deps=true` in `.npmrc`
- Anthropic SDK is instantiated **inside** route handlers and the scout script only. Never at module top-level.
- No date libraries — native `Intl` and `Date` only.
- Migrations are manual SQL via Neon's SQL editor. `schema.sql` is the source of truth; do not run from code.
- All parallel work uses `Promise.all`.
- `window.location.href` for post-action navigation, not `router.push`.
- Models: `claude-opus-4-7` (planner), `claude-haiku-4-5-20251001` (judge).
- Anthropic web search via the `web_search_20250305` tool. No third-party search API.
- Scout caps: 5 YouTube channels, 3 web searches, 30 items judged, 8 items surfaced.

## Working style

Direct and decisive. No "you may want to…", no fallback handling for cases the spec rules out. If something's silent, make a sensible call and document it briefly.
