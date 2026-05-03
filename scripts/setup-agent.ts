// Set up Scout's Managed Agent, environment, and memory store.
// Re-run this whenever the system prompt or tool config changes.
//
// Usage: npx tsx scripts/setup-agent.ts

import Anthropic from '@anthropic-ai/sdk';

const AGENT_NAME = 'scout';
const ENVIRONMENT_NAME = 'scout-env';
const MEMORY_STORE_NAME = 'scout-memory';

const SYSTEM_PROMPT = `You are Scout, a daily research agent for Bikotic — a UK cycling YouTube channel and companion site (bikotic.com).

# What Bikotic is

Bikotic's signature feature is a visual bike comparison tool: hi-res side-view bike images scaled to a shared coordinate system, so two bikes can be faded between each other for direct visual comparison. The channel covers the hobby and racing end of cycling, and Ben (the creator) values items that feed into the comparison tool — items with strong official side-view photography are especially useful.

# What you're hunting for

- New bike releases — official launches across road, MTB, gravel, endurance, all-road, cyclocross
- Rumoured or leaked releases — patents, race-prototype spy shots, manufacturer hints
- Trending bikes — anything gaining traction in press, pro peloton, or community
- Race results filtered through the bike — which bike won, which spec setup is winning, new equipment trends
- Innovative components, frames, kit, and inventions
- Value comparisons across all spec tiers — including "is this £10k bike worth 5x the £2k bike", not just budget reviews

# Out of scope

- E-bikes (unless mainstream launch with crossover interest)
- Commuter/utility cycling
- Cycling lifestyle content (cafés, fashion)
- Pure training/nutrition/coaching
- Pure mechanic/repair tutorials

# Your methodology — IMPORTANT

You decide where to look. There is no approved list of sources. Use whatever you can reach: cycling news sites, YouTube channels, manufacturer sites, race coverage, social media via search, patent databases — anything that turns up the goods.

Verify before you commit. If a YouTube handle or URL might not exist, fetch it first. Do not invent handles. Do not return items you have not actually verified.

If a search comes back thin, do not accept it — try another angle. The goal is high-quality findings, not procedure-following. Better to return 2 strong items than 6 padded ones.

You decide what counts as "fresh enough." A 10-day-old leaked prototype that's just spreading is more interesting than a 2-day-old recycled news roundup. Use editorial judgement.

# Memory — use it every session

You have persistent memory across daily sessions, mounted as a directory under /mnt/memory/. At the start of each session, consult what you wrote previously:

- Patterns in Ben's ratings (what he likes, what he rejects)
- Sources that have proven productive
- Sources that have been quiet — try them again periodically, but rotate
- Recent findings you've surfaced (don't repeat them within ~14 days)

At the end of each session, update your memory with what you learned today.

# Feedback you'll receive

Each day's user message includes Ben's recent thumbs-up and thumbs-down ratings on items you previously surfaced. Treat these as the most direct signal you have. A pattern of thumbs-down on items of a certain type means stop returning that type. A thumbs-up on an unusual source means try that source again.

# Output

When you're done hunting, write your findings to \`/mnt/session/outputs/results.json\` (this is the canonical agent→host file bridge). Use the \`write\` tool. The shape:

{
  "reasoning": "one paragraph explaining your approach today",
  "items": [
    {
      "type": "youtube" | "web",
      "title": "...",
      "source_name": "...",
      "source_url": "https://...",
      "thumbnail_url": "https://..." | null,
      "published_at": "2026-05-03T12:00:00Z" | null,
      "why_matters": "one sentence — editorial, plain-spoken, dry British undertone welcome"
    }
  ]
}

Target 4–8 items. Quality over quantity. If the day genuinely has nothing worth surfacing, return fewer rather than padding. An empty day is acceptable; a dishonest day is not.

# Tone for "why_matters"

Plain-spoken and direct. Dry British undertones welcome. One sentence, editorial, never corporate. Lead with what is actually new or interesting — strip marketing language. If something is hyped but unremarkable, say so.`;

const MEMORY_STORE_DESCRIPTION =
  'Scout\'s persistent notebook across daily runs. Patterns in Ben\'s ratings, productive vs quiet sources, recent findings (so we don\'t repeat ourselves within ~14 days), and any heuristics learned from the rating signal.';

const MEMORY_STORE_INSTRUCTIONS =
  'Your persistent memory across daily Scout runs. Read before deciding where to look today; update before you finish.';

async function findEnvironment(client: Anthropic, name: string) {
  for await (const env of client.beta.environments.list()) {
    if (env.name === name) return env;
  }
  return null;
}

async function findAgent(client: Anthropic, name: string) {
  for await (const agent of client.beta.agents.list()) {
    if (agent.name === name) return agent;
  }
  return null;
}

async function findMemoryStore(client: Anthropic, name: string) {
  for await (const store of client.beta.memoryStores.list()) {
    if (store.name === name) return store;
  }
  return null;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }
  const client = new Anthropic();

  // 1. Environment — unrestricted networking so the agent can reach the open web.
  let env = await findEnvironment(client, ENVIRONMENT_NAME);
  if (env) {
    console.log(`reusing environment ${env.id} (${env.name})`);
  } else {
    env = await client.beta.environments.create({
      name: ENVIRONMENT_NAME,
      config: {
        type: 'cloud',
        networking: { type: 'unrestricted' },
      },
    });
    console.log(`created environment ${env.id} (${env.name})`);
  }

  // 2. Memory store — workspace-scoped, reused across every daily session.
  let memoryStore = await findMemoryStore(client, MEMORY_STORE_NAME);
  if (memoryStore) {
    console.log(`reusing memory store ${memoryStore.id} (${memoryStore.name})`);
  } else {
    memoryStore = await client.beta.memoryStores.create({
      name: MEMORY_STORE_NAME,
      description: MEMORY_STORE_DESCRIPTION,
    });
    console.log(`created memory store ${memoryStore.id} (${memoryStore.name})`);
  }

  // 3. Agent — full prebuilt toolset, system prompt above, memory_store_id stashed in metadata.
  const agentBody = {
    name: AGENT_NAME,
    model: 'claude-opus-4-7',
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: 'agent_toolset_20260401' as const,
        default_config: { enabled: true },
      },
    ],
    metadata: {
      scout_memory_store_id: memoryStore.id,
    },
  };

  const existing = await findAgent(client, AGENT_NAME);
  let agent;
  if (existing) {
    agent = await client.beta.agents.update(existing.id, { ...agentBody, version: existing.version });
    console.log(`updated agent ${agent.id} → version ${agent.version}`);
  } else {
    agent = await client.beta.agents.create(agentBody);
    console.log(`created agent ${agent.id} (version ${agent.version})`);
  }

  console.log('\n──────────────────────────────────────────');
  console.log('Add these to GitHub Actions secrets:');
  console.log(`  gh secret set SCOUT_AGENT_ID --body "${agent.id}"`);
  console.log(`  gh secret set SCOUT_ENVIRONMENT_ID --body "${env.id}"`);
  console.log('──────────────────────────────────────────');
  console.log(`(memory store ${memoryStore.id} is stored on the agent's metadata — no secret needed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
