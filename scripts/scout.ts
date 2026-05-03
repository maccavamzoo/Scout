// Scout v2 orchestrator — runs in GitHub Actions.
//
// Reads context from Neon → opens a session against the pre-created Scout agent
// → streams events (mapping them to live stage updates) → downloads
// /mnt/session/outputs/results.json → writes items + finalises the run.
//
// All agent intelligence (where to look, what's relevant, what's worth surfacing)
// lives on the agent. This file is glue: it must not contain logic about
// sources, freshness, or judging.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../lib/db';
import type { AgentResults } from '../lib/types';

const RESULTS_PATH = '/mnt/session/outputs/results.json';
const RESULTS_FILENAME = 'results.json';

function log(...args: unknown[]) {
  console.log('[scout]', ...args);
}

// ── Neon helpers ─────────────────────────────────────────────────────────────

async function loadRecentRatings(): Promise<
  Array<{ rating: string; title: string; source_name: string; why_matters: string }>
> {
  const db = sql();
  return (await db`
    SELECT r.rating, i.title, i.source_name, i.why_matters
    FROM ratings r
    JOIN items i ON i.id = r.item_id
    WHERE r.created_at > NOW() - INTERVAL '14 days'
    ORDER BY r.created_at DESC
  `) as Array<{ rating: string; title: string; source_name: string; why_matters: string }>;
}

async function loadLastSuccessfulRunDate(): Promise<string | null> {
  const db = sql();
  const rows = (await db`
    SELECT ran_at
    FROM runs
    WHERE status = 'done'
    ORDER BY ran_at DESC
    LIMIT 1
  `) as Array<{ ran_at: string | Date }>;
  const raw = rows[0]?.ran_at;
  if (!raw) return null;
  // Neon's serverless driver returns TIMESTAMPTZ as Date — normalise to ISO.
  return raw instanceof Date ? raw.toISOString() : String(raw);
}

async function startRun(): Promise<string> {
  const db = sql();
  const rows = (await db`
    INSERT INTO runs (status, stage, stage_detail, stage_updated_at)
    VALUES ('running', 'planning', 'briefing the agent', NOW())
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0].id;
}

async function setStage(runId: string, stage: string, detail: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE runs
    SET stage = ${stage}, stage_detail = ${detail}, stage_updated_at = NOW()
    WHERE id = ${runId}
  `;
  log(`stage: ${stage} — ${detail}`);
}

async function finaliseRun(runId: string, reasoning: string, items: AgentResults['items']): Promise<void> {
  const db = sql();
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

  await db`
    UPDATE runs
    SET status = 'done',
        sources_checked = NULL,
        items_found = ${items.length},
        scout_reasoning = ${reasoning},
        stage = NULL,
        stage_detail = NULL,
        stage_updated_at = NOW()
    WHERE id = ${runId}
  `;
  log(`finalised run ${runId} with ${items.length} items`);
}

async function markFailed(runId: string | null, message: string): Promise<void> {
  try {
    const db = sql();
    if (runId) {
      await db`
        UPDATE runs
        SET status = 'failed', error = ${message},
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

// ── User message ─────────────────────────────────────────────────────────────

function formatLastRun(value: string | Date | null | undefined): string {
  if (value == null) return 'never';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toISOString().slice(0, 10);
}

function buildUserMessage(
  ratings: Array<{ rating: string; title: string; source_name: string; why_matters: string }>,
  lastRunIso: string | Date | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lastRun = formatLastRun(lastRunIso);

  const ratingsBlock = ratings.length
    ? ratings
        .slice(0, 30)
        .map(
          (r) =>
            `- ${r.rating === 'up' ? '👍' : '👎'} ${r.title} — ${r.source_name} — ${r.why_matters}`,
        )
        .join('\n')
    : 'No ratings yet; this is an early session, lean on memory and your judgement.';

  return `Today is ${today}. Last successful run: ${lastRun}.

Recent ratings from Ben (last 14 days):
${ratingsBlock}

Run today's session. Consult memory, decide where to look, find the goods, write results to ${RESULTS_PATH}. Update your memory before you finish.`;
}

// ── Stage mapping from agent events ──────────────────────────────────────────

function describeToolUse(event: any): { stage: string; detail: string } | null {
  // event.type === 'agent.tool_use' — built-in toolset.
  const name: string = event.tool_name ?? event.name ?? '';
  const input = event.input ?? {};

  if (name === 'web_search') {
    const q = typeof input.query === 'string' ? input.query : '';
    return { stage: 'collecting', detail: q ? `searching: ${q}` : 'searching the web' };
  }
  if (name === 'web_fetch') {
    const url = typeof input.url === 'string' ? input.url : '';
    const host = url ? safeHost(url) : '';
    return { stage: 'collecting', detail: host ? `fetching: ${host}` : 'fetching a page' };
  }
  if (name === 'bash') {
    return { stage: 'collecting', detail: 'running a command' };
  }
  if (name === 'read' || name === 'glob' || name === 'grep') {
    return { stage: 'collecting', detail: 'reading memory' };
  }
  if (name === 'write' || name === 'edit') {
    const path: string = input.path ?? input.file_path ?? '';
    if (path.endsWith(RESULTS_FILENAME)) {
      return { stage: 'writing', detail: 'saving findings' };
    }
    if (path.startsWith('/mnt/memory/')) {
      return { stage: 'collecting', detail: 'updating memory' };
    }
    return null;
  }
  return null;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ── Results download ─────────────────────────────────────────────────────────

async function downloadResults(client: Anthropic, sessionId: string): Promise<AgentResults> {
  // Brief indexing lag between session.status_idle and files appearing in list.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const files = await client.beta.files.list(
      { scope_id: sessionId } as any,
      { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } } as any,
    );
    const data = (files as any).data ?? [];
    const match = data.find((f: any) => f.filename === RESULTS_FILENAME || f.filename?.endsWith(`/${RESULTS_FILENAME}`));
    if (match) {
      const resp = await client.beta.files.download(match.id);
      const text = await (resp as any).text();
      return JSON.parse(text) as AgentResults;
    }
  }
  throw new Error(`agent did not write ${RESULTS_PATH}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const agentId = process.env.SCOUT_AGENT_ID;
  const environmentId = process.env.SCOUT_ENVIRONMENT_ID;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!agentId) throw new Error('SCOUT_AGENT_ID is not set (run scripts/setup-agent.ts first)');
  if (!environmentId) throw new Error('SCOUT_ENVIRONMENT_ID is not set (run scripts/setup-agent.ts first)');

  const runId = await startRun();
  let stageNow = 'planning';

  try {
    const client = new Anthropic();

    // Look up the memory_store_id we stashed on the agent at setup time.
    const agent = await client.beta.agents.retrieve(agentId);
    const memoryStoreId = (agent.metadata as Record<string, string> | null)?.scout_memory_store_id;
    if (!memoryStoreId) {
      throw new Error('agent.metadata.scout_memory_store_id is not set — re-run scripts/setup-agent.ts');
    }

    const [ratings, lastRunDate] = await Promise.all([loadRecentRatings(), loadLastSuccessfulRunDate()]);

    const session = await client.beta.sessions.create({
      agent: { type: 'agent', id: agentId, version: agent.version },
      environment_id: environmentId,
      title: `Scout daily run ${new Date().toISOString().slice(0, 10)}`,
      resources: [
        {
          type: 'memory_store',
          memory_store_id: memoryStoreId,
          access: 'read_write',
          instructions:
            'Your persistent memory across daily Scout runs. Read before deciding where to look today; update before you finish.',
        } as any,
      ],
    });
    log(`session ${session.id} (agent ${agentId} v${agent.version})`);

    const userMessage = buildUserMessage(ratings, lastRunDate);

    // Stream-first: open the stream before sending the kickoff.
    const stream = await client.beta.sessions.events.stream(session.id);

    await client.beta.sessions.events.send(session.id, {
      events: [
        { type: 'user.message', content: [{ type: 'text', text: userMessage }] },
      ],
    } as any);

    for await (const ev of stream as any) {
      const t = ev.type as string;
      log(t);

      if (t === 'agent.tool_use') {
        const mapped = describeToolUse(ev);
        if (mapped && (mapped.stage !== stageNow || mapped.detail)) {
          stageNow = mapped.stage;
          await setStage(runId, mapped.stage, mapped.detail);
        }
      }

      if (t === 'session.error') {
        throw new Error(`session.error: ${ev.error?.message ?? JSON.stringify(ev.error ?? ev)}`);
      }

      if (t === 'session.status_terminated') break;
      if (t === 'session.status_idle') {
        const stopType = ev.stop_reason?.type;
        if (stopType === 'requires_action') continue; // waiting on us — but we have no custom tools, so this shouldn't happen
        break; // end_turn or retries_exhausted
      }
    }

    await setStage(runId, 'writing', 'reading the agent\'s findings');

    const results = await downloadResults(client, session.id);
    log(`agent returned ${results.items?.length ?? 0} items`);

    await finaliseRun(runId, results.reasoning ?? '', results.items ?? []);

    // Tidy up the session — agent + environment + memory store all persist.
    try {
      await client.beta.sessions.archive(session.id);
    } catch (err) {
      log('session archive failed (non-fatal):', err);
    }
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    log('FAILED:', msg);
    await markFailed(runId, msg);
    process.exitCode = 1;
  }
}

main();
