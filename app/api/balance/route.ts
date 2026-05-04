import { NextResponse } from 'next/server';
import type { BalanceResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 5-minute in-process cache so the page doesn't hammer the API on every nav.
let cached: { at: number; body: BalanceResponse } | null = null;
const TTL_MS = 5 * 60 * 1000;

// Best-effort: ask the Anthropic Admin API for the org's prepaid balance.
// The exact endpoint is not yet documented at a stable URL, so we try a couple
// of plausible paths and fail open. If neither admin key nor regular key is
// present, we just return null — the page hides the line. The endpoint and key
// requirement should be verified once and updated here.
async function fetchBalance(): Promise<BalanceResponse> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const key = adminKey || apiKey;
  if (!key) return { balance_usd: null, source: 'no-key' };

  const candidates = [
    'https://api.anthropic.com/v1/organizations/me/balance',
    'https://api.anthropic.com/v1/organizations/me/credits',
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      // Look for any plausible balance field. Cents → dollars if needed.
      const candidatesValues = [
        data.balance_usd,
        data.credit_balance_usd,
        data.balance,
        data.amount_usd,
      ];
      for (const v of candidatesValues) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          return { balance_usd: v, source: url };
        }
        if (typeof v === 'string' && v && !Number.isNaN(Number(v))) {
          return { balance_usd: Number(v), source: url };
        }
      }
      const cents = data.balance_cents ?? data.amount_cents;
      if (typeof cents === 'number') return { balance_usd: cents / 100, source: url };
    } catch {
      // try next
    }
  }

  return { balance_usd: null, source: 'unavailable' };
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    return NextResponse.json(cached.body);
  }
  const body = await fetchBalance();
  cached = { at: now, body };
  return NextResponse.json(body);
}
