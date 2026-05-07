import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { LatestResponse, RunRow, ItemType, Rating } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // YYYY-MM-DD or null

  const db = sql();

  const earliestRows = (await db`
    SELECT TO_CHAR(MIN(ran_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS earliest
    FROM runs
  `) as Array<{ earliest: string | null }>;
  const earliest_run_date = earliestRows[0]?.earliest ?? null;

  const runs = date
    ? ((await db`
        SELECT id, ran_at, status, items_found, error,
               stage, stage_detail, input_tokens, output_tokens, cost_usd
        FROM runs
        WHERE DATE(ran_at AT TIME ZONE 'UTC') = ${date}::date
        ORDER BY ran_at DESC
        LIMIT 1
      `) as Array<Pick<RunRow, 'id' | 'ran_at' | 'status' | 'items_found' | 'error' | 'stage' | 'stage_detail' | 'input_tokens' | 'output_tokens' | 'cost_usd'>>)
    : ((await db`
        SELECT id, ran_at, status, items_found, error,
               stage, stage_detail, input_tokens, output_tokens, cost_usd
        FROM runs
        ORDER BY ran_at DESC
        LIMIT 1
      `) as Array<Pick<RunRow, 'id' | 'ran_at' | 'status' | 'items_found' | 'error' | 'stage' | 'stage_detail' | 'input_tokens' | 'output_tokens' | 'cost_usd'>>);

  if (runs.length === 0) {
    const empty: LatestResponse = {
      status: 'done',
      stage: null,
      stage_detail: null,
      ran_at: date ? null : new Date().toISOString(),
      error: null,
      items_found: 0,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      items: [],
      earliest_run_date,
    };
    return NextResponse.json(empty);
  }

  const run = runs[0];

  const items =
    run.status === 'done'
      ? ((await db`
          SELECT i.id, i.type, i.title, i.source_name, i.source_url, i.thumbnail_url,
                 i.favicon_char, i.published_at, i.why_matters, r.rating
          FROM items i
          LEFT JOIN ratings r ON r.item_id = i.id
          WHERE i.run_id = ${run.id}
          ORDER BY i.display_order ASC
        `) as Array<{
          id: string;
          type: ItemType;
          title: string;
          source_name: string;
          source_url: string;
          thumbnail_url: string | null;
          favicon_char: string | null;
          published_at: string | null;
          why_matters: string;
          rating: Rating | null;
        }>)
      : [];

  const rawCost = run.cost_usd as unknown;
  const cost_usd =
    rawCost == null ? null : typeof rawCost === 'number' ? rawCost : Number(rawCost);

  const body: LatestResponse = {
    status: run.status,
    stage: run.stage,
    stage_detail: run.stage_detail,
    ran_at: run.ran_at,
    error: run.error,
    items_found: run.items_found,
    input_tokens: run.input_tokens,
    output_tokens: run.output_tokens,
    cost_usd,
    items,
    earliest_run_date,
  };

  return NextResponse.json(body);
}
