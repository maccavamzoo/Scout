export type ItemType = 'youtube' | 'web';
export type Rating = 'up' | 'down';

export interface RunRow {
  id: string;
  ran_at: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  sources_checked: number | null;
  items_found: number | null;
  scout_reasoning: string | null;
  error: string | null;
  stage: string | null;
  stage_detail: string | null;
  stage_updated_at: string | null;
}

export interface ItemRow {
  id: string;
  run_id: string;
  type: ItemType;
  title: string;
  source_name: string;
  source_url: string;
  thumbnail_url: string | null;
  favicon_char: string | null;
  published_at: string | null;
  why_matters: string;
  display_order: number;
  created_at: string;
}

export interface LatestItem {
  id: string;
  type: ItemType;
  title: string;
  source_name: string;
  source_url: string;
  thumbnail_url: string | null;
  favicon_char: string | null;
  published_at: string | null;
  why_matters: string;
  rating: Rating | null;
}

export interface LatestResponse {
  status: 'done' | 'failed' | 'running' | 'pending';
  stage: string | null;
  stage_detail: string | null;
  ran_at: string;
  error: string | null;
  sources_checked: number | null;
  items_found: number | null;
  items: LatestItem[];
}

// What the agent writes to /mnt/session/outputs/results.json.
export interface AgentResults {
  reasoning: string;
  items: Array<{
    type: ItemType;
    title: string;
    source_name: string;
    source_url: string;
    thumbnail_url?: string | null;
    published_at?: string | null;
    why_matters: string;
  }>;
}
