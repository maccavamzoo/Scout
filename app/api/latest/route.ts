import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { LatestResponse, ItemRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const db = sql();

  const runs = await db`
    SELECT id, ran_at, sources_checked, items_found
    FROM runs
    WHERE status = 'done'
    ORDER BY ran_at DESC
    LIMIT 1
  ` as Array<{ id: string; ran_at: string; sources_checked: number | null; items_found: number | null }>;

  if (runs.length === 0) {
    const empty: LatestResponse = {
      ran_at: new Date().toISOString(),
      sources_checked: 0,
      items_found: 0,
      items: [],
    };
    return NextResponse.json(empty);
  }

  const run = runs[0];
  const items = await db`
    SELECT id, type, title, source_name, source_url, thumbnail_url,
           favicon_char, published_at, why_matters
    FROM items
    WHERE run_id = ${run.id}
    ORDER BY display_order ASC
  ` as ItemRow[];

  const body: LatestResponse = {
    ran_at: run.ran_at,
    sources_checked: run.sources_checked ?? 0,
    items_found: run.items_found ?? 0,
    items: items.map((it) => ({
      id: it.id,
      type: it.type,
      title: it.title,
      source_name: it.source_name,
      source_url: it.source_url,
      thumbnail_url: it.thumbnail_url,
      favicon_char: it.favicon_char,
      published_at: it.published_at,
      why_matters: it.why_matters,
    })),
  };

  return NextResponse.json(body);
}
