'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BalanceResponse, LatestItem, LatestResponse, Rating } from '@/lib/types';

const LOW_BALANCE_USD = 2;
const CONSOLE_URL = 'https://console.anthropic.com';

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  return `${Math.round(n / 1000)}k`;
}

function formatCost(usd: number): string {
  return `~$${usd.toFixed(2)}`;
}

function formatBalance(usd: number): string {
  return usd >= 100
    ? `$${usd.toFixed(0)}`
    : `$${usd.toFixed(2)}`;
}

function isCreditError(error: string | null): boolean {
  if (!error) return false;
  return /credit|balance|insufficient/i.test(error);
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
      return detail
        ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}…`
        : 'Deciding where to look today…';
    case 'collecting':
      return detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}…` : 'Checking sources…';
    case 'writing':
      return detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}…` : 'Saving the keepers…';
    default:
      return 'Just getting started…';
  }
}

function shiftDateUTC(yyyymmdd: string, deltaDays: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatArchiveDate(yyyymmdd: string): string {
  return new Date(`${yyyymmdd}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
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

function ThumbsIcon({ down, filled }: { down?: boolean; filled?: boolean }) {
  const path =
    'M3 8.5h2v6H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm4 0V5.7c0-.9.7-1.7 1.7-1.7.4 0 .7.3.7.7l-.4 2.3v1.5h3.7c.7 0 1.3.6 1.3 1.3l-.9 4c-.1.5-.6.9-1.2.9H7v-6Z';
  return (
    <svg viewBox="0 0 16 16" style={{ transform: down ? 'scaleY(-1)' : undefined }} aria-hidden="true">
      <path d={path} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

function ThumbButtons({
  rating,
  onRate,
}: {
  rating: Rating | null;
  onRate: (rating: Rating) => void;
}) {
  return (
    <div className="card-thumbs" role="group" aria-label="Rate this item">
      <button
        type="button"
        className={`thumb-btn${rating === 'up' ? ' is-active is-up' : ''}`}
        title="Thumbs up"
        aria-pressed={rating === 'up'}
        onClick={() => onRate('up')}
      >
        <ThumbsIcon filled={rating === 'up'} />
      </button>
      <button
        type="button"
        className={`thumb-btn${rating === 'down' ? ' is-active is-down' : ''}`}
        title="Thumbs down"
        aria-pressed={rating === 'down'}
        onClick={() => onRate('down')}
      >
        <ThumbsIcon down filled={rating === 'down'} />
      </button>
    </div>
  );
}

function YouTubeCard({
  item,
  onRate,
}: {
  item: LatestItem;
  onRate: (rating: Rating) => void;
}) {
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
      <ThumbButtons rating={item.rating} onRate={onRate} />
    </article>
  );
}

function WebCard({
  item,
  onRate,
}: {
  item: LatestItem;
  onRate: (rating: Rating) => void;
}) {
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
      <ThumbButtons rating={item.rating} onRate={onRate} />
    </article>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <svg className="empty-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="20" cy="20" r="14" />
        <path d="M13 20h14M20 13v14" opacity="0.4" />
        <path d="M20 20m-3 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0" opacity="0.3" />
      </svg>
      <h2>Nothing worth your time today.</h2>
      <p>Scout looked but nothing cleared the bar.</p>
    </div>
  );
}

function FailureBanner({
  error,
  ranAt,
  balanceUsd,
}: {
  error: string | null;
  ranAt: string;
  balanceUsd: number | null;
}) {
  const heading = isToday(ranAt) ? 'Scout failed this morning.' : 'Scout failed this run.';
  const showBalanceLine = isCreditError(error) && balanceUsd != null;
  return (
    <div className="status-banner status-banner--failed" role="alert">
      <h2>{heading}</h2>
      {error && <p className="status-banner-body">{error}</p>}
      {showBalanceLine && (
        <p className="status-banner-credits">
          Credits remaining: <strong>{formatBalance(balanceUsd!)}</strong> — top up at{' '}
          <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer">console.anthropic.com</a>
        </p>
      )}
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

export function Shell({
  initial,
  viewDate,
  isLive,
}: {
  initial: LatestResponse;
  viewDate: string | null;
  isLive: boolean;
}) {
  const [data, setData] = useState<LatestResponse>(initial);
  const [date, setDate] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const triggeredAtRef = useRef<number | null>(null);

  const fetchBalance = useCallback(async () => {
    try {
      const body = (await fetch('/api/balance', { cache: 'no-store' }).then((r) => r.json())) as BalanceResponse;
      setBalance(body.balance_usd);
    } catch {
      // Silent — page hides the line if balance is null.
    }
  }, []);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  useEffect(() => {
    if (!isLive) return;
    setDate(
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    );
  }, [isLive]);

  useEffect(() => {
    if (data.ran_at) setLastScanned(formatLastScanned(data.ran_at));
  }, [data.ran_at]);

  // Poll while running/pending — live view only.
  useEffect(() => {
    if (!isLive) return;
    if (data.status !== 'running' && data.status !== 'pending') return;
    const interval = setInterval(async () => {
      try {
        const fresh = (await fetch('/api/latest', { cache: 'no-store' }).then((r) => r.json())) as LatestResponse;
        setData((prev) => {
          if (
            triggeredAtRef.current != null &&
            (fresh.status === 'done' || fresh.status === 'failed') &&
            fresh.ran_at &&
            Date.parse(fresh.ran_at) < triggeredAtRef.current
          ) {
            return prev;
          }
          if (
            (fresh.status === 'done' || fresh.status === 'failed') &&
            prev.status !== fresh.status
          ) {
            triggeredAtRef.current = null;
            fetchBalance();
          }
          return fresh;
        });
      } catch {
        // Network blip — keep polling.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [data.status, fetchBalance, isLive]);

  const runNow = useCallback(async () => {
    if (running) return;
    triggeredAtRef.current = Date.now();
    setRunning(true);
    setMessage(null);
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
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { reason?: string } | null;
        if (body?.reason === 'already_running') {
          setMessage('Scout is already running — wait for it to finish before triggering another.');
        } else {
          setMessage('Could not start Scout.');
        }
      } else if (!res.ok) {
        setMessage('Could not start Scout. Check the GitHub token.');
      } else {
        fetchBalance();
      }
    } catch {
      setMessage('Could not start Scout. Check the GitHub token.');
    } finally {
      setTimeout(() => setRunning(false), 1500);
    }
  }, [running, fetchBalance]);

  const rateItem = useCallback((itemId: string, rating: Rating) => {
    setData((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === itemId ? { ...it, rating } : it)),
    }));
    fetch('/api/rate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, rating }),
    }).catch(() => {});
  }, []);

  const showSummary = isLive && data.status === 'done' && data.items.length > 0;

  const showRunUsage =
    isLive &&
    data.status === 'done' &&
    data.cost_usd != null &&
    data.input_tokens != null &&
    data.output_tokens != null;
  const totalTokens = (data.input_tokens ?? 0) + (data.output_tokens ?? 0);

  const showBalance = isLive && balance != null;
  const lowBalance = balance != null && balance < LOW_BALANCE_USD;

  // Navigation
  const backDisabled = isLive
    ? data.earliest_run_date === null
    : viewDate === data.earliest_run_date || data.earliest_run_date === null;

  const handleBack = () => {
    const fromDate = isLive ? todayUTC() : viewDate!;
    window.location.href = `/?date=${shiftDateUTC(fromDate, -1)}`;
  };

  const handleForward = () => {
    if (!viewDate) return;
    const next = shiftDateUTC(viewDate, 1);
    window.location.href = next === todayUTC() ? '/' : `/?date=${next}`;
  };

  // Content to render below the header
  const isEmptyDay = !isLive && data.ran_at === null;

  return (
    <main className="page">
      {isLive ? (
        <>
          <header className="header">
            <div className="header-left">
              <h1 className="greeting">Morning, Ben.</h1>
              <p className="date-line">{date}</p>
              {lastScanned && <p className="last-scanned">{lastScanned}</p>}
              {showRunUsage && (
                <p className="last-scanned">
                  This run: {formatTokens(totalTokens)} tokens · {formatCost(data.cost_usd!)}
                </p>
              )}
              {showBalance && !lowBalance && (
                <p className="last-scanned">Credits remaining: {formatBalance(balance!)}</p>
              )}
              {showBalance && lowBalance && (
                <p className="last-scanned credits-low">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M8 1.5L15 14H1L8 1.5Z M8 6V10 M8 11.5V12.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Credits low: {formatBalance(balance!)} —{' '}
                  <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                    top up at console.anthropic.com
                  </a>
                </p>
              )}
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
          <div className="day-nav day-nav--live">
            <button
              type="button"
              disabled={backDisabled}
              onClick={handleBack}
              aria-label="Previous day"
            >←</button>
          </div>
        </>
      ) : (
        <header className="archive-header">
          <h1 className="date-header">{formatArchiveDate(viewDate!)}</h1>
          <div className="day-nav">
            <button
              type="button"
              disabled={backDisabled}
              onClick={handleBack}
              aria-label="Previous day"
            >←</button>
            <button
              type="button"
              onClick={handleForward}
              aria-label="Next day"
            >→</button>
          </div>
        </header>
      )}

      {isLive && message && (
        <p className="summary" role="status">{message}</p>
      )}

      {showSummary && (
        <p className="summary">
          Scout found <strong>{data.items_found ?? data.items.length} thing{(data.items_found ?? data.items.length) === 1 ? '' : 's'}</strong>{' '}
          worth your time today.
        </p>
      )}

      <div className="divider" />

      {isEmptyDay ? (
        <div className="empty-day">No run on this day.</div>
      ) : data.status === 'failed' ? (
        <FailureBanner error={data.error} ranAt={data.ran_at!} balanceUsd={balance} />
      ) : data.status === 'running' || data.status === 'pending' ? (
        isLive ? <RunningBanner stage={data.stage} detail={data.stage_detail} /> : null
      ) : data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card-list">
          {data.items.map((item) =>
            item.type === 'youtube' ? (
              <YouTubeCard key={item.id} item={item} onRate={(r) => rateItem(item.id, r)} />
            ) : (
              <WebCard key={item.id} item={item} onRate={(r) => rateItem(item.id, r)} />
            ),
          )}
        </div>
      )}
    </main>
  );
}
