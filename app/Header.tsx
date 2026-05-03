'use client';

import { useEffect, useState } from 'react';

function formatLastScanned(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(now) - startOfDay(then)) / (1000 * 60 * 60 * 24));

  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');

  if (dayDelta <= 0) return `Last scanned ${time}`;
  if (dayDelta === 1) return `Last scanned yesterday at ${time}`;
  return `Last scanned ${dayDelta} days ago`;
}

export function HeaderClient({ ranAt }: { ranAt: string | null }) {
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
    if (ranAt) setLastScanned(formatLastScanned(ranAt));
  }, [ranAt]);

  async function runNow() {
    if (running) return;
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch('/api/run', { method: 'POST' });
      if (!res.ok) {
        setMessage('Could not start Scout. Check the GitHub token.');
      } else {
        setMessage('Scout is running. Refresh in a minute or two.');
      }
    } catch {
      setMessage('Could not start Scout. Check the GitHub token.');
    } finally {
      setTimeout(() => setRunning(false), 1500);
    }
  }

  return (
    <>
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
        <p className="summary" role="status">
          {message}
        </p>
      )}
    </>
  );
}
