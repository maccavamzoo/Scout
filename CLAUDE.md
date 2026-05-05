# Scout

A personal cycling-news agent for Ben (Bikotic).

## Project overview (v3 — single streaming call)

Scout is a Next.js 14 app on Vercel, backed by Neon Postgres, driven by a single streaming Claude API call with web search.

A daily GitHub Actions cron (06:00 UTC) runs `scripts/scout.ts`, which:

1. Reads the last 14 days of `diary` rows from Neon (deduplication context).
2. Opens a streaming `messages.create` call to `claude-sonnet-4-6` with the `web_search` tool enabled.
3. Maps `server_tool_use` stream events to live stage updates in the `runs` table for the page's progress UI.
4. Parses the JSON response, writes items to Neon, upserts today's diary row, and finalises the run.

The model decides where to look, what to fetch, what's relevant, and what's worth surfacing. There is no source list, no recency filter, no judging step in code.

The page (`app/page.tsx` + `app/Shell.tsx`) reads the latest run from Neon, polls `/api/latest` while a run is active, and renders cards with thumbs-up/thumbs-down buttons. Each rating round-trips through `/api/rate`.

## File map

- `scripts/scout.ts` — the orchestrator. ~150 lines. Single streaming call, no agent logic.
- `app/page.tsx`, `app/Shell.tsx` — the morning page (server fetches initial data, client polls + rates)
- `app/api/latest/route.ts` — latest run + items, with rating join
- `app/api/run/route.ts` — workflow_dispatch trigger
- `app/api/rate/route.ts` — POST a thumbs up/down (upsert; one rating per item)
- `lib/db.ts`, `lib/types.ts`
- `schema.sql` — manual Neon migration
- `.github/workflows/scout.yml` — daily cron + manual dispatch
- `CLUES.md` — conventions
- `README.md` — setup steps

## Conventions

See `CLUES.md`.
