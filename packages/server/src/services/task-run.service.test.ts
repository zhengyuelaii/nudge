import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { taskRunService } from './task-run.service.js';

let seedTaskId = 0;
let seedInterestId = 0;

function seedInterestTask(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('华友钴业', '["company"]');
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
  it('succeed records the number of sources saved for this run', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.succeed(1, runId, {
      searchResultCount: 5,
      sourcesCreated: 3,
    });

    const row = db.prepare('SELECT sources_created_count FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.sources_created_count).toBe(3);
  });

  it('succeed leaves sources_created_count NULL when not provided', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.succeed(1, runId);

    const row = db.prepare('SELECT sources_created_count FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.sources_created_count).toBeNull();
  });

  it('fail leaves sources_created_count NULL', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.fail(1, runId, 'search_failed', new Error('Tavily HTTP 500'));

    const row = db.prepare('SELECT sources_created_count FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.sources_created_count).toBeNull();
  });

  it('list returns the saved sources count for each run', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.succeed(1, runId, { sourcesCreated: 4 });

    const rows = taskRunService.list(1, { limit: 10 });
    expect(rows[0].sources_created_count).toBe(4);
  });

  it('start creates a running task_run with run_mode and returns its id', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId, 'agent');

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row).not.toBeUndefined();
    expect(row.status).toBe('running');
    expect(row.run_mode).toBe('agent');
    expect(row.user_id).toBe(1);
    expect(row.started_at).toBeTruthy();
  });

  it('succeed marks the run as success with stats and duration', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);

    taskRunService.succeed(1, runId, {
      searchResultCount: 5,
    });

    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('success');
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
      .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
      .run('苹果 Vision Pro', '["tech"]');
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

  it('list paginates with limit/offset (newest first)', () => {
    const ids = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      ids[i] = taskRunService.start(1, seedTaskId, seedInterestId);
      taskRunService.succeed(1, ids[i]);
    }

    const page1 = taskRunService.list(1, { limit: 2, offset: 0 });
    const page2 = taskRunService.list(1, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page1[0].id).toBe(ids[2]);
    expect(page1[1].id).toBe(ids[1]);
    expect(page2).toHaveLength(1);
    expect(page2[0].id).toBe(ids[0]);
  });

  it('list filters by status and count matches', () => {
    const ok = taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.succeed(1, ok);
    const bad = taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.fail(1, bad, 'search_failed', new Error('boom'));

    const failed = taskRunService.list(1, { status: 'failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe(bad);
    expect(taskRunService.count(1, { status: 'failed' })).toBe(1);
    expect(taskRunService.count(1, { status: 'success' })).toBe(1);
  });

  it('count returns total for a user/interest', () => {
    taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.succeed(1, taskRunService.start(1, seedTaskId, seedInterestId));

    expect(taskRunService.count(1)).toBe(3);
    expect(taskRunService.count(1, { interestId: seedInterestId })).toBe(3);
  });

  it('reapStale marks a long-running run as failed', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);
    db.prepare('UPDATE task_run SET started_at = ? WHERE id = ?').run('2026-08-19 09:30:00', runId);

    const reaped = taskRunService.reapStale(1, 10, '2026-08-19 10:00:00');

    expect(reaped).toBe(1);
    const row = db.prepare('SELECT * FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('failed');
    expect(row.error_type).toBe('unknown');
    expect(row.finished_at).toBe('2026-08-19 10:00:00');
    expect(row.duration_ms).toBe(30 * 60 * 1000);
    expect(row.error_message).toContain('执行中断');
  });

  it('reapStale leaves a recent running run alone', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);
    db.prepare('UPDATE task_run SET started_at = ? WHERE id = ?').run('2026-08-19 09:55:00', runId);

    expect(taskRunService.reapStale(1, 10, '2026-08-19 10:00:00')).toBe(0);

    const row = db.prepare('SELECT status FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('running');
  });

  it('reapStale does not touch finished runs', () => {
    const runId = taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.succeed(1, runId);
    db.prepare('UPDATE task_run SET started_at = ? WHERE id = ?').run('2026-08-19 09:00:00', runId);

    expect(taskRunService.reapStale(1, 10, '2026-08-19 10:00:00')).toBe(0);

    const row = db.prepare('SELECT status FROM task_run WHERE id = ?').get(runId) as any;
    expect(row.status).toBe('success');
  });
});
