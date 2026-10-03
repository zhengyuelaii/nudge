import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { buildTools, type ToolContext } from './tools.js';
import { createTrace } from './trace.js';

let seedInterestId = 0;
let seedTaskId = 0;
let seedRunId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags, query_keywords) VALUES (1, ?, ?, ?)')
    .run('华友钴业', '["company"]', '华友钴业 股价');
  seedInterestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare('INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)')
    .run(seedInterestId, 'day', '09:00');
  seedTaskId = Number(task.lastInsertRowid);
  const run = db
    .prepare("INSERT INTO task_run (user_id, task_id, interest_id, status, started_at) VALUES (1, ?, ?, 'running', datetime('now'))")
    .run(seedTaskId, seedInterestId);
  seedRunId = Number(run.lastInsertRowid);

  db.prepare(
    "UPDATE settings SET search_api_key = 'tvly-test', ai_api_key = 'sk-test' WHERE user_id = 1",
  ).run();
}

beforeEach(() => {
  db.exec('DELETE FROM source; DELETE FROM interest_event; DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 1,
    interest: { id: seedInterestId, name: '华友钴业', tags: ['company'], query_keywords: '华友钴业 股价' },
    settings: { search_api_key: 'tvly-test' },
    runId: seedRunId,
    trace: createTrace({ enabled: false }),
    ...overrides,
  };
}

describe('agent tools', () => {
  describe('get_last_state', () => {
    it('returns placeholder when no state exists', async () => {
      const tools = buildTools(makeCtx());
      const result = await (tools.get_last_state.execute as Function)({});
      expect(result.summary).toContain('首次巡检');
      expect(result.key_points).toEqual([]);
    });

    it('returns state derived from recent events', async () => {
      const event = db.prepare(
        "INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (1, ?, ?, datetime('now'))",
      ).run(seedInterestId, '黄金价格稳定');
      const eventId = Number(event.lastInsertRowid);
      db.prepare(
        'INSERT INTO source (user_id, interest_id, event_id, title) VALUES (1, ?, ?, ?)',
      ).run(seedInterestId, eventId, '价格在 2000');

      const tools = buildTools(makeCtx());
      const result = await (tools.get_last_state.execute as Function)({});
      expect(result.summary).toBe('黄金价格稳定');
      expect(result.key_points).toContain('价格在 2000');
    });
  });

  describe('save_source', () => {
    it('saves a source to the database', async () => {
      const tools = buildTools(makeCtx());
      const result = await (tools.save_source.execute as Function)({
        title: '华友钴业净利创新高',
        summary: '营收增长',
        source_url: 'https://example.com/news/1',
        source_name: '东方财富',
      });

      expect(result.saved).toBe(true);
      expect(result.id).toBeDefined();

      const source = db.prepare('SELECT * FROM source WHERE id = ?').get(result.id) as any;
      expect(source.title).toBe('华友钴业净利创新高');

      const event = db.prepare('SELECT * FROM interest_event WHERE id = ?').get(source.event_id) as any;
      expect(event.title).toBe('华友钴业净利创新高');
    });
  });

  describe('report_progress', () => {
    it('pushes progress event to trace', async () => {
      const trace = createTrace({ enabled: true });
      const tools = buildTools(makeCtx({ trace }));
      const result = await (tools.report_progress.execute as Function)({
        stage: 'thinking',
        message: '正在分析',
      });

      expect(result.ok).toBe(true);
      const events = JSON.parse(trace.toJSON()) as any[];
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('progress');
      expect(events[0].stage).toBe('thinking');
    });
  });

  describe('get_recent_sources', () => {
    it('returns empty array when no sources', async () => {
      const tools = buildTools(makeCtx());
      const result = await (tools.get_recent_sources.execute as Function)({});
      expect(result).toEqual([]);
    });

    it('returns recent sources', async () => {
      const event = db.prepare(
        'INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (1, ?, ?, datetime(\'now\'))',
      ).run(seedInterestId, '测试事件');
      const eventId = Number(event.lastInsertRowid);

      db.prepare(
        'INSERT INTO source (user_id, interest_id, event_id, title) VALUES (1, ?, ?, ?)',
      ).run(seedInterestId, eventId, '测试来源');

      const tools = buildTools(makeCtx());
      const result = await (tools.get_recent_sources.execute as Function)({ limit: 5 });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('测试来源');
    });
  });

  describe('web_search', () => {
    it('counts returned results into runStats', async () => {
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify({
            results: [
              { title: 'A', url: 'https://example.com/a', content: 'a' },
              { title: 'B', url: 'https://example.com/b', content: 'b' },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch;

      const runStats = { notifiedCount: 0, searchResultCount: 0 };
      const tools = buildTools(makeCtx({ fetchImpl, runStats }));

      const results = await (tools.web_search.execute as Function)({ query: '华友钴业 最新' });

      expect(results).toHaveLength(2);
      expect(runStats.searchResultCount).toBe(2);
    });
  });
});
