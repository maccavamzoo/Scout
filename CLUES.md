# Conventions

- **Anthropic SDK** is instantiated **inside** API route handlers and the scout script only. Never at module top-level.
- **No date libraries** — native `Intl` and `Date` only.
- **Migrations are manual SQL** via the Neon SQL editor. The `schema.sql` file is the source of truth; never run migrations from code.
- `legacy-peer-deps=true` in `.npmrc`.
- **`window.location.href`** for any post-action navigation, not `router.push`.
- One scout run = one row in `runs`, many rows in `items`. The page reads only the latest `status='done'` run.
- Scout caps: 5 YouTube channels, 3 web searches, 30 items judged, 8 items surfaced.
- All parallel work uses `Promise.all`. Sequential calls inside a parallel-able loop are a bug.
- Models: `claude-opus-4-7` for planning, `claude-haiku-4-5-20251001` for judging.
- Anthropic web search via the `web_search_20250305` tool. No third-party search API.
