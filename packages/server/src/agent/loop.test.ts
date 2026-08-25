import { describe, it, expect, beforeEach } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { db } from '../db/client.js';
import { taskRunService } from '../services/task-run.service.js';
import { runAgentCheck } from './loop.js';

const SEARCH_RESULTS = {
  results: [
    {
      title: '华友钴业上半年净利润创新高',
      url: 'https://example.com/news/1',
      content: '上半年营收 555.68 亿元，同比增长 49.39%。',
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
    "UPDATE settings SET search_api_key = 'tvly-test', ai_api_key = 'sk-test', ai_model = 'deepseek-v4-flash', notify_threshold = 7, agent_max_steps = 8 WHERE user_id = 1",
  ).run();

  db.prepare(
    `INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
     VALUES (1, 'feishu', '飞书', '{"webhook_url":"https://open.feishu.cn/open-apis/bot/v2/hook/test","secret":""}', 1, 1)`,
  ).run();
}

beforeEach(() => {
  db.exec(
    'DELETE FROM "update"; DELETE FROM task_run; DELETE FROM interest_state; DELETE FROM notification_channel; DELETE FROM task; DELETE FROM interest;',
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
    throw new Error('Unexpected fetch to ' + url);
  }) as typeof fetch;
}

function makeToolCall(toolName: string, args: unknown, callId: string) {
  return {
    type: 'tool-call' as const,
    toolCallType: 'function' as const,
    toolCallId: callId,
    toolName,
    input: JSON.stringify(args),
  };
}

function mockModelSequential(steps: Array<{ content: Array<Record<string, unknown>> }>) {
  let callIndex = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (callIndex < steps.length) {
        const step = steps[callIndex];
        callIndex++;
        return {
          content: step.content,
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

describe('runAgentCheck', () => {
  it('runs agent loop: search -> save_update -> save_state -> done', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });

    const model = mockModelSequential([
      { content: [makeToolCall('web_search', { query: '华友钴业 最新', timeRange: 'week' }, 'c1')] },
      { content: [makeToolCall('save_update', { title: '华友钴业净利创新高', summary: '营收增长', source_url: 'https://example.com/news/1', importance: 9, has_progress: true }, 'c2')] },
      { content: [makeToolCall('save_state', { summary: '华友钴业上半年业绩创新高', key_points: ['净利润增长'], query_hints_next: ['关注下半年业绩'], has_new_progress: true }, 'c3')] },
      { content: [makeToolCall('report_progress', { stage: 'done', message: '巡检完成' }, 'c4')] },
    ]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    expect(result.runId).toBeDefined();
    expect(result.stepCount).toBeGreaterThanOrEqual(1);

    const updates = db.prepare('SELECT * FROM "update" WHERE interest_id = ?').all(seedInterestId) as any[];
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].title).toBe('华友钴业净利创新高');

    const state = db.prepare('SELECT * FROM interest_state WHERE interest_id = ?').get(seedInterestId) as any;
    expect(state).toBeDefined();
    expect(state.summary).toBe('华友钴业上半年业绩创新高');

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.agent_steps).toBeGreaterThanOrEqual(1);
  });

  it('marks failed when LLM throws', async () => {
    const fetchImpl = mockFetch({ 'api.tavily.com': SEARCH_RESULTS });
    const model = new MockLanguageModelV4({
      doGenerate: async () => { throw new Error('LLM timeout'); },
    });

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    expect(result.stepCount).toBe(0);
    expect(result.savedCount).toBe(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('failed');
    expect(run.error_type).toBe('llm_failed');
  });

  it('returns zero counts when agent calls no tools', async () => {
    const fetchImpl = mockFetch({ 'api.tavily.com': SEARCH_RESULTS });
    const model = mockModelSequential([]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    expect(result.savedCount).toBe(0);
    expect(result.notifiedCount).toBe(0);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.agent_steps).toBe(1);
  });

  it('runs with trace enabled without error', async () => {
    db.prepare('UPDATE settings SET agent_trace_enabled = 1 WHERE user_id = 1').run();

    const fetchImpl = mockFetch({ 'api.tavily.com': SEARCH_RESULTS });
    const model = mockModelSequential([]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.agent_steps).toBe(1);
  });

  it('notifies via notify_user tool', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });

    const model = mockModelSequential([
      { content: [makeToolCall('save_update', { title: '重大消息', source_url: 'https://example.com/news/1', importance: 9, has_progress: true }, 'c1')] },
      { content: [makeToolCall('notify_user', { message: '重大变化！' }, 'c2')] },
    ]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    expect(result.notifiedCount).toBeGreaterThanOrEqual(1);

    const update = db.prepare('SELECT is_notified FROM "update" WHERE interest_id = ?').get(seedInterestId) as any;
    expect(update.is_notified).toBe(1);
  });
});
