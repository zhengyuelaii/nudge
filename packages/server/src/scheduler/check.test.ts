import { describe, it, expect, beforeEach } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { db } from '../db/client.js';
import { taskRunService } from '../services/task-run.service.js';
import { runCheck } from './check.js';

const SEARCH_RESULTS = {
  results: [
    {
      title: '华友钴业上半年净利润创新高',
      url: 'https://example.com/news/1',
      content: '上半年营收 555.68 亿元，同比增长 49.39%，归母净利润 35.07 亿元。',
      published_date: '2026-08-18T09:00:00.000Z',
    },
  ],
};

let seedInterestId = 0;
let seedTaskId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags, query_keywords) VALUES (1, ?, ?, ?)')
    .run('华友钴业', '["company"]', '华友钴业 股价 最新');
  seedInterestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)',
    )
    .run(seedInterestId, 'day', '09:00');
  seedTaskId = Number(task.lastInsertRowid);

  db.prepare(
    "UPDATE settings SET search_api_key = 'tvly-test', ai_api_key = 'sk-test', ai_model = 'deepseek-v4-flash' WHERE user_id = 1",
  ).run();

  db.prepare(
    `INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
     VALUES (1, 'feishu', '飞书', '{"webhook_url":"https://open.feishu.cn/open-apis/bot/v2/hook/test","secret":""}', 1, 1)`,
  ).run();
}

beforeEach(() => {
  db.exec(
    'DELETE FROM source; DELETE FROM interest_event; DELETE FROM task_run; DELETE FROM notification_channel; DELETE FROM task; DELETE FROM interest;',
  );
  seed();
});

type MockSpec = { body: unknown; status: number } | unknown;

function mockFetch(byUrl: Record<string, MockSpec>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, spec] of Object.entries(byUrl)) {
      if (url.includes(match)) {
        const specObj = spec as { body?: unknown; status?: number };
        const body = specObj.body !== undefined ? specObj.body : spec;
        const status = specObj.status ?? 200;
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;
}

function mockModel(json: unknown) {
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

describe('runCheck', () => {
  it('runs the full pipeline: search → analyze → write → notify → success', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });
    const model = mockModel({
      has_progress: true,
      title: '华友钴业上半年净利创新高',
      summary: '营收 555.68 亿元，同比增 49.39%',
      source: [
        {
          title: '华友钴业发布半年报',
          source_url: 'https://example.com/news/1',
          source_name: '东方财富',
          published_at: '2026-08-18',
        },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);
    expect(result.notifiedCount).toBe(1);

    const event = db
      .prepare('SELECT e.*, t.status AS run_status FROM interest_event e JOIN task_run t ON t.id = e.task_run_id')
      .get() as any;
    expect(event.title).toBe('华友钴业上半年净利创新高');
    expect(event.summary).toBe('营收 555.68 亿元，同比增 49.39%');
    expect(event.run_status).toBe('success');

    const source = db.prepare('SELECT * FROM source WHERE event_id = ?').get(event.id) as any;
    expect(source.title).toBe('华友钴业发布半年报');

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.search_result_count).toBe(1);
    expect(run.llm_input_tokens).toBe(10);
    expect(run.llm_output_tokens).toBe(20);
    expect(run.sources_created_count).toBe(1);
  });

  it('writes sources without notifying when no channels configured', async () => {
    db.prepare('DELETE FROM notification_channel').run();

    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
    });
    const model = mockModel({
      has_progress: true,
      title: '华友钴业小动态',
      summary: '一般消息',
      source: [
        {
          title: '华友钴业小动态',
          source_url: 'https://example.com/news/2',
        },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);
    expect(result.notifiedCount).toBe(0);

    const event = db.prepare('SELECT * FROM interest_event ORDER BY id DESC LIMIT 1').get() as any;
    expect(event.title).toBe('华友钴业小动态');
    expect(event.summary).toBe('一般消息');

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
  });

  it('creates nothing when the model reports no progress', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });
    const model = mockModel({
      has_progress: false,
      title: '',
      summary: '',
      source: [],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(0);
    expect(result.notifiedCount).toBe(0);

    const events = db.prepare('SELECT * FROM interest_event').all();
    expect(events).toHaveLength(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
  });

  it('writes every source the model returns, without any importance filtering', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });
    const model = mockModel({
      has_progress: true,
      title: '本轮进展',
      summary: '本轮有实质进展',
      source: [
        { title: '进展一', source_url: 'https://example.com/a' },
        { title: '进展二', source_url: 'https://example.com/b' },
        { title: '进展三', source_url: 'https://example.com/c' },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(3);
    expect(result.notifiedCount).toBe(3);

    const sources = db.prepare('SELECT * FROM source').all() as any[];
    expect(sources.map((s) => s.title)).toEqual(['进展一', '进展二', '进展三']);

    const event = db.prepare('SELECT * FROM interest_event').get() as any;
    expect(event.title).toBe('本轮进展');
  });

  it('writes nothing when the model claims progress but returns no source', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
    });
    const model = mockModel({
      has_progress: true,
      title: '空进展',
      summary: '模型声称有进展，却没有给出任何来源',
      source: [],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(0);
    expect(result.notifiedCount).toBe(0);

    const events = db.prepare('SELECT * FROM interest_event').all();
    expect(events).toHaveLength(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
  });

  it('marks the run failed when search fails', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': { body: { error: 'boom' }, status: 500 },
      'open.feishu.cn': { code: 0 },
    });
    const model = mockModel({ has_progress: false, title: '', summary: '', source: [] });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('search_failed');
    expect(run.error_message).toBe('Tavily 搜索失败: HTTP 500');
  });

  it('writes the failure for the task owner, not user 1, when user_id is not 1', async () => {
    const otherInterest = db
      .prepare('INSERT INTO interest (user_id, name, tags) VALUES (2, ?, ?)')
      .run('苹果 Vision Pro', '["tech"]');
    const otherInterestId = Number(otherInterest.lastInsertRowid);
    const otherTask = db
      .prepare(
        'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (2, ?, ?, ?, 1)',
      )
      .run(otherInterestId, 'day', '09:00');
    const otherTaskId = Number(otherTask.lastInsertRowid);
    db.prepare(
      "INSERT INTO settings (user_id, search_api_key, ai_api_key) VALUES (2, 'tvly-test', 'sk-test')",
    ).run();

    const fetchImpl = mockFetch({
      'api.tavily.com': { body: { error: 'boom' }, status: 500 },
    });

    await runCheck(otherTaskId, {
      fetchImpl,
      model: mockModel({ has_progress: false, title: '', summary: '', source: [] }),
    });

    const run = db
      .prepare('SELECT * FROM task_run WHERE task_id = ?')
      .get(otherTaskId) as any;
    expect(run.user_id).toBe(2);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('search_failed');
  });

  it('marks the run failed when notify fails but sources were written', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 19021, msg: 'sign match fail' },
    });
    const model = mockModel({
      has_progress: true,
      title: '华友钴业重大消息',
      summary: '',
      source: [
        {
          title: '华友钴业重大消息',
          source_url: 'https://example.com/news/3',
        },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('notify_failed');
    expect(run.llm_input_tokens).toBe(10);
    expect(run.llm_output_tokens).toBe(20);
    expect(run.sources_created_count).toBe(1);

    const event = db.prepare('SELECT * FROM interest_event ORDER BY id DESC LIMIT 1').get() as any;
    expect(event).toBeTruthy();

    const source = db.prepare('SELECT * FROM source WHERE event_id = ?').get(event.id) as any;
    expect(source).toBeTruthy();
  });

  it('notifies across multiple picked channels', async () => {
    const defId = (db.prepare('SELECT id FROM notification_channel WHERE is_default = 1 LIMIT 1').get() as { id: number }).id;
    const ch2 = db
      .prepare(
        "INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default) VALUES (1, 'feishu', '飞书B', '{\"webhook_url\":\"https://other.feishu.cn/hook/x\",\"secret\":\"\"}', 1, 0)",
      )
      .run();
    const ch2Id = Number(ch2.lastInsertRowid);
    db.prepare('UPDATE interest SET channel_ids = ? WHERE id = ?').run(
      JSON.stringify([defId, ch2Id]),
      seedInterestId,
    );

    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
      'other.feishu.cn': { code: 0, msg: 'success' },
    });
    const model = mockModel({
      has_progress: true,
      title: '重大消息',
      summary: '',
      source: [{ title: '重大消息', source_url: 'https://example.com/x' }],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);
    expect(result.notifiedCount).toBe(2);
    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
  });

  it('marks failed when one of multiple channels fails', async () => {
    const defId = (db.prepare('SELECT id FROM notification_channel WHERE is_default = 1 LIMIT 1').get() as { id: number }).id;
    const ch2 = db
      .prepare(
        "INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default) VALUES (1, 'feishu', '飞书B', '{\"webhook_url\":\"https://other.feishu.cn/hook/x\",\"secret\":\"\"}', 1, 0)",
      )
      .run();
    const ch2Id = Number(ch2.lastInsertRowid);
    db.prepare('UPDATE interest SET channel_ids = ? WHERE id = ?').run(
      JSON.stringify([defId, ch2Id]),
      seedInterestId,
    );

    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
      'other.feishu.cn': { code: 19021, msg: 'sign fail' },
    });
    const model = mockModel({
      has_progress: true,
      title: '重大消息',
      summary: '',
      source: [{ title: '重大消息', source_url: 'https://example.com/x' }],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);
    expect(result.notifiedCount).toBe(1);
    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('notify_failed');
  });

  it('marks the run failed when the model output cannot be parsed', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });
    const model = mockModel({ elements: [] });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('llm_failed');
    expect(run.error_message).toContain('LLM 输出结构不符合预期');
    // 解析失败但 token 已经消耗，必须记账
    expect(run.llm_input_tokens).toBe(10);
    expect(run.llm_output_tokens).toBe(20);
    expect(run.summary).toBeNull();
  });

  it('skips the LLM entirely when search returns no results', async () => {
    const fetchImpl = mockFetch({ 'api.tavily.com': { results: [] } });
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

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(llmCalls).toBe(0);
    expect(result.createdCount).toBe(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.search_result_count).toBe(0);
    expect(run.summary).toBe('搜索未返回结果，已跳过 LLM 分析');
    // 搜索零结果由 analyze 内部短路，token 计 0（模型没有被调用）
    expect(run.llm_input_tokens).toBe(0);
  });

  it('fails before spending a search call when the AI key is missing', async () => {
    db.prepare('UPDATE settings SET ai_api_key = NULL WHERE user_id = 1').run();

    const calledUrls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calledUrls.push(String(input));
      throw new Error('不该发起任何外部请求');
    }) as typeof fetch;

    const result = await runCheck(seedTaskId, {
      fetchImpl,
      model: mockModel({ has_progress: false, title: '', summary: '', source: [] }),
    });

    expect(calledUrls).toHaveLength(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('llm_failed');
    expect(run.error_message).toBe('未配置 AI API Key');
    expect(run.search_result_count).toBeNull();
  });
});
