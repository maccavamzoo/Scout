ASK IF YOU'RE CONFUSED.

## Setup

1. Create a Neon database and run `schema.sql` in the SQL editor.
2. Set GitHub Actions secrets: `ANTHROPIC_API_KEY`, `DATABASE_URL`.
3. Set Vercel env vars: `DATABASE_URL`, `GITHUB_TOKEN`, `GITHUB_REPO` (`owner/repo`).
4. Deploy to Vercel. Uncomment the `cron` line in `.github/workflows/scout.yml` when ready to go live.

## How it works

A GitHub Actions workflow runs `scripts/scout.ts`, which makes a single streaming `messages.create` call to `claude-sonnet-4-6` with the `web_search` tool enabled. Claude decides where to look, searches the web, and returns a JSON payload of 4–8 cycling news items.

The script writes items to Neon and updates `runs.stage` / `stage_detail` as searches arrive, so the page shows live progress. A `diary` table stores a one-line summary of each run to prevent repeating the same items within 14 days.

The page (`app/page.tsx` + `app/Shell.tsx`) reads the latest run, polls `/api/latest` while a run is active, and renders cards with thumbs-up/thumbs-down rating buttons.
