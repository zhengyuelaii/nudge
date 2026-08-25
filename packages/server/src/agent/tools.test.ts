import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { buildTools, type ToolContext } from './tools.js';
import { createTrace } from './trace.js';
import { stateService } from '../services/state.service.js';

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
    "UPDATE settings SET search_api_key = 'tvly-test', ai_api_key = 'sk-test', notify_threshold = 7 WHERE user_id = 1",
  ).run();
}

beforeEach(() => {
  db.exec('DELETE FROM "update"; DELETE FROM task_run; DELETE FROM interest_state; DELETE FROM task; DELETE FROM interest;');
  seed();
});

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 1,
    interest: { id: seedInterestId, name: '华友钴业', tags: ['company'], query_keywords: '华友钴业 股价' },
    settings: { search_api_key: 'tvly-test', notify_threshold: 7, notify_guard: 0 },
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

    it('returns existing state', async () => {
      stateService.upsert(1, seedInterestId, {
        summary: '黄金价格稳定',
        key_points: ['价格在 2000'],
        query_hints_next: ['关注美联储'],
        has_new_progress: true,
        last_checked_at: '2026-01-01 00:00:00',
      });

      const tools = buildTools(makeCtx());
      const result = await (tools.get_last_state.execute as Function)({});
      expect(result.summary).toBe('黄金价格稳定');
      expect(result.key_points).toEqual(['价格在 2000']);
    });
  });

  describe('save_update', () => {
    it('saves an update to the database', async () => {
      const tools = buildTools(makeCtx());
      const result = await (tools.save_update.execute as Function)({
        title: '华友钴业净利创新高',
        summary: '营收增长',
        source_url: 'https://example.com/news/1',
        source_name: '东方财富',
        importance: 9,
        has_progress: true,
      });

      expect(result.saved).toBe(true);
      expect(result.id).toBeDefined();

      const row = db.prepare('SELECT * FROM "update" WHERE id = ?').get(result.id) as any;
      expect(row.title).toBe('华友钴业净利创新高');
      expect(row.importance).toBe(9);
    });

    it('returns duplicate for same content', async () => {
      const tools = buildTools(makeCtx());
      await (tools.save_update.execute as Function)({
        title: '华友钴业净利创新高',
        source_url: 'https://example.com/news/1',
        importance: 9,
      });
      const result = await (tools.save_update.execute as Function)({
        title: '华友钴业净利创新高',
        source_url: 'https://example.com/news/1',
        importance: 9,
      });

      expect(result.saved).toBe(false);
      expect(result.duplicate).toBe(true);
    });
  });

  describe('save_state', () => {
    it('creates state in the database', async () => {
      const tools = buildTools(makeCtx());
      const result = await (tools.save_state.execute as Function)({
        summary: '黄金价格稳定',
        key_points: ['价格在 2000'],
        query_hints_next: ['关注美联储'],
        has_new_progress: true,
      });

      expect(result.saved).toBe(true);

      const state = stateService.get(1, seedInterestId);
      expect(state).not.toBeNull();
      expect(state!.summary).toBe('黄金价格稳定');
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

  describe('get_recent_updates', () => {
    it('returns empty array when no updates', async () => {
      const tools = buildTools(makeCtx());
      const result = await (tools.get_recent_updates.execute as Function)({});
      expect(result).toEqual([]);
    });

    it('returns recent updates', async () => {
      db.prepare(
        'INSERT INTO "update" (user_id, interest_id, title, importance, has_progress) VALUES (1, ?, ?, ?, ?)',
      ).run(seedInterestId, '测试更新', 8, 1);

      const tools = buildTools(makeCtx());
      const result = await (tools.get_recent_updates.execute as Function)({ limit: 5 });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('测试更新');
    });
  });
});
