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
    .prepare('INSERT INTO interest (user_id, name, category, query_keywords) VALUES (1, ?, ?, ?)')
    .run('华友钴业', 'company', '华友钴业 股价 最新');
  seedInterestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)',
    )
    .run(seedInterestId, 'day', '09:00');
  seedTaskId = Number(task.lastInsertRowid);

  db.prepare(
    "UPDATE settings SET search_api_key = 'tvly-test', ai_api_key = 'sk-test', ai_model = 'deepseek-v4-flash', notify_threshold = 7 WHERE user_id = 1",
  ).run();

  db.prepare(
    `INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
     VALUES (1, 'feishu', '默认飞书', '{"webhook_url":"https://open.feishu.cn/open-apis/bot/v2/hook/test","secret":""}', 1, 1)`,
  ).run();
}

beforeEach(() => {
  db.exec(
    'DELETE FROM "update"; DELETE FROM task_run; DELETE FROM notification_channel; DELETE FROM task; DELETE FROM interest;',
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
      elements: [
        {
          title: '华友钴业上半年净利创新高',
          summary: '营收 555.68 亿元，同比增 49.39%',
          source_url: 'https://example.com/news/1',
          source_name: '东方财富',
          published_at: '2026-08-18',
          importance: 9,
          has_progress: true,
        },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);
    expect(result.notifiedCount).toBe(1);

    const update = db
      .prepare(
        'SELECT u.*, t.status AS run_status FROM "update" u JOIN task_run t ON t.id = u.task_run_id',
      )
      .get() as any;
    expect(update.title).toBe('华友钴业上半年净利创新高');
    expect(update.importance).toBe(9);
    expect(update.has_progress).toBe(1);
    expect(update.is_notified).toBe(1);
    expect(update.notified_at).toBeTruthy();

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.search_result_count).toBe(1);
    expect(run.search_query).toBe('华友钴业 股价 最新');
    expect(run.llm_input_tokens).toBe(10);
    expect(run.llm_output_tokens).toBe(20);
  });

  it('writes below-threshold updates without notifying', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });
    const model = mockModel({
      elements: [
        {
          title: '华友钴业小动态',
          summary: '一般消息',
          source_url: 'https://example.com/news/2',
          importance: 4,
          has_progress: false,
        },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);
    expect(result.notifiedCount).toBe(0);

    const update = db
      .prepare('SELECT is_notified, notified_at FROM "update" WHERE id = (SELECT MAX(id) FROM "update")')
      .get() as any;
    expect(update.is_notified).toBe(0);
    expect(update.notified_at).toBeNull();

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
  });

  it('marks the run failed when search fails', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': { body: { error: 'boom' }, status: 500 },
      'open.feishu.cn': { code: 0 },
    });
    const model = mockModel({ elements: [] });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('search_failed');
    expect(run.error_message).toBe('Tavily 搜索失败: HTTP 500');
  });

  it('writes the failure for the task owner, not user 1, when user_id is not 1', async () => {
    const otherInterest = db
      .prepare('INSERT INTO interest (user_id, name, category) VALUES (2, ?, ?)')
      .run('苹果 Vision Pro', 'tech');
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

    await runCheck(otherTaskId, { fetchImpl, model: mockModel({ elements: [] }) });

    const run = db
      .prepare('SELECT * FROM task_run WHERE task_id = ?')
      .get(otherTaskId) as any;
    expect(run.user_id).toBe(2);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('search_failed');
  });

  it('marks the run partial when notify fails but updates were written', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 19021, msg: 'sign match fail' },
    });
    const model = mockModel({
      elements: [
        {
          title: '华友钴业重大消息',
          source_url: 'https://example.com/news/3',
          importance: 9,
        },
      ],
    });

    const result = await runCheck(seedTaskId, { fetchImpl, model });

    expect(result.createdCount).toBe(1);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('partial');
    expect(run.error_type).toBe('notify_failed');
    expect(run.llm_input_tokens).toBe(10);
    expect(run.llm_output_tokens).toBe(20);

    const update = db
      .prepare('SELECT is_notified FROM "update" WHERE id = (SELECT MAX(id) FROM "update")')
      .get() as any;
    expect(update.is_notified).toBe(0);
  });
});