export interface SearchResult {
  title: string;
  url: string;
  content: string;
  published_date?: string | null;
}

/** 所有 provider 共享的调用参数（dispatcher 已应用默认值） */
export interface SearchParams {
  query: string;
  timeRange: 'day' | 'week' | 'month' | 'year';
  maxResults: number;
}

/** 从 settings 行透传，provider 按需取用 */
export interface SearchSettings {
  search_provider?: string | null;
  search_api_key?: string | null;
}

export interface SearchOpts {
  fetchImpl?: typeof fetch;
}

export type SearchProviderFn = (
  params: SearchParams,
  settings: SearchSettings,
  opts?: SearchOpts,
) => Promise<SearchResult[]>;
