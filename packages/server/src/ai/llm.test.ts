import { describe, it, expect } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { analyze } from './llm.js';

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

const interest = {
  name: '华友钴业',
  category: 'company',
  query_keywords: '华友钴业 股价 最新',
};

const results = [
  {
    title: '华友钴业发布三季度财报',
    url: 'https://example.com/news/1',
    content: '华友钴业净利润同比增长 45%，碳酸锂业务表现亮眼。',
    published_date: '2026-08-18T09:00:00.000Z',
  },
];

const settings = {
  ai_base_url: 'https://api.openai.com/v1',
  ai_api_key: 'sk-test',
  ai_model: 'gpt-4o',
};

describe('analyze', () => {
  it('returns structured updates from the LLM output', async () => {
    const model = mockModelWithJson({
      elements: [
        {
          title: '华友钴业第三季度净利润同比增长 45%',
          summary: '公司发布三季度财报，净利润同比增长 45%',
          source_url: 'https://example.com/news/1',
          source_name: '东方财富网',
          published_at: '2026-08-18T09:00:00.000Z',
          importance: 8,
          has_progress: true,
        },
      ],
    });

    const { updates, usage } = await analyze(interest, results, settings, { model });

    expect(updates).toEqual([
      {
        title: '华友钴业第三季度净利润同比增长 45%',
        summary: '公司发布三季度财报，净利润同比增长 45%',
        source_url: 'https://example.com/news/1',
        source_name: '东方财富网',
        published_at: '2026-08-18T09:00:00.000Z',
        importance: 8,
        has_progress: true,
      },
    ]);
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('returns an empty array when the LLM finds no relevant changes', async () => {
    const model = mockModelWithJson({ elements: [] });

    const { updates } = await analyze(interest, results, settings, { model });

    expect(updates).toEqual([]);
  });

  it('throws when no AI API key is configured', async () => {
    await expect(
      analyze(interest, results, { ...settings, ai_api_key: null }),
    ).rejects.toThrow('未配置 AI API Key');
  });

  it('tolerates minimal model output and fills defaults', async () => {
    const model = mockModelWithJson({
      elements: [
        {
          title: '华友钴业上半年净利创新高',
          description: '上半年营收 555.68 亿元，同比增长 49.39%',
        },
      ],
    });

    const { updates } = await analyze(interest, results, settings, { model });

    expect(updates).toEqual([
      {
        title: '华友钴业上半年净利创新高',
        summary: '上半年营收 555.68 亿元，同比增长 49.39%',
        source_url: '',
        source_name: '',
        published_at: '',
        importance: 5,
        has_progress: false,
      },
    ]);
  });

  it('defaults usage to zero when the model reports no tokens', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ elements: [] }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const { usage } = await analyze(interest, results, settings, { model });

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('passes the known state into the prompt', async () => {
    let promptText = '';
    const model = new MockLanguageModelV4({
      doGenerate: async (input) => {
        const messages = input.prompt as Array<{
          content: Array<{ type: string; text: string }>;
        }>;
        promptText = messages
          .flatMap((m) => m.content.map((c) => c.text))
          .join('\n');
        return {
          content: [{ type: 'text', text: JSON.stringify({ elements: [] }) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    await analyze(
      interest,
      results,
      settings,
      { model },
      '已知状态：上半年营收 555.68 亿元，同比增长 49.39%；归母净利润 35.07 亿元。',
    );

    expect(promptText).toContain('目前已知状态');
    expect(promptText).toContain('上半年营收 555.68 亿元，同比增长 49.39%');
    expect(promptText).toContain('has_progress');
  });
});
