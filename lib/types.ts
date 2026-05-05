export type ItemType = 'youtube' | 'web';
export type Rating = 'up' | 'down';

export interface RunRow {
  id: string;
  ran_at: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  items_found: number | null;
  error: string | null;
  stage: string | null;
  stage_detail: string | null;
  stage_updated_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
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
  items_found: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  items: LatestItem[];
}

export interface BalanceResponse {
  // dollars; null = couldn't determine (no key, endpoint failed, etc.)
  balance_usd: number | null;
  source?: string;
}
