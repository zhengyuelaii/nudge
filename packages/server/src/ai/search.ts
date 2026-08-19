import { Errors } from '../lib/errors.js';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  published_date?: string | null;
}

export async function search(
  interest: { name: string; query_keywords?: string | null },
  settings: { search_api_key?: string | null },
  opts?: { timeRange?: 'day' | 'week' | 'month' | 'year'; maxResults?: number; fetchImpl?: typeof fetch },
): Promise<SearchResult[]> {
  const apiKey = settings.search_api_key;
  if (!apiKey) {
    throw Errors.internal('未配置搜索 API Key');
  }

  const query = interest.query_keywords || interest.name;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const res = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic: 'news',
      time_range: opts?.timeRange ?? 'week',
      max_results: opts?.maxResults ?? 10,
      search_depth: 'basic',
    }),
  });

  if (!res.ok) {
    throw Errors.internal(`Tavily 搜索失败: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      published_date?: string | null;
    }>;
  };

  return (data.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      content: r.content ?? '',
      published_date: r.published_date ?? null,
    }));
}