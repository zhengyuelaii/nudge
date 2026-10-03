import { Errors } from '../lib/errors.js';
import { searchTavily } from './tavily.js';
import type { SearchProviderFn, SearchSettings, SearchResult } from './types.js';

export * from './types.js';

export const SEARCH_PROVIDERS = ['tavily'] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];

const providers: Record<SearchProviderId, SearchProviderFn> = {
  tavily: searchTavily,
};

export async function search(
  interest: { name: string; query_keywords?: string | null },
  settings: SearchSettings,
  opts?: { timeRange?: 'day' | 'week' | 'month' | 'year'; maxResults?: number; fetchImpl?: typeof fetch },
): Promise<SearchResult[]> {
  const providerId = settings.search_provider ?? 'tavily';
  const provider = providers[providerId as SearchProviderId];
  if (!provider) {
    throw Errors.validation(`不支持的搜索引擎: ${providerId}`);
  }

  return provider(
    {
      query: interest.query_keywords || interest.name,
      timeRange: opts?.timeRange ?? 'week',
      maxResults: opts?.maxResults ?? 10,
    },
    settings,
    { fetchImpl: opts?.fetchImpl },
  );
}
