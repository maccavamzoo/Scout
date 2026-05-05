# Scout

> ## 🚧 ACTIVE TASK
>
> **Read [`SCOUT_V3_CLAUDE_CODE_PROMPT.md`](./SCOUT_V3_CLAUDE_CODE_PROMPT.md) in the repo root before doing anything else.** That file is the current job — gutting the v2 Managed Agents architecture and replacing it with a single streaming Claude call. Do everything in it, including rewriting the rest of this file and removing this banner at the end.
>
> The text below describes v2 (current state of the code). Use it for reference while you read the repo, but don't treat it as the target — the prompt file is the target.

---

A personal cycling-news agent for Ben (Bikotic).

## Project overview (v2 — Managed Agents)

Scout is a Next.js 14 app on Vercel, backed by Neon Postgres, driven by an autonomous agent running on Anthropic's Managed Agents infrastructure.

A daily GitHub Actions cron (06:00 UTC) runs `scripts/scout.ts`, which:

1. Reads the last 14 days of Ben's ratings from Neon and the date of the last successful run.
2. Opens a session against the pre-created Scout agent + environment, mounting the persistent memory store at `/mnt/memory/scout-memory/`.
3. Sends today's user message (date + ratings + a one-line brief).
4. Streams events back, mapping `agent.tool_use` events to live stage updates in the `runs` table for the page's progress UI.
5. Downloads `/mnt/session/outputs/results.json` via `files.list({scope_id})`, parses it, writes items + finalises the run row.

The agent itself decides where to look, what to fetch, what's relevant, and what's worth surfacing. There is no source list, no recency filter, no judging step in code — those concerns all live on the agent, in the system prompt at `scripts/setup-agent.ts`.

The page (`app/page.tsx` + `app/Shell.tsx`) reads the latest run from Neon, polls `/api/latest` while the agent is running, and renders cards with thumbs-up/thumbs-down buttons. Each rating round-trips through `/api/rate` and feeds the next run's user message.

## File map

- `scripts/setup-agent.ts` — find-or-create the agent, environment, and memory store. Canonical home of the system prompt. Re-run when the prompt or tool config changes.
- `scripts/scout.ts` — the orchestrator. ~200 lines. No agent intelligence — only glue.
- `app/page.tsx`, `app/Shell.tsx` — the morning page (server fetches initial data, client polls + rates)
- `app/api/latest/route.ts` — latest run + items, with rating join
- `app/api/run/route.ts` — workflow_dispatch trigger
- `app/api/rate/route.ts` — POST a thumbs up/down (upsert; one rating per item)
- `lib/db.ts`, `lib/types.ts`
- `schema.sql` — manual Neon migration (includes patch 03 stage cols + v2 ratings table)
- `.github/workflows/scout.yml` — daily cron + manual dispatch
- `CLUES.md` — conventions
- `README.md` — setup steps
- `Scout.html` — original visual reference
- `SCOUT_BUILD_PROMPT.md` — original v1 build spec

## Conventions

- TypeScript / Next.js 14 App Router / Tailwind / Neon Postgres
- `legacy-peer-deps=true` in `.npmrc`
- Anthropic SDK is instantiated **inside** route handlers and the scout/setup scripts only. Never at module top-level.
- No date libraries — native `Intl` and `Date` only.
- Migrations are manual SQL via Neon's SQL editor. `schema.sql` is the source of truth.
- All parallel work uses `Promise.all`.
- `window.location.href` for post-action navigation, not `router.push`.
- Model: `claude-opus-4-7` (the agent's default, set in `setup-agent.ts`).
- Cross-session memory: a single workspace-scoped Memory Store named `scout-memory`, mounted at `/mnt/memory/scout-memory/` in the session container. The store ID is stored in `agent.metadata.scout_memory_store_id` so the runner doesn't need a third secret.
- Agent output: the agent writes `/mnt/session/outputs/results.json`; the orchestrator downloads it via `files.list({scope_id: session.id})`.
- Ratings: one row per item, latest click wins (UNIQUE index on `item_id`, ON CONFLICT DO UPDATE).
- `scripts/scout.ts` is glue, not pipeline. If you find yourself adding logic about sources, freshness, or relevance there — stop. That belongs in the system prompt.

## Working style

Direct and decisive. No "you may want to…", no fallback handling for cases the spec rules out.
