# Scout

A personal cycling-news agent. Each morning a GitHub Actions workflow runs the agent, which plans where to look (Opus 4.7), collects from YouTube + web (parallel), judges relevance (Haiku 4.5), and writes results to Neon. A Next.js page on Vercel reads the latest run and renders it as an editorial card list.

## Setup

1. **Neon** — create a database, paste `schema.sql` into the Neon SQL editor and run it.
2. **YouTube Data API key** — create one in Google Cloud Console (enable "YouTube Data API v3").
3. **GitHub Actions secrets** (Settings → Secrets and variables → Actions):
   - `ANTHROPIC_API_KEY`
   - `YOUTUBE_API_KEY`
   - `DATABASE_URL`
4. **Vercel** — deploy this repo, then set env vars in the project:
   - `DATABASE_URL` (same Neon URL)
   - `GITHUB_TOKEN` (fine-grained PAT, `actions:write` on this repo)
   - `GITHUB_REPO` (e.g. `maccavamzoo/scout`)
5. Fill in `config/channel.ts` with the channel profile and any starter YouTube handles.
6. Trigger the first run manually from the GitHub Actions tab (Scout workflow → Run workflow), or hit "Run now" on the deployed page.

## Local dev

```
npm install --legacy-peer-deps
npm run dev
```

Run the agent locally (requires the three Actions env vars in your shell):

```
npm run scout
```

## Files

- `scripts/scout.ts` — the agent
- `app/page.tsx` — the morning page
- `app/api/latest/route.ts` — JSON of the latest done run
- `app/api/run/route.ts` — triggers `workflow_dispatch`
- `lib/` — db, types, youtube helpers
- `config/channel.ts` — channel profile (fill in)
- `schema.sql` — Neon migration (manual)
- `CLUES.md` — conventions
