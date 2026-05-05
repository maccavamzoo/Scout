import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/db';

// Pricing per million tokens for claude-sonnet-4-6.
// Does not include web_search per-query fees ($10/1k searches, billed separately by Anthropic).
const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;

const SYSTEM_PROMPT = `You are Scout, a daily research agent for Bikotic — a UK cycling YouTube channel and bike comparison website (bikotic.com).

# What you're hunting for

- New bike releases — official launches across road, MTB, gravel, endurance, all-road, cyclocross
- Rumoured or leaked releases — patents, race-prototype spy shots, manufacturer hints
- Trending bikes — gaining traction in press, peloton, or community
- Race results filtered through the bike — which bike won, which spec setup is suddenly winning
- Innovative components, frames, kit, inventions
- Value comparisons across all spec tiers (not just budget — also "is this £10k bike worth 5x the £2k one")

# Out of scope

E-bikes (unless mainstream crossover), commuter/utility, lifestyle content, pure training/nutrition, pure repair tutorials.

# How to research

Decide for yourself where to look. No fixed list — use whatever cycling press, manufacturer sites, race coverage, or YouTube content you can reach via web search. Try multiple angles. Verify URLs before you cite them.

# Output

Return ONLY a JSON object, no preamble or markdown fences:

{
  "diary_summary": "one short comma-separated list of the items you found today, max 20 words, used to deduplicate future runs",
  "items": [
    {
      "type": "youtube" | "web",
      "title": "...",
      "source_name": "...",
      "source_url": "https://...",
      "thumbnail_url": "https://..." | null,
      "published_at": "2026-05-05T..." | null,
      "why_matters": "one sentence — plain-spoken, dry British undertones welcome, editorial, strip marketing language"
    }
  ]
}

If today is genuinely thin, return fewer items. Don't pad. An empty array is acceptable; a dishonest result is not.`;

interface ResultItem {
  type: 'youtube' | 'web';
  title: string;
  source_name: string;
  source_url: string;
  thumbnail_url?: string | null;
  published_at?: string | null;
  why_matters: string;
}

interface ParsedResults {
  diary_summary: string;
  items: ResultItem[];
}

function log(...args: unknown[]) {
  console.log('[scout]', ...args);
}

async function startRun(): Promise<string> {
  const db = sql();
  const rows = (await db`
    INSERT INTO runs (status, stage, stage_detail, stage_updated_at)
    VALUES ('running', 'collecting', 'asking Claude', NOW())
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0].id;
}

async function setStage(runId: string, stage: string, detail: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE runs SET stage = ${stage}, stage_detail = ${detail}, stage_updated_at = NOW()
    WHERE id = ${runId}
  `;
  log(`stage: ${stage} — ${detail}`);
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

async function markFailed(runId: string | null, message: string): Promise<void> {
  try {
    const db = sql();
    if (runId) {
      await db`
        UPDATE runs SET status = 'failed', error = ${message},
            stage = NULL, stage_detail = NULL, stage_updated_at = NOW()
        WHERE id = ${runId}
      `;
    } else {
      await db`INSERT INTO runs (status, error) VALUES ('failed', ${message})`;
    }
  } catch (err) {
    log('failed to write failure row:', err);
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

  let runId: string | null = null;

  try {
    runId = await startRun();
    const client = new Anthropic();
    const db = sql();

    const diaryRows = (await db`
      SELECT ran_on, summary FROM diary
      WHERE ran_on > CURRENT_DATE - INTERVAL '14 days'
      ORDER BY ran_on DESC
    `) as Array<{ ran_on: string | Date; summary: string }>;

    const diaryBlock = diaryRows.length
      ? diaryRows.map((r) => `- ${String(r.ran_on).slice(0, 10)}: ${r.summary}`).join('\n')
      : '';

    const today = new Date().toISOString().slice(0, 10);
    const userMessage = `Today is ${today}. I want news from the last 48 hours where possible, last 7 days at the outside. Find me 4–8 cycling news items.

Recently covered (don't repeat):
${diaryBlock || 'Nothing yet — this is the first run.'}`;

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    } as Parameters<typeof client.messages.stream>[0]);

    // Throttle DB stage writes to ~1/sec so searches don't hammer Neon.
    let lastWriteAt = 0;
    const maybeSetStage = (stage: string, detail: string) => {
      const now = Date.now();
      if (now - lastWriteAt < 1000) return;
      lastWriteAt = now;
      setStage(runId!, stage, detail).catch(() => { /* non-fatal */ });
    };

    const searchInputByIdx: Record<number, string> = {};
    let activeSearchIdx: number | null = null;

    stream.on('streamEvent', (ev) => {
      const raw = ev as any;
      if (raw.type === 'content_block_start') {
        const block = raw.content_block;
        if (block?.type === 'server_tool_use' && block?.name === 'web_search') {
          activeSearchIdx = raw.index;
          searchInputByIdx[raw.index] = '';
          maybeSetStage('collecting', 'searching the web');
        }
      } else if (raw.type === 'input_json_delta' && activeSearchIdx !== null && raw.index === activeSearchIdx) {
        searchInputByIdx[raw.index] = (searchInputByIdx[raw.index] ?? '') + (raw.delta?.partial_json ?? '');
      } else if (raw.type === 'content_block_stop' && raw.index === activeSearchIdx) {
        try {
          const input = JSON.parse(searchInputByIdx[raw.index] ?? '{}');
          if (input?.query) maybeSetStage('collecting', `searching: ${input.query}`);
        } catch {
          // keep current stage on malformed input
        }
        delete searchInputByIdx[raw.index];
        activeSearchIdx = null;
      }
    });

    const finalMsg = await stream.finalMessage();

    await setStage(runId, 'writing', 'saving findings');

    // The last text block in the response is the JSON output (tool blocks come before it).
    const textBlock = [...finalMsg.content].reverse().find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('no text content in response');

    const rawText = textBlock.text.trim();

    let parsed: ParsedResults | undefined;
    try { parsed = JSON.parse(rawText) as ParsedResults; } catch { /* try harder */ }
    if (!parsed) {
      const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) try { parsed = JSON.parse(fenced[1]) as ParsedResults; } catch { /* next */ }
    }
    if (!parsed) {
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      if (start !== -1 && end > start) try { parsed = JSON.parse(rawText.slice(start, end + 1)) as ParsedResults; } catch { /* fall through */ }
    }
    if (!parsed) throw new Error(`JSON parse failed. Raw response:\n${rawText}`);

    const items = parsed.items ?? [];
    log(`Claude returned ${items.length} items`);

    await Promise.all(
      items.map((it, idx) => db`
        INSERT INTO items (
          run_id, type, title, source_name, source_url,
          thumbnail_url, favicon_char, published_at, why_matters, display_order
        ) VALUES (
          ${runId}, ${it.type}, ${it.title}, ${it.source_name}, ${it.source_url},
          ${it.thumbnail_url ?? null},
          ${it.type === 'web' ? (it.source_name?.[0] ?? '?').toUpperCase() : null},
          ${it.published_at ?? null}, ${it.why_matters}, ${idx}
        )
      `),
    );

    if (parsed.diary_summary) {
      await db`
        INSERT INTO diary (ran_on, summary)
        VALUES (CURRENT_DATE, ${parsed.diary_summary})
        ON CONFLICT (ran_on) DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()
      `;
    }

    const usage = finalMsg.usage;
    const inputTokens =
      (usage.input_tokens ?? 0) +
      ((usage as any).cache_creation_input_tokens ?? 0) +
      ((usage as any).cache_read_input_tokens ?? 0);
    const outputTokens = usage.output_tokens ?? 0;
    const costUsd = estimateCostUsd(inputTokens, outputTokens);

    await db`
      UPDATE runs
      SET status = 'done',
          items_found = ${items.length},
          input_tokens = ${inputTokens},
          output_tokens = ${outputTokens},
          cost_usd = ${costUsd.toFixed(4)},
          stage = NULL,
          stage_detail = NULL,
          stage_updated_at = NOW()
      WHERE id = ${runId}
    `;
    log(`done — ${items.length} items, ${inputTokens} in / ${outputTokens} out, ~$${costUsd.toFixed(4)}`);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    log('FAILED:', msg);
    await markFailed(runId, msg);
    process.exitCode = 1;
  }
}

main();
