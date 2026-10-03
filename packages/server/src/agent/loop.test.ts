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
  it('runs agent loop: search -> save_source -> report_progress -> done', async () => {
    // 预置上轮来源（task_run_id 为 NULL），验证记账取本轮增量而非该兴趣历史累计
    const prevEvent = db
      .prepare(
        "INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (1, ?, '上轮事件', '2026-08-17 09:00:00')",
      )
      .run(seedInterestId);
    db.prepare('INSERT INTO source (user_id, interest_id, event_id, title) VALUES (1, ?, ?, ?)')
      .run(seedInterestId, Number(prevEvent.lastInsertRowid), '上轮来源');

    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });

    const model = mockModelSequential([
      { content: [makeToolCall('web_search', { query: '华友钴业 最新', timeRange: 'week' }, 'c1')] },
      { content: [makeToolCall('save_source', { title: '华友钴业净利创新高', summary: '营收增长', source_url: 'https://example.com/news/1' }, 'c2')] },
      { content: [makeToolCall('report_progress', { stage: 'done', message: '巡检完成' }, 'c3')] },
    ]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    expect(result.runId).toBeDefined();
    expect(result.stepCount).toBeGreaterThanOrEqual(1);
    expect(result.savedCount).toBe(1);

    const sources = db.prepare('SELECT * FROM source WHERE interest_id = ?').all(seedInterestId) as any[];
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.title)).toContain('华友钴业净利创新高');

    const event = db
      .prepare('SELECT * FROM interest_event WHERE interest_id = ? AND title = ?')
      .get(seedInterestId, '华友钴业净利创新高') as any;
    expect(event).toBeDefined();
    expect(event.task_run_id).toBe(result.runId);

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.agent_steps).toBeGreaterThanOrEqual(1);
    expect(run.sources_created_count).toBe(1);
    expect(run.search_result_count).toBe(1);
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

  it('writes trace into task_run when agent_trace_enabled is true', async () => {
    db.prepare('UPDATE settings SET extra = ? WHERE user_id = 1').run(JSON.stringify({ agent_trace_enabled: true }));

    const fetchImpl = mockFetch({ 'api.tavily.com': SEARCH_RESULTS });
    const model = mockModelSequential([
      { content: [makeToolCall('report_progress', { stage: 'thinking', message: '开始巡检' }, 'c1')] },
    ]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.agent_steps).toBeGreaterThanOrEqual(1);
    expect(run.trace).toBeTruthy();
    const events = JSON.parse(run.trace!) as Array<{ kind: string; stage?: string }>;
    expect(events.some((e) => e.kind === 'progress' && e.stage === 'thinking')).toBe(true);
    expect(run.trace_text).toContain('深度思考');
  });

  it('does not collect trace when extra is non-empty but agent_trace_enabled is false', async () => {
    db.prepare('UPDATE settings SET extra = ? WHERE user_id = 1').run(JSON.stringify({ agent_trace_enabled: false }));

    const fetchImpl = mockFetch({ 'api.tavily.com': SEARCH_RESULTS });
    const model = mockModelSequential([
      { content: [makeToolCall('report_progress', { stage: 'thinking', message: '开始巡检' }, 'c1')] },
    ]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    const run = taskRunService.get(1, result.runId);
    expect(run.status).toBe('success');
    expect(run.trace).toBeNull();
    expect(run.trace_text).toBeNull();
  });

  it('notifies via notify_user tool', async () => {
    const fetchImpl = mockFetch({
      'api.tavily.com': SEARCH_RESULTS,
      'open.feishu.cn': { code: 0, msg: 'success' },
    });

    const model = mockModelSequential([
      { content: [makeToolCall('save_source', { title: '重大消息', source_url: 'https://example.com/news/1' }, 'c1')] },
      { content: [makeToolCall('notify_user', { message: '重大变化！' }, 'c2')] },
    ]);

    const result = await runAgentCheck(seedTaskId, { fetchImpl, model });

    expect(result.notifiedCount).toBeGreaterThanOrEqual(1);

    const source = db.prepare('SELECT * FROM source WHERE interest_id = ?').get(seedInterestId) as any;
    expect(source).toBeTruthy();
  });
});
