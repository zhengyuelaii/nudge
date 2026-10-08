import { describe, it, expect } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { analyze, AnalyzeOutputError, AnalyzeSearchError } from './llm.js';

function mockModelWithJson(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(json) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

/** 抓取实际发给模型的 prompt 文本，用于断言喂进去的内容 */
function mockModelCapturingPrompt(onPrompt: (text: string) => void) {
  return new MockLanguageModelV4({
    doGenerate: async (input) => {
      const messages = input.prompt as Array<{
        content: Array<{ type: string; text: string }>;
      }>;
      onPrompt(messages.flatMap((m) => m.content.map((c) => c.text)).join('\n'));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ has_progress: false, title: '', summary: 'x', source: [] }),
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

const interest = {
  name: '华友钴业',
  tags: ['company'],
  query_keywords: '华友钴业 股价 最新',
};

const searchResults = [
  {
    title: '华友钴业发布三季度财报',
    url: 'https://example.com/news/1',
    content: '华友钴业净利润同比增长 45%，碳酸锂业务表现亮眼。',
    published_date: '2026-08-18T09:00:00.000Z',
  },
];

/** 搜索已内聚在 analyze 内，测试只需假掉 Tavily 的 HTTP 响应 */
function mockSearch(results: unknown = searchResults): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

const settings = {
  ai_base_url: 'https://api.openai.com/v1',
  ai_api_key: 'sk-test',
  ai_model: 'gpt-4o',
  search_api_key: 'tvly-test',
};

const fetchImpl = mockSearch();

describe('analyze', () => {
  it('returns a single consolidated result from the LLM output', async () => {
    const model = mockModelWithJson({
      has_progress: true,
      title: '华友钴业第三季度净利润同比增长 45%',
      summary: '公司发布三季度财报，净利润同比增长 45%',
      source: [
        {
          title: '华友钴业发布三季度财报',
          source_url: 'https://example.com/news/1',
          source_name: '东方财富网',
          published_at: '2026-08-18T09:00:00.000Z',
        },
      ],
    });

    const result = await analyze(interest, settings, { model, fetchImpl });

    expect(result.has_progress).toBe(true);
    expect(result.title).toBe('华友钴业第三季度净利润同比增长 45%');
    expect(result.summary).toBe('公司发布三季度财报，净利润同比增长 45%');
    expect(result.source).toEqual([
      {
        title: '华友钴业发布三季度财报',
        source_url: 'https://example.com/news/1',
        source_name: '东方财富网',
        published_at: '2026-08-18T09:00:00.000Z',
        why: '',
      },
    ]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(result.searchResultCount).toBe(1);
  });

  it('reports no progress when the LLM finds no relevant changes', async () => {
    const model = mockModelWithJson({
      has_progress: false,
      title: '',
      summary: '',
      source: [],
    });

    const result = await analyze(interest, settings, { model, fetchImpl });

    expect(result.has_progress).toBe(false);
    expect(result.source).toEqual([]);
  });

  it('throws when no AI API key is configured, without spending a search call', async () => {
    let searched = false;
    const countingFetch = (async () => {
      searched = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await expect(
      analyze(interest, { ...settings, ai_api_key: null }, { fetchImpl: countingFetch }),
    ).rejects.toThrow('未配置 AI API Key');

    expect(searched).toBe(false);
  });

  it('tolerates minimal model output and fills defaults', async () => {
    const model = mockModelWithJson({
      has_progress: true,
      title: '华友钴业上半年净利创新高',
      summary: '上半年营收 555.68 亿元，同比增长 49.39%',
      source: [{ title: '华友钴业上半年净利创新高' }],
    });

    const result = await analyze(interest, settings, { model, fetchImpl });

    expect(result.has_progress).toBe(true);
    expect(result.source).toEqual([
      {
        title: '华友钴业上半年净利创新高',
        source_url: '',
        source_name: '',
        published_at: '',
        why: '',
      },
    ]);
  });

  it('caps the sources at the same limit the prompt asks for', async () => {
    const model = mockModelWithJson({
      has_progress: true,
      title: '来源超量',
      summary: '模型返回了 10 条来源',
      source: Array.from({ length: 10 }, (_, i) => ({ title: `来源${i + 1}` })),
    });

    const result = await analyze(interest, settings, { model, fetchImpl });

    expect(result.source).toHaveLength(8);
  });

  it('throws AnalyzeOutputError instead of reporting no progress when output is malformed', async () => {
    const model = mockModelWithJson({ elements: [] });

    await expect(analyze(interest, settings, { model, fetchImpl })).rejects.toThrow(
      AnalyzeOutputError,
    );
  });

  it('carries the consumed tokens on the parse error', async () => {
    const model = mockModelWithJson({ elements: [] });

    await expect(analyze(interest, settings, { model, fetchImpl })).rejects.toMatchObject({
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it('disables DeepSeek thinking so the budget is not eaten by reasoning tokens', async () => {
    // maxOutputTokens 是「思考 + 正文」的总预算：CPO 这类长判据兴趣实测思考能吃掉 4000~12000 tok，
    // 正文一个字符都吐不出来 → finishReason=length → llm_failed。关掉思考是本链路的必需参数。
    let seen: unknown = 'doGenerate 未被调用';
    const model = new MockLanguageModelV4({
      doGenerate: async (input) => {
        seen = input.providerOptions;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ has_progress: false, title: '', summary: 'x', source: [] }),
            },
          ],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    await analyze(interest, settings, { model, fetchImpl });

    expect(seen).toMatchObject({ deepseek: { thinking: { type: 'disabled' } } });
  });

  it('throws AnalyzeOutputError when the output is cut off by the token cap', async () => {
    // 撞上 maxOutputTokens 时 SDK 会跳过 Output.object 的解析、result.output 变成 undefined，
    // 这里锁住「不装死」：必须报 AnalyzeOutputError（→ llm_failed），而不是退化成访问
    // undefined 的 TypeError（→ 被记成 unknown，错误归因丢失）。
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{"has_progress": true, "title": "被截断的来源标' }],
        finishReason: { unified: 'length', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 4000, text: 4000, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    await expect(analyze(interest, settings, { model, fetchImpl })).rejects.toMatchObject({
      name: 'AnalyzeOutputError',
      usage: { inputTokens: 10, outputTokens: 4000 },
    });
  });

  it('defaults usage to zero when the model reports no tokens', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ has_progress: false, title: '', summary: '', source: [] }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const { usage } = await analyze(interest, settings, { model, fetchImpl });

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('passes the known state into the prompt', async () => {
    let promptText = '';
    const model = mockModelCapturingPrompt((t) => {
      promptText = t;
    });

    await analyze(
      interest,
      settings,
      { model, fetchImpl },
      '已知状态：上半年营收 555.68 亿元，同比增长 49.39%；归母净利润 35.07 亿元。',
    );

    expect(promptText).toContain('目前已知状态');
    expect(promptText).toContain('上半年营收 555.68 亿元，同比增长 49.39%');
    expect(promptText).toContain('has_progress');
  });

  it('injects the watch criteria into the prompt when configured', async () => {
    let promptText = '';
    const model = mockModelCapturingPrompt((t) => {
      promptText = t;
    });

    await analyze(
      {
        ...interest,
        subject: '美国生物安全法案',
        criteria: '出现修订、新增条款或进入投票环节',
      },
      settings,
      { model, fetchImpl },
    );

    expect(promptText).toContain('监控主体：美国生物安全法案');
    expect(promptText).toContain('触发条件：出现修订、新增条款或进入投票环节');
    // 有判据时判定规则换成「当且仅当命中触发条件」
    expect(promptText).toContain('当且仅当');
  });

  it('keeps the prompt free of the criteria block when none is configured', async () => {
    let promptText = '';
    const model = mockModelCapturingPrompt((t) => {
      promptText = t;
    });

    await analyze(interest, settings, { model, fetchImpl });

    expect(promptText).not.toContain('监控主体');
    expect(promptText).not.toContain('判定标准');
    expect(promptText).not.toContain('当且仅当');
  });

  it('carries the per-source reason through to the result', async () => {
    const model = mockModelWithJson({
      has_progress: true,
      title: '华友钴业三季度净利创新高',
      summary: '净利同比增长 45%',
      source: [
        {
          title: '华友钴业发布三季度财报',
          source_url: 'https://example.com/news/1',
          why: '命中「净利同比变动超 30%」：Q3 净利同比增长 45%',
        },
      ],
    });

    const result = await analyze(interest, settings, { model, fetchImpl });

    expect(result.source[0].why).toBe('命中「净利同比变动超 30%」：Q3 净利同比增长 45%');
  });

  it('gives the model the publish date and the current time instead of letting it invent one', async () => {
    let promptText = '';
    const model = mockModelCapturingPrompt((t) => {
      promptText = t;
    });

    const withMissingDate = mockSearch([
      ...searchResults,
      {
        title: '无日期的结果',
        url: 'https://example.com/news/2',
        content: '搜索结果未给出发布时间',
        published_date: null,
      },
    ]);

    await analyze(interest, settings, { model, fetchImpl: withMissingDate });

    expect(promptText).toContain('当前时间：');
    expect(promptText).toContain('published_date: 2026-08-18T09:00:00.000Z');
    // 日期缺失时必须显式说「未知」，否则模型只能编
    expect(promptText).toContain('published_date: 未知');
  });

  it('truncates long search content so one run cannot blow up the input tokens', async () => {
    let promptText = '';
    const model = mockModelCapturingPrompt((t) => {
      promptText = t;
    });

    const longContent = mockSearch([
      {
        title: '超长报道',
        url: 'https://example.com/news/long',
        content: `${'正'.repeat(1500)}TAIL_MARKER`,
        published_date: null,
      },
    ]);

    await analyze(interest, settings, { model, fetchImpl: longContent });

    expect(promptText).toContain('（已截断）');
    expect(promptText).not.toContain('TAIL_MARKER');
  });

  it('skips the model entirely when the search returns nothing', async () => {
    let llmCalls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        llmCalls += 1;
        return {
          content: [{ type: 'text', text: JSON.stringify({ has_progress: false, title: '', summary: '', source: [] }) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    const result = await analyze(interest, settings, { model, fetchImpl: mockSearch([]) });

    expect(llmCalls).toBe(0);
    expect(result.has_progress).toBe(false);
    expect(result.source).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.searchResultCount).toBe(0);
    expect(result.summary).toBe('搜索未返回结果，已跳过 LLM 分析');
  });

  it('surfaces search failures as AnalyzeSearchError', async () => {
    const failingFetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    await expect(
      analyze(interest, settings, { model: mockModelWithJson({}), fetchImpl: failingFetch }),
    ).rejects.toThrow(AnalyzeSearchError);
  });
});
