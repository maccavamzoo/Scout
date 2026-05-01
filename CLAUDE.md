# Scout

A personal cycling-news agent for Ben.

## Status

**Unbuilt.** This repo currently contains only the spec and the design. Your first job is to build the project.

## How to build

1. Read `SCOUT_BUILD_PROMPT.md` end-to-end. It is the authoritative spec — stack, repo structure, schema, agent logic, conventions, and build sequence.
2. Treat `Scout.html` as the visual source of truth. The OKLCH palette, DM Serif / DM Sans typography, card layout, animations, and "why this matters" italic block all come from this file. Do not invent your own design.
3. Execute the build sequence in §15 of the spec. Single comprehensive build, no scaffolding to fill in later.
4. When done, rewrite this `CLAUDE.md` to describe the built project (replace this "How to build" section with a "Project overview" + the conventions from `CLUES.md`).

## Conventions (apply during the build)

- TypeScript / Next.js 14 App Router / Tailwind / Neon Postgres
- `legacy-peer-deps=true` in `.npmrc`
- Anthropic SDK is instantiated **inside** route handlers and the scout script only. Never at module top-level.
- No date libraries — native `Intl` and `Date` only.
- Migrations are manual SQL via Neon's SQL editor. Output `schema.sql`; do not run it.
- All parallel work uses `Promise.all`.
- `window.location.href` for post-action navigation, not `router.push`.

## Working style

Direct and decisive. No "you may want to…", no fallback handling for cases the spec rules out. If the spec is silent on something, make a sensible call and document it briefly.

## Reference files

- `SCOUT_BUILD_PROMPT.md` — the spec. Source of truth for what to build.
- `Scout.html` — the design. Source of truth for how it looks.
