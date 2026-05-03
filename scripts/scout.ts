// Scout agent — runs in GitHub Actions.
// Plan (Opus 4.7) → Collect (parallel) → Judge (Haiku 4.5, parallel) → Write.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/db';
import { recentVideos, resolveChannelId } from '../lib/youtube';
import { CHANNEL_PROFILE, STARTER_YOUTUBE_CHANNELS } from '../config/channel';
import type { CandidateItem, PlanManifest } from '../lib/types';

const PLANNER_MODEL = 'claude-opus-4-7';
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';

const MAX_YT_CHANNELS = 5;
const MAX_WEB_SEARCHES = 3;
const MAX_CANDIDATES = 30;
const MAX_FINAL = 8;

function log(...args: unknown[]) {
  console.log('[scout]', ...args);
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey });
}

// ── Memory ───────────────────────────────────────────────────────────────────

async function recentMemorySummary(): Promise<string> {
  const db = sql();
  const rows = await db`
    SELECT source, last_checked, notes
    FROM scout_memory
    WHERE last_checked > NOW() - INTERVAL '7 days'
    ORDER BY last_checked DESC
    LIMIT 50
  ` as Array<{ source: string; last_checked: string; notes: string | null }>;

  if (rows.length === 0) return '(no sources checked in the last 7 days)';
  return rows
    .map((r) => `- ${r.source} — last checked ${new Date(r.last_checked).toISOString()}${r.notes ? ` (${r.notes})` : ''}`)
    .join('\n');
}

// ── Step 1: Plan ─────────────────────────────────────────────────────────────

async function plan(anthropic: Anthropic): Promise<PlanManifest> {
  const memory = await recentMemorySummary();
  const today = new Date().toISOString().slice(0, 10);

  const starter = STARTER_YOUTUBE_CHANNELS.length
    ? `Starter list of YouTube channels (you may pick from these or find new ones): ${STARTER_YOUTUBE_CHANNELS.join(', ')}`
    : 'No starter list — pick wisely from what you know.';

  const prompt = `You are Scout, a planning agent for a personal cycling-news feed.

CHANNEL PROFILE:
${CHANNEL_PROFILE}

${starter}

RECENT MEMORY (last 7 days of sources checked):
${memory}

Today's date: ${today}.

Decide where to look today. Pick a mix of YouTube channels and open web searches that would surface what's most relevant to this channel right now. Avoid hammering the same source on consecutive days unless something major is breaking.

Hard caps: max ${MAX_YT_CHANNELS} YouTube channels, max ${MAX_WEB_SEARCHES} web searches.

Respond with ONLY a JSON object — no prose, no code fences — matching this shape exactly:
{
  "reasoning": "one paragraph explaining today's picks",
  "youtube_channels": [{ "handle_or_query": "@gcn", "why": "..." }],
  "web_searches": [{ "query": "...", "why": "..." }]
}`;

  const res = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const json = extractJson(text);
  const parsed = JSON.parse(json) as PlanManifest;

  parsed.youtube_channels = (parsed.youtube_channels ?? []).slice(0, MAX_YT_CHANNELS);
  parsed.web_searches = (parsed.web_searches ?? []).slice(0, MAX_WEB_SEARCHES);
  return parsed;
}

function extractJson(text: string): string {
  // Strip code fences if present, then find the outermost JSON object.
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model response: ' + text.slice(0, 300));
  return stripped.slice(start, end + 1);
}

// ── Step 2: Collect ──────────────────────────────────────────────────────────

async function collectYouTube(handleOrQuery: string): Promise<{ source: string; items: CandidateItem[] }> {
  const resolved = await resolveChannelId(handleOrQuery);
  if (!resolved) {
    log(`youtube: could not resolve "${handleOrQuery}"`);
    return { source: handleOrQuery, items: [] };
  }
  const videos = await recentVideos(resolved.channelId, 24);
  const items: CandidateItem[] = videos.map((v) => ({
    type: 'youtube',
    title: v.title,
    source_name: v.channelTitle,
    source_url: v.url,
    thumbnail_url: v.thumbnailUrl,
    favicon_char: null,
    published_at: v.publishedAt,
    description_or_snippet: v.description.slice(0, 600),
  }));
  log(`youtube: ${resolved.channelTitle} → ${items.length} recent videos`);
  return { source: `youtube:${resolved.channelTitle}`, items };
}

async function collectWeb(anthropic: Anthropic, query: string): Promise<{ source: string; items: CandidateItem[] }> {
  const prompt = `Search the web for: "${query}"

Return the top 3-5 hits as a JSON array. Each entry must be:
{ "title": "...", "url": "...", "source_name": "publication or site", "snippet": "1-2 sentence summary", "published_at": "ISO 8601 if known else null" }

Recency rules (important):
- Strongly prefer items published within the last 48 hours.
- Items older than 7 days should only be returned if they are a major story still actively developing today.
- Always populate "published_at" when possible — this is critical for downstream filtering.
- "published_at" must be ISO-8601 (e.g. "2026-04-30T14:00:00Z").

Respond with ONLY the JSON array — no prose, no code fences.`;

  try {
    const res = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as unknown as Anthropic.Messages.Tool],
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const start = stripped.indexOf('[');
    const end = stripped.lastIndexOf(']');
    if (start === -1 || end === -1) {
      log(`web: no JSON array for "${query}"`);
      return { source: `web:${query}`, items: [] };
    }
    const arr = JSON.parse(stripped.slice(start, end + 1)) as Array<{
      title: string;
      url: string;
      source_name: string;
      snippet?: string;
      published_at?: string | null;
    }>;

    const items: CandidateItem[] = arr.map((h) => ({
      type: 'web',
      title: h.title,
      source_name: h.source_name,
      source_url: h.url,
      thumbnail_url: null,
      favicon_char: (h.source_name?.trim()?.[0] ?? '?').toUpperCase(),
      published_at: h.published_at ?? null,
      description_or_snippet: h.snippet ?? '',
    }));
    log(`web: "${query}" → ${items.length} hits`);
    return { source: `web:${query}`, items };
  } catch (err) {
    log(`web: error for "${query}":`, err);
    return { source: `web:${query}`, items: [] };
  }
}

// ── Recency ──────────────────────────────────────────────────────────────────

const MAX_AGE_DAYS = 7;

function ageDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function applyRecencyFilter(items: CandidateItem[]): CandidateItem[] {
  let dropped = 0;
  let unknown = 0;
  const kept: CandidateItem[] = [];
  for (const it of items) {
    const age = ageDays(it.published_at);
    if (age === null) {
      unknown++;
      kept.push({ ...it, published_at_unknown: true });
    } else if (age > MAX_AGE_DAYS) {
      dropped++;
    } else {
      kept.push(it);
    }
  }
  log(`recency filter: dropped ${dropped} items older than ${MAX_AGE_DAYS} days, ${unknown} items had no date`);
  return kept;
}

function ageLabel(item: CandidateItem): string {
  if (item.published_at_unknown) return 'Age: unknown — be skeptical, this may be stale';
  const age = ageDays(item.published_at);
  if (age === null) return 'Age: unknown — be skeptical, this may be stale';
  if (age < 1) {
    const hours = Math.max(1, Math.round(age * 24));
    return `Age: ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(age);
  return `Age: ${days} day${days === 1 ? '' : 's'} ago`;
}

// ── Step 3: Judge ────────────────────────────────────────────────────────────

async function judge(anthropic: Anthropic, item: CandidateItem): Promise<{ relevant: boolean; why_matters: string }> {
  const prompt = `You are filtering items for a personal cycling-news feed.

CHANNEL PROFILE:
${CHANNEL_PROFILE}

ITEM:
- Type: ${item.type}
- Source: ${item.source_name}
- Title: ${item.title}
- ${ageLabel(item)}
- Snippet/description: ${item.description_or_snippet}

Decide if this item is genuinely relevant to this channel's audience. Be discerning — most things should be rejected. If relevant, write a single sentence (editorial tone, not corporate, no hype words like "must-watch" or "essential") explaining why this specific channel's audience would care.

Relevance criteria:
- Prefer fresh items (last 48h ideal, last 7 days acceptable).
- Be skeptical of items with unknown publication date — only mark relevant if the title clearly indicates news/launch/event from this week.
- Evergreen roundups and "best bikes of the year" listicles should fail relevance unless they contain genuinely new information.

Respond with ONLY a JSON object — no prose, no code fences:
{ "relevant": true|false, "why_matters": "one sentence" }`;

  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  try {
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as { relevant: boolean; why_matters: string };
    return { relevant: !!parsed.relevant, why_matters: String(parsed.why_matters ?? '') };
  } catch {
    return { relevant: false, why_matters: '' };
  }
}

// ── Step 4: Write ────────────────────────────────────────────────────────────

async function startRun(): Promise<string> {
  const db = sql();
  const rows = (await db`
    INSERT INTO runs (status, stage, stage_detail, stage_updated_at)
    VALUES ('running', 'planning', 'deciding where to look', NOW())
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0].id;
}

async function setStage(runId: string, stage: string, detail: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE runs
    SET stage = ${stage},
        stage_detail = ${detail},
        stage_updated_at = NOW()
    WHERE id = ${runId}
  `;
  log(`stage: ${stage} — ${detail}`);
}

async function writeItemsAndFinalise(args: {
  runId: string;
  reasoning: string;
  sourcesChecked: number;
  surviving: Array<CandidateItem & { why_matters: string }>;
  sourcesTouched: string[];
}): Promise<void> {
  const db = sql();
  const { runId, reasoning, sourcesChecked, surviving, sourcesTouched } = args;

  await Promise.all(
    surviving.map((it, idx) => db`
      INSERT INTO items (
        run_id, type, title, source_name, source_url,
        thumbnail_url, favicon_char, published_at, why_matters, display_order
      ) VALUES (
        ${runId}, ${it.type}, ${it.title}, ${it.source_name}, ${it.source_url},
        ${it.thumbnail_url}, ${it.favicon_char}, ${it.published_at}, ${it.why_matters}, ${idx}
      )
    `),
  );

  await Promise.all(
    sourcesTouched.map((src) => db`
      INSERT INTO scout_memory (source, last_checked)
      VALUES (${src}, NOW())
    `),
  );

  await db`
    UPDATE runs
    SET status = 'done',
        sources_checked = ${sourcesChecked},
        items_found = ${surviving.length},
        scout_reasoning = ${reasoning},
        stage = NULL,
        stage_detail = NULL,
        stage_updated_at = NOW()
    WHERE id = ${runId}
  `;

  log(`wrote run ${runId} with ${surviving.length} items`);
}

async function markFailed(runId: string | null, message: string): Promise<void> {
  try {
    const db = sql();
    if (runId) {
      await db`
        UPDATE runs
        SET status = 'failed',
            error = ${message},
            stage = NULL,
            stage_detail = NULL,
            stage_updated_at = NOW()
        WHERE id = ${runId}
      `;
    } else {
      await db`
        INSERT INTO runs (status, error)
        VALUES ('failed', ${message})
      `;
    }
  } catch (err) {
    log('failed to write failure row:', err);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let runId: string | null = null;
  try {
    runId = await startRun();
    const anthropic = client();

    log('planning...');
    const manifest = await plan(anthropic);
    log('plan reasoning:', manifest.reasoning);
    log('youtube picks:', manifest.youtube_channels.map((c) => c.handle_or_query));
    log('web searches:', manifest.web_searches.map((s) => s.query));

    const pickedSources = manifest.youtube_channels.length + manifest.web_searches.length;
    await setStage(runId, 'collecting', `checking ${pickedSources} source${pickedSources === 1 ? '' : 's'}`);

    const collected = await Promise.all([
      ...manifest.youtube_channels.map((c) => collectYouTube(c.handle_or_query)),
      ...manifest.web_searches.map((s) => collectWeb(anthropic, s.query)),
    ]);

    const sourcesTouched = collected.map((c) => c.source);
    const sourcesChecked = collected.length;
    const rawCandidates = collected.flatMap((c) => c.items);
    log(`collected ${rawCandidates.length} candidate items from ${sourcesChecked} sources`);

    const fresh = applyRecencyFilter(rawCandidates);
    const allCandidates = fresh.slice(0, MAX_CANDIDATES);
    log(`${allCandidates.length} candidates after recency filter and cap`);

    await setStage(runId, 'judging', `judging ${allCandidates.length} item${allCandidates.length === 1 ? '' : 's'}`);

    const judgments = allCandidates.length
      ? await Promise.all(allCandidates.map((it) => judge(anthropic, it)))
      : [];

    const surviving = allCandidates
      .map((it, i) => ({ ...it, ...judgments[i] }))
      .filter((it) => it.relevant && it.why_matters)
      .slice(0, MAX_FINAL);

    log(`${surviving.length} items survived judging`);

    await setStage(runId, 'writing', `saving ${surviving.length} item${surviving.length === 1 ? '' : 's'}`);

    await writeItemsAndFinalise({
      runId,
      reasoning: manifest.reasoning,
      sourcesChecked,
      surviving,
      sourcesTouched,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    log('FAILED:', msg);
    await markFailed(runId, msg);
    process.exitCode = 1;
  }
}

main();
