import { Errors } from '../lib/errors.js';
import type { SearchProviderFn } from './types.js';

export const searchTavily: SearchProviderFn = async (params, settings, opts) => {
  const apiKey = settings.search_api_key;
  if (!apiKey) {
    throw Errors.internal('未配置搜索 API Key');
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;

  const res = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: params.query,
      topic: 'news',
      time_range: params.timeRange,
      max_results: params.maxResults,
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
};
