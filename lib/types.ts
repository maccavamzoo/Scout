export type ItemType = 'youtube' | 'web';

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

export interface LatestResponse {
  status: 'done' | 'failed' | 'running' | 'pending';
  stage: string | null;
  stage_detail: string | null;
  ran_at: string;
  error: string | null;
  sources_checked: number | null;
  items_found: number | null;
  items: Array<{
    id: string;
    type: ItemType;
    title: string;
    source_name: string;
    source_url: string;
    thumbnail_url: string | null;
    favicon_char: string | null;
    published_at: string | null;
    why_matters: string;
  }>;
}

export interface PlanManifest {
  reasoning: string;
  youtube_channels: Array<{ handle_or_query: string; why: string }>;
  web_searches: Array<{ query: string; why: string }>;
}

export interface CandidateItem {
  type: ItemType;
  title: string;
  source_name: string;
  source_url: string;
  thumbnail_url: string | null;
  favicon_char: string | null;
  published_at: string | null;
  description_or_snippet: string;
  published_at_unknown?: boolean;
}
