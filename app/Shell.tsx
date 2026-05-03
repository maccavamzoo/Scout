'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LatestResponse } from '@/lib/types';

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

function formatLastScanned(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(now) - startOfDay(then)) / (1000 * 60 * 60 * 24));
  const time = then
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '');
  if (dayDelta <= 0) return `Last scanned ${time}`;
  if (dayDelta === 1) return `Last scanned yesterday at ${time}`;
  return `Last scanned ${dayDelta} days ago`;
}

function stageLine(stage: string | null, detail: string | null): string {
  switch (stage) {
    case 'planning':
      return 'Deciding where to look today…';
    case 'collecting':
      return detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}…` : 'Checking sources…';
    case 'judging':
      return detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}…` : 'Judging items…';
    case 'writing':
      return 'Saving the keepers…';
    default:
      return 'Just getting started…';
  }
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
          <div className="card-why"><p>{item.why_matters}</p></div>
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
          <div className="card-why"><p>{item.why_matters}</p></div>
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

function RunningBanner({ stage, detail }: { stage: string | null; detail: string | null }) {
  return (
    <div className="status-banner status-banner--running" role="status" aria-live="polite">
      <h2>Scout is working.</h2>
      <p className="status-banner-body status-live">
        <span className="live-dot" aria-hidden="true" />
        {stageLine(stage, detail)}
      </p>
    </div>
  );
}

export function Shell({ initial }: { initial: LatestResponse }) {
  const [data, setData] = useState<LatestResponse>(initial);
  const [date, setDate] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDate(
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    );
  }, []);

  useEffect(() => {
    if (data.ran_at) setLastScanned(formatLastScanned(data.ran_at));
  }, [data.ran_at]);

  // Poll while running/pending.
  useEffect(() => {
    if (data.status !== 'running' && data.status !== 'pending') return;
    const interval = setInterval(async () => {
      try {
        const fresh = (await fetch('/api/latest', { cache: 'no-store' }).then((r) => r.json())) as LatestResponse;
        setData(fresh);
      } catch {
        // Network blip — keep polling.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [data.status]);

  const runNow = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    // Optimistic: flip to pending immediately so the UI reacts before the next poll.
    setData((prev) => ({
      ...prev,
      status: 'pending',
      stage: 'planning',
      stage_detail: 'deciding where to look',
      error: null,
      items: [],
    }));
    try {
      const res = await fetch('/api/run', { method: 'POST' });
      if (!res.ok) {
        setMessage('Could not start Scout. Check the GitHub token.');
      }
    } catch {
      setMessage('Could not start Scout. Check the GitHub token.');
    } finally {
      setTimeout(() => setRunning(false), 1500);
    }
  }, [running]);

  const showSummary = data.status === 'done';

  return (
    <main className="page">
      <header className="header">
        <div className="header-left">
          <h1 className="greeting">Morning, Ben.</h1>
          <p className="date-line">{date}</p>
          {lastScanned && <p className="last-scanned">{lastScanned}</p>}
        </div>
        <div className={`header-actions${running ? ' running' : ''}`}>
          <button className="btn-run" type="button" onClick={runNow}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1.5 4.5 1.5 1.5 4.5 1.5" />
              <path d="M1.5 4.5A6.5 6.5 0 1 1 3.4 10" />
            </svg>
            Run now
          </button>
          <button className="btn-cog" type="button" title="Settings (coming soon)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M2.93 2.93l1.06 1.06M12.01 12.01l1.06 1.06M2.93 13.07l1.06-1.06M12.01 3.99l1.06-1.06" />
            </svg>
          </button>
        </div>
      </header>

      {message && (
        <p className="summary" role="status">{message}</p>
      )}

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
        <RunningBanner stage={data.stage} detail={data.stage_detail} />
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
