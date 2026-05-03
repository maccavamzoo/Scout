import { sql } from '@/lib/db';
import type { ItemRow, LatestResponse, RunRow } from '@/lib/types';
import { HeaderClient } from './Header';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getLatest(): Promise<LatestResponse> {
  const db = sql();

  const runs = (await db`
    SELECT id, ran_at, status, sources_checked, items_found, error
    FROM runs
    ORDER BY ran_at DESC
    LIMIT 1
  `) as Array<Pick<RunRow, 'id' | 'ran_at' | 'status' | 'sources_checked' | 'items_found' | 'error'>>;

  if (runs.length === 0) {
    return {
      status: 'done',
      ran_at: new Date().toISOString(),
      error: null,
      sources_checked: 0,
      items_found: 0,
      items: [],
    };
  }

  const run = runs[0];
  const items =
    run.status === 'done'
      ? ((await db`
          SELECT id, type, title, source_name, source_url, thumbnail_url,
                 favicon_char, published_at, why_matters
          FROM items
          WHERE run_id = ${run.id}
          ORDER BY display_order ASC
        `) as ItemRow[])
      : [];

  return {
    status: run.status,
    ran_at: run.ran_at,
    error: run.error,
    sources_checked: run.sources_checked,
    items_found: run.items_found,
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
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function LinkOut({ href }: { href: string }) {
  return (
    <a href={href} className="card-link" title="Open source" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 10L10 2M5.5 2H10v4.5" />
      </svg>
    </a>
  );
}

function YouTubeCard({ item }: { item: LatestResponse['items'][number] }) {
  return (
    <article className="card card--youtube">
      <div className="card-inner">
        <div className="card-thumb">
          {item.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnail_url} alt="" />
          ) : (
            <div className="card-thumb-placeholder">
              <span>youtube thumbnail</span>
            </div>
          )}
          <div className="yt-badge">
            <svg viewBox="0 0 10 10" fill="currentColor"><polygon points="3,2 8,5 3,8" /></svg>
            YouTube
          </div>
        </div>
        <div className="card-body">
          <div className="card-meta">
            <span className="source-name">{item.source_name}</span>
            {item.published_at && <span className="meta-dot" />}
            {item.published_at && <span className="time-ago">{timeAgo(item.published_at)}</span>}
            <span className="meta-dot" />
            <span className="medium-tag medium-tag--youtube">
              <svg viewBox="0 0 10 10" fill="currentColor"><polygon points="3,2 8,5 3,8" /></svg>
              Video
            </span>
          </div>
          <h2 className="card-title">{item.title}</h2>
          <div className="card-why">
            <p>{item.why_matters}</p>
          </div>
        </div>
      </div>
      <LinkOut href={item.source_url} />
    </article>
  );
}

function WebCard({ item }: { item: LatestResponse['items'][number] }) {
  const ch = item.favicon_char ?? (item.source_name?.[0] ?? '?').toUpperCase();
  return (
    <article className="card card--web">
      <div className="card-inner">
        <div className="card-favicon-block">
          <span className="favicon-char">{ch}</span>
        </div>
        <div className="card-body">
          <div className="card-meta">
            <span className="source-name">{item.source_name}</span>
            {item.published_at && <span className="meta-dot" />}
            {item.published_at && <span className="time-ago">{timeAgo(item.published_at)}</span>}
            <span className="meta-dot" />
            <span className="medium-tag medium-tag--web">
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <circle cx="5" cy="5" r="4" />
                <path d="M1 5h8M5 1c-1.3 1.5-2 2.8-2 4s.7 2.5 2 4M5 1c1.3 1.5 2 2.8 2 4s-.7 2.5-2 4" />
              </svg>
              Web
            </span>
          </div>
          <h2 className="card-title">{item.title}</h2>
          <div className="card-why">
            <p>{item.why_matters}</p>
          </div>
        </div>
      </div>
      <LinkOut href={item.source_url} />
    </article>
  );
}

function EmptyState({ sourcesChecked }: { sourcesChecked: number }) {
  return (
    <div className="empty-state">
      <svg className="empty-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="20" cy="20" r="14" />
        <path d="M13 20h14M20 13v14" opacity="0.4" />
        <path d="M20 20m-3 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0" opacity="0.3" />
      </svg>
      <h2>Nothing worth your time today.</h2>
      <p>Scout looked at {sourcesChecked} source{sourcesChecked === 1 ? '' : 's'} — nothing cleared the bar.</p>
    </div>
  );
}

function FailureBanner({ error, ranAt }: { error: string | null; ranAt: string }) {
  const heading = isToday(ranAt) ? 'Scout failed this morning.' : 'Scout failed this run.';
  return (
    <div className="status-banner status-banner--failed" role="alert">
      <h2>{heading}</h2>
      {error && <p className="status-banner-body">{error}</p>}
      <p className="status-banner-foot">
        Try <strong>Run now</strong> when ready, or check the GitHub Actions log for full details.
      </p>
    </div>
  );
}

function RunningBanner() {
  return (
    <div className="status-banner status-banner--running" role="status">
      <h2>Scout is running.</h2>
      <p className="status-banner-body">Refresh in a minute or two.</p>
    </div>
  );
}

export default async function Page() {
  const data = await getLatest();
  const showSummary = data.status === 'done';

  return (
    <main className="page">
      <HeaderClient ranAt={data.ran_at} />

      {showSummary && (
        <p className="summary">
          Scout checked <strong>{data.sources_checked ?? 0} source{(data.sources_checked ?? 0) === 1 ? '' : 's'}</strong>
          {' · '}
          found <strong>{data.items_found ?? 0} thing{(data.items_found ?? 0) === 1 ? '' : 's'}</strong> worth your time.
        </p>
      )}

      <div className="divider" />

      {data.status === 'failed' ? (
        <FailureBanner error={data.error} ranAt={data.ran_at} />
      ) : data.status === 'running' || data.status === 'pending' ? (
        <RunningBanner />
      ) : data.items.length === 0 ? (
        <EmptyState sourcesChecked={data.sources_checked ?? 0} />
      ) : (
        <div className="card-list">
          {data.items.map((item) =>
            item.type === 'youtube' ? (
              <YouTubeCard key={item.id} item={item} />
            ) : (
              <WebCard key={item.id} item={item} />
            ),
          )}
        </div>
      )}
    </main>
  );
}
