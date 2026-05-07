# Scout

> ## 🚧 ACTIVE TASK
>
> **Read [`SCOUT_ARCHIVE_PROMPT.md`](./SCOUT_ARCHIVE_PROMPT.md) in the repo root before doing anything else.** That file is the current job — adding past-day navigation to the Scout page with back/forward arrows. Do everything in it, including removing this banner at the end.
>
> The text below describes the current state of the codebase (post-v3). Use it for reference while you read the repo.

---

A personal cycling-news agent for Ben (Bikotic).

## Project overview

Scout runs once a day via GitHub Actions cron (currently triggered manually via `workflow_dispatch`). The cron fires `scripts/scout.ts`, which makes a single streaming `messages.create` call to Claude Sonnet 4.6 with the web search tool enabled. Claude finds 4–8 cycling news items relevant to Bikotic (UK cycling YouTube channel + bike comparison site), writes a short editorial sentence on each, and returns a JSON object containing the items plus a one-line `diary_summary` for next-day deduplication.

The script writes everything to Neon Postgres: a row in `runs` (with token usage and cost), a row per item in `items`, and an upserted row in `diary` keyed on the UTC date.

The page (`app/page.tsx` + `app/Shell.tsx`) reads the latest run from Neon, polls `/api/latest` while a run is in progress, and renders cards. Each item has thumbs-up/thumbs-down ratings stored in the `ratings` table.

## File map

- `scripts/scout.ts` — the orchestrator. Single streaming `messages.create` call, web search tool, parses JSON, writes runs + items + diary.
- `app/page.tsx`, `app/Shell.tsx` — the morning page (server fetches initial data, client polls + rates)
- `app/api/latest/route.ts` — latest run + items, with rating join
- `app/api/run/route.ts` — workflow_dispatch trigger (with double-billing guard)
- `app/api/rate/route.ts` — POST a thumbs up/down (upsert; one rating per item)
- `app/api/balance/route.ts` — Anthropic credits remaining
- `lib/db.ts`, `lib/types.ts`
- `schema.sql` — clean v3 schema (manual Neon migration, source of truth)
- `.github/workflows/scout.yml` — manual dispatch (cron currently commented out)
- `CLUES.md` — conventions
- `README.md` — setup steps

## Conventions

- TypeScript / Next.js 14 App Router / Tailwind / Neon Postgres
- `legacy-peer-deps=true` in `.npmrc`
- Anthropic SDK is instantiated **inside** route handlers and the scout script only. Never at module top-level.
- No date libraries — native `Intl` and `Date` only.
- Migrations are manual SQL via Neon's SQL editor. `schema.sql` is the source of truth.
- All parallel work uses `Promise.all`.
- `window.location.href` for post-action navigation, not `router.push`.
- Model: `claude-sonnet-4-6`.
- Ratings: one row per item, latest click wins.

## Working style

Direct and decisive. No "you may want to…", no fallback handling for cases the spec rules out.
