import { describe, it, expect, vi, afterEach } from 'vitest';
import { search } from './search.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('search', () => {
  it('queries Tavily with the interest and returns normalized results', async () => {
    const fetchImpl = mockFetchOk({
      query: '华友钴业',
      results: [
        {
          title: '华友钴业发布三季度财报',
          url: 'https://example.com/news/1',
          content: '华友钴业净利润同比增长 45%...',
          score: 0.95,
          published_date: '2026-08-18T09:00:00.000Z',
        },
      ],
    });

    const results = await search(
      { name: '华友钴业', category: 'company' },
      { search_api_key: 'tvly-test-key' },
      { fetchImpl },
    );

    expect(results).toEqual([
      {
        title: '华友钴业发布三季度财报',
        url: 'https://example.com/news/1',
        content: '华友钴业净利润同比增长 45%...',
        published_date: '2026-08-18T09:00:00.000Z',
      },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tvly-test-key',
    });
    const body = JSON.parse(String(init.body));
    expect(body.query).toBe('华友钴业');
  });

  it('uses query_keywords when present', async () => {
    const fetchImpl = mockFetchOk({ results: [] });

    await search(
      { name: '华友钴业', query_keywords: '华友钴业 股价 财报' },
      { search_api_key: 'tvly-test-key' },
      { fetchImpl },
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).query).toBe('华友钴业 股价 财报');
  });

  it('throws when no API key is configured', async () => {
    const fetchImpl = vi.fn();
    await expect(
      search({ name: '华友钴业' }, { search_api_key: null }, { fetchImpl }),
    ).rejects.toThrow('未配置搜索 API Key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws when Tavily returns a non-200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(
      search({ name: '华友钴业' }, { search_api_key: 'tvly-bad-key' }, { fetchImpl }),
    ).rejects.toThrow('Tavily 搜索失败: HTTP 401');
  });

  it('passes timeRange and maxResults to Tavily body', async () => {
    const fetchImpl = mockFetchOk({ results: [] });

    await search(
      { name: '华友钴业' },
      { search_api_key: 'tvly-test-key' },
      { timeRange: 'day', maxResults: 5, fetchImpl },
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.time_range).toBe('day');
    expect(body.max_results).toBe(5);
    expect(body.topic).toBe('news');
  });
});
