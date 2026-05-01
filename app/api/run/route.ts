import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/repo"

  if (!token || !repo) {
    return NextResponse.json({ ok: false, error: 'GITHUB_TOKEN or GITHUB_REPO not set' }, { status: 500 });
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
