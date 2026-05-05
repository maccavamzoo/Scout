import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STALE_AFTER_MS = 10 * 60 * 1000;

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
  const db = sql();
  try {
    const recent = (await db`
      SELECT id, stage_updated_at, ran_at
      FROM runs
      WHERE status IN ('running', 'pending')
      ORDER BY ran_at DESC
      LIMIT 1
    `) as Array<{
      id: string;
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
      // Stale — mark the row failed before dispatching.
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
    console.error('[/api/run] double-billing guard skipped:', err);
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
