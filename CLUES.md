# Conventions

## Core

- **Anthropic SDK** is instantiated **inside** API route handlers and the scout/setup scripts only. Never at module top-level.
- **No date libraries** — native `Intl` and `Date` only.
- **Migrations are manual SQL** via the Neon SQL editor. The `schema.sql` file is the source of truth; never run migrations from code.
- `legacy-peer-deps=true` in `.npmrc`.
- **`window.location.href`** for any post-action navigation, not `router.push`.
- One scout run = one row in `runs`, many rows in `items`. The page reads only the latest run.
- All parallel work uses `Promise.all`.

## v2 — Managed Agents

- **Agent definition lives in `scripts/setup-agent.ts`.** The system prompt there is the canonical agent brief — edit there, re-run the script to update. Each update creates a new immutable agent version; the runner picks up the latest version via `agents.retrieve(agentId).version`.
- **`scripts/scout.ts` is an orchestrator, not a pipeline.** It does not contain logic about sources, freshness, relevance, or judging — those are entirely the agent's domain. If you find yourself adding such logic to scout.ts, stop. That change belongs in the system prompt.
- **Cross-session memory uses a single Memory Store** named `scout-memory`, attached to every session via `resources[]` with `type: "memory_store"`. The store is mounted by the harness at `/mnt/memory/scout-memory/`, and the agent reads/writes it with the standard file tools. Docs: <https://platform.claude.com/docs/en/managed-agents/memory>.
- **The memory store ID is stashed on the agent's `metadata.scout_memory_store_id`** so the daily run only needs `SCOUT_AGENT_ID` and `SCOUT_ENVIRONMENT_ID` as secrets — no third secret for the memory store.
- **The agent writes results to `/mnt/session/outputs/results.json`** (not `/workspace/results.json` as v2 spec drafts say). `/mnt/session/outputs/` is the canonical agent→host file bridge captured by the Files API; the orchestrator downloads it via `client.beta.files.list({ scope_id: session.id })`. The Managed Agents beta header is required on that list call (Files endpoint, Managed Agents parameter).
- **The Managed Agents beta header `managed-agents-2026-04-01` is set automatically by the SDK** for `client.beta.{agents,environments,sessions,memoryStores}.*` calls. Pass it explicitly only on `client.beta.files.list({ scope_id })` (Files endpoint, Managed Agents parameter).
- **Stream-first ordering.** Open the SSE stream before sending the kickoff event — otherwise early events arrive buffered.
- **Idle gate.** Break on `session.status_terminated`, or on `session.status_idle` with `stop_reason.type !== 'requires_action'`. The idle status is transient otherwise.

## Ratings

- One rating per item; latest click wins. The schema's UNIQUE index on `ratings.item_id` enforces this — `/api/rate` upserts via `ON CONFLICT (item_id) DO UPDATE`.
- Ratings are not "togglable to no-rating" — to undo, click the other thumb. Keeps the API binary.
- The runner reads the last 14 days of ratings (joined to their `items` rows) and includes them in the daily user message so the agent has direct feedback signal.

## Token usage and cost

- Token usage is summed during the stream from `span.model_request_end` events. Each event carries a `model_usage` block with `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`. Input total = `input_tokens + cache_creation + cache_read`.
- Pricing constants live at the top of `scripts/scout.ts` (`OPUS_INPUT_USD_PER_MTOK`, `OPUS_OUTPUT_USD_PER_MTOK`). Hardcoded for `claude-opus-4-7` — the model the agent is configured for in `setup-agent.ts`. Update both places if the model changes.
- The cost stored in `runs.cost_usd` is an **estimate** that does not adjust for cache pricing (cache reads should be cheaper than fresh input). It will be slightly high for cache-heavy runs; acceptable for a top-of-page indicator.

## Credits remaining

- `/api/balance` is best-effort and falls back to `null` on failure. The page hides the line entirely when null.
- Tries `ANTHROPIC_ADMIN_KEY` first, then `ANTHROPIC_API_KEY`. The exact admin endpoint is not yet documented at a stable URL; the route attempts a couple of plausible paths (`/v1/organizations/me/balance`, `/v1/organizations/me/credits`) and parses common response field names. **Verify the endpoint once and replace the candidate list** with the canonical URL.
- 5-minute in-process cache so the page doesn't pound the API on every nav.
- Low-balance threshold is `LOW_BALANCE_USD` in `app/Shell.tsx` (currently $2). Below that, the meta line flips to coral with a warning icon and a "top up at console.anthropic.com" link.
