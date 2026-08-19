import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { interestService } from './interest.service.js';

let seedInterestId = 0;
let seedTaskId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, category) VALUES (1, ?, ?)')
    .run('华友钴业', 'company');
  seedInterestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)',
    )
    .run(seedInterestId, 'day', '09:00');
  seedTaskId = Number(task.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

describe('interestService.markTaskRun', () => {
  it('updates last_run_at without touching next_run_at when advanceNext is false', () => {
    const before = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;

    interestService.markTaskRun(1, seedTaskId, { advanceNext: false });

    const after = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    expect(after.last_run_at).toBeTruthy();
    expect(after.last_run_at).not.toBe(before.last_run_at);
    expect(after.next_run_at).toBe(before.next_run_at);
  });

  it('rolls next_run_at forward when advanceNext is true', () => {
    const before = db.prepare('SELECT next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;

    interestService.markTaskRun(1, seedTaskId, { advanceNext: true });

    const after = db.prepare('SELECT next_run_at, last_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    expect(after.last_run_at).toBeTruthy();
    expect(after.next_run_at).not.toBe(before.next_run_at);
    expect(after.next_run_at).toBeTruthy();
  });

  it('throws when the task does not exist', () => {
    expect(() => interestService.markTaskRun(1, 999, { advanceNext: false })).toThrow('任务不存在');
  });
});
