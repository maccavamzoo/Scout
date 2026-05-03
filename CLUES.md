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
