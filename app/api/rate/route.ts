import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  const { item_id, rating } = (body ?? {}) as { item_id?: unknown; rating?: unknown };
  if (typeof item_id !== 'string' || !item_id) {
    return NextResponse.json({ ok: false, error: 'item_id required' }, { status: 400 });
  }
  if (rating !== 'up' && rating !== 'down') {
    return NextResponse.json({ ok: false, error: 'rating must be up or down' }, { status: 400 });
  }

  const db = sql();
  await db`
    INSERT INTO ratings (item_id, rating)
    VALUES (${item_id}, ${rating})
    ON CONFLICT (item_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = NOW()
  `;

  return NextResponse.json({ ok: true });
}
