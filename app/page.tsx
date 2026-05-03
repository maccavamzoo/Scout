import { sql } from '@/lib/db';
import type { ItemType, LatestItem, LatestResponse, Rating, RunRow } from '@/lib/types';
import { Shell } from './Shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getLatest(): Promise<LatestResponse> {
  const db = sql();

  const runs = (await db`
    SELECT id, ran_at, status, sources_checked, items_found, error, stage, stage_detail
    FROM runs
    ORDER BY ran_at DESC
    LIMIT 1
  `) as Array<
    Pick<RunRow, 'id' | 'ran_at' | 'status' | 'sources_checked' | 'items_found' | 'error' | 'stage' | 'stage_detail'>
  >;

  if (runs.length === 0) {
    return {
      status: 'done',
      stage: null,
      stage_detail: null,
      ran_at: new Date().toISOString(),
      error: null,
      sources_checked: 0,
      items_found: 0,
      items: [],
    };
  }

  const run = runs[0];
  const items: LatestItem[] =
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

  return {
    status: run.status,
    stage: run.stage,
    stage_detail: run.stage_detail,
    ran_at: run.ran_at,
    error: run.error,
    sources_checked: run.sources_checked,
    items_found: run.items_found,
    items,
  };
}

export default async function Page() {
  const data = await getLatest();
  return <Shell initial={data} />;
}
