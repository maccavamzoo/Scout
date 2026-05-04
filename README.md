# Scout (v2)

A personal cycling-news agent for Bikotic, running on Anthropic's Managed Agents.

The agent decides where to look every morning, finds new bike releases / leaks / race tech / value comparisons, learns from Ben's thumbs ratings over time, and writes findings to a Next.js page on Vercel.

## Setup

1. **Neon** — create a database, paste `schema.sql` into the Neon SQL editor and run it. (For an existing v1 database, the `ALTER TABLE … IF NOT EXISTS` and `CREATE TABLE ratings …` blocks at the bottom are the only new bits — the rest is already in place.)
2. **Run the agent setup script** locally (or in Codespaces). This creates the agent, environment, and memory store on Anthropic. Re-run it whenever the system prompt in `scripts/setup-agent.ts` changes:

   ```
   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/setup-agent.ts
   ```

   It prints two `gh secret set` lines — copy/paste them into your shell to add `SCOUT_AGENT_ID` and `SCOUT_ENVIRONMENT_ID` to the repo's GitHub Actions secrets. (The memory store ID is stored on the agent's metadata; no third secret needed.)

3. **GitHub Actions secrets** (Settings → Secrets and variables → Actions). After step 2 you should have:
   - `ANTHROPIC_API_KEY`
   - `DATABASE_URL`
   - `SCOUT_AGENT_ID`
   - `SCOUT_ENVIRONMENT_ID`

   You can delete `YOUTUBE_API_KEY` if it's still around — v2 doesn't use it.

4. **Vercel** — deploy this repo, then set env vars in the project:
   - `DATABASE_URL` (same Neon URL)
   - `GITHUB_TOKEN` (fine-grained PAT, `actions:write` on this repo)
   - `GITHUB_REPO` (e.g. `maccavamzoo/scout`)
   - **Optional, for the "Credits remaining" header line:** `ANTHROPIC_ADMIN_KEY` (admin key with billing read access). If missing, the line is hidden — everything else still works.
   - **Optional, for stale-session cleanup from `/api/run`:** `ANTHROPIC_API_KEY` (the same one used in GitHub Actions). If missing, `/api/run` still refuses to start a new run while one is in flight, but it can't terminate orphaned Anthropic sessions when the orchestrator process crashes — those will time out on their own (~minutes).

5. **Trigger the first run** manually from the GitHub Actions tab (Scout workflow → Run workflow), or hit "Run now" on the deployed page. First run will be cold (no memory, no ratings); rate a few cards once it lands and the next run starts learning.

## Local dev

```
npm install --legacy-peer-deps
npm run dev
```

Run the orchestrator locally (needs `ANTHROPIC_API_KEY`, `DATABASE_URL`, `SCOUT_AGENT_ID`, `SCOUT_ENVIRONMENT_ID` in your shell):

```
npm run scout
```

## Files

- `scripts/setup-agent.ts` — agent + environment + memory store setup. **Canonical home of the system prompt.**
- `scripts/scout.ts` — daily orchestrator. ~200 lines. Glue, not pipeline.
- `app/page.tsx`, `app/Shell.tsx` — the morning page (SSR initial fetch + client poll + ratings)
- `app/api/latest/route.ts` — JSON of the latest run (with rating join)
- `app/api/run/route.ts` — triggers `workflow_dispatch`
- `app/api/rate/route.ts` — POST a thumbs up/down
- `lib/db.ts`, `lib/types.ts`
- `schema.sql` — Neon migration (manual)
- `CLUES.md` — conventions
