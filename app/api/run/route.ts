import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STALE_AFTER_MS = 10 * 60 * 1000;

// Best-effort cleanup of a stuck session at Anthropic. Mirrors the orchestrator's
// own endSession() — interrupt then archive. Skips silently if no API key is
// set on the deployment (the next orchestrator run will time out the agent
// eventually on its own internal limits).
async function endStuckSession(sessionId: string): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    const client = new Anthropic();
    try {
      await client.beta.sessions.events.send(sessionId, {
        events: [{ type: 'user.interrupt' }],
      } as any);
    } catch {
      /* ignore */
    }
    try {
      await client.beta.sessions.archive(sessionId);
    } catch {
      /* ignore */
    }
  } catch {
    /* swallow — this is best-effort */
  }
}

function timestampMs(value: string | Date | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? 0 : t;
}

export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/repo"

  if (!token || !repo) {
    return NextResponse.json({ ok: false, error: 'GITHUB_TOKEN or GITHUB_REPO not set' }, { status: 500 });
  }

  // Guard against double-billing — if the previous run is still mid-flight, refuse.
  // Wrapped because the query touches columns added by recent schema patches
  // (session_id especially); if the migration hasn't been run, we'd rather
  // dispatch unguarded than block the user entirely.
  const db = sql();
  try {
    const recent = (await db`
      SELECT id, session_id, stage_updated_at, ran_at
      FROM runs
      WHERE status IN ('running', 'pending')
      ORDER BY ran_at DESC
      LIMIT 1
    `) as Array<{
      id: string;
      session_id: string | null;
      stage_updated_at: string | Date | null;
      ran_at: string | Date;
    }>;

    if (recent.length > 0) {
      const row = recent[0];
      const lastTouchMs = timestampMs(row.stage_updated_at) || timestampMs(row.ran_at);
      const ageMs = Date.now() - lastTouchMs;
      if (ageMs < STALE_AFTER_MS) {
        return NextResponse.json(
          { ok: false, reason: 'already_running' },
          { status: 409 },
        );
      }
      // Stale — clean up the orphaned session and mark the row failed before dispatching.
      if (row.session_id) {
        await endStuckSession(row.session_id);
      }
      await db`
        UPDATE runs
        SET status = 'failed',
            error = 'orchestrator process did not finish — cleaned up by /api/run',
            stage = NULL,
            stage_detail = NULL,
            stage_updated_at = NOW()
        WHERE id = ${row.id}
      `;
    }
  } catch (err) {
    console.error('[/api/run] double-billing guard skipped (likely missing schema migration):', err);
    // Fall through and dispatch — the guard is a nice-to-have, not essential.
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/scout.yml/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ ok: false, error: text }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
