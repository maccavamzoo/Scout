# CLUES — Scout conventions

## Core

- TypeScript / Next.js 14 App Router / Tailwind / Neon Postgres
- `legacy-peer-deps=true` in `.npmrc`
- Anthropic SDK is instantiated **inside** route handlers and the scout script only. Never at module top-level.
- No date libraries — native `Intl` and `Date` only.
- Migrations are manual SQL via Neon's SQL editor. `schema.sql` is the source of truth.
- All parallel work uses `Promise.all`.
- `window.location.href` for post-action navigation, not `router.push`.
- Model: `claude-sonnet-4-6`.

## v3 — single streaming call

- This is a single-shot streaming `messages.create` call with web search enabled. The model decides what to search but does not loop. If you find yourself wanting to add iteration, retry-on-result-quality, or memory beyond the diary table — stop. That's where v2 went wrong.
- Streaming is for live UI feedback only — `runs.stage` / `stage_detail` are updated as `server_tool_use` content blocks for `web_search` arrive. The script throttles DB writes to ~1/sec.
- The diary is a deduplication tool, not a learning system. Last 14 days of summaries get pasted into the user message as "recently covered — don't repeat". Don't grow it into something more.
- No managed agents, no sessions, no environments, no memory stores. Plain Anthropic API only.
- One rating per item; latest click wins (unchanged from v2). Ratings are stored but not yet fed back into the prompt — that's a later optional addition.

## Ratings

- One row per item, latest click wins (UNIQUE index on `item_id`, ON CONFLICT DO UPDATE).
- Optimistic UI in Shell.tsx — flip immediately, then POST to `/api/rate`.

## Token usage and cost

- Token usage comes from `finalMessage.usage`. Input total = `input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0)`.
- Pricing constants live at the top of `scripts/scout.ts` (`SONNET_INPUT_USD_PER_MTOK = 3`, `SONNET_OUTPUT_USD_PER_MTOK = 15`). Hardcoded for `claude-sonnet-4-6`.
- The cost stored in `runs.cost_usd` is an estimate. It does not adjust for cache pricing and does not include web_search per-query fees ($10/1k searches, billed separately). Acceptable for a top-of-page indicator.
