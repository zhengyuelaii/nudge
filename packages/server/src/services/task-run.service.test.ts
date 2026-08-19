import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { taskRunService } from './task-run.service.js';

let seedTaskId = 0;
let seedInterestId = 0;

function seedInterestTask(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, category) VALUES (1, ?, ?)')
    .run('华友钴业', 'company');
  seedInterestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (?, ?, ?, ?, 1)',
    )
    .run(1, seedInterestId, 'day', '09:00');
  seedTaskId = Number(task.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seedInterestTask();
});

describe('taskRunService', () => {
  it('start creates a running task_run and returns its id', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row).not.toBeUndefined();
    expect(row.status).toBe('running');
    expect(row.user_id).toBe(1);
    expect(row.started_at).toBeTruthy();
  });

  it('succeed marks the run as success with stats and duration', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.succeed(1, runId, {
      searchQuery: '华友钴业 股价 最新',
      searchResultCount: 5,
    });

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('success');
    expect(row.search_query).toBe('华友钴业 股价 最新');
    expect(row.search_result_count).toBe(5);
    expect(row.finished_at).toBeTruthy();
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('fail marks the run as failed with error type and message', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.fail(1, runId, 'search_failed', new Error('Tavily HTTP 500'));

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('failed');
    expect(row.error_type).toBe('search_failed');
    expect(row.error_message).toBe('Tavily HTTP 500');
    expect(row.finished_at).toBeTruthy();
  });

  it('marks notify failures as partial status', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.partial(1, runId, 'notify_failed', new Error('飞书发送失败: 19021'));

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('partial');
    expect(row.error_type).toBe('notify_failed');
  });

  it('succeed records llm usage tokens', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.succeed(1, runId, {
      searchResultCount: 5,
      llmInputTokens: 1234,
      llmOutputTokens: 567,
    });

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.llm_input_tokens).toBe(1234);
    expect(row.llm_output_tokens).toBe(567);
  });

  it('partial records llm usage tokens', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.partial(
      1,
      runId,
      'notify_failed',
      new Error('飞书发送失败: 19021'),
      { inputTokens: 100, outputTokens: 50 },
    );

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('partial');
    expect(row.llm_input_tokens).toBe(100);
    expect(row.llm_output_tokens).toBe(50);
  });

  it('succeed stores duration in real milliseconds', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);
    const past = new Date(Date.now() - 5000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    db.prepare('UPDATE task_run SET started_at = ? WHERE id = ?').run(past, runId);

    taskRunService.succeed(1, runId);

    const row = db
      .prepare('SELECT duration_ms FROM task_run WHERE id = ?')
      .get(runId) as any;
    expect(Math.abs(row.duration_ms - 5000)).toBeLessThan(1500);
  });

  it('get throws when the run does not exist', () => {
    expect(() => taskRunService.get(1, 999)).toThrow('执行记录不存在');
  });

  it('list returns runs for a user, newest first, with interest name joined', () => {
    const a = taskRunService.start(1, seedTaskId, seedInterestId);
    const b = taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.succeed(1, a, { searchResultCount: 3 });
    taskRunService.fail(1, b, 'search_failed', new Error('boom'));

    const rows = taskRunService.list(1, { limit: 10 });

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(b);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].interest_name).toBe('华友钴业');
    expect(rows[1].id).toBe(a);
  });

  it('list filters by interest_id', () => {
    const other = db
      .prepare('INSERT INTO interest (user_id, name, category) VALUES (1, ?, ?)')
      .run('苹果 Vision Pro', 'tech');
    const otherInterestId = Number(other.lastInsertRowid);
    const otherTask = db
      .prepare(
        'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)',
      )
      .run(otherInterestId, 'week', '14:00');
    const otherTaskId = Number(otherTask.lastInsertRowid);

    taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.start(1, otherTaskId, otherInterestId);

    const rows = taskRunService.list(1, { interestId: seedInterestId });
    expect(rows).toHaveLength(1);
    expect(rows[0].interest_id).toBe(seedInterestId);
  });
});