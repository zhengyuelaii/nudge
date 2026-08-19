import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { findDueTasks, runDueTasks } from './index.js';

let seedTaskId = 0;
let otherTaskId = 0;

function seedTask(enabled: number, nextRun: string | null): number {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, category) VALUES (1, ?, ?)')
    .run('华友钴业', 'company');
  const interestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      `INSERT INTO task (user_id, interest_id, frequency, time, enabled, next_run_at)
       VALUES (1, ?, 'day', '09:00', ?, ?)`,
    )
    .run(interestId, enabled, nextRun);
  return Number(task.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seedTaskId = seedTask(1, '2026-08-18 09:00:00');
  otherTaskId = seedTask(1, '2026-08-18 09:00:00');
});

describe('findDueTasks', () => {
  it('returns only enabled tasks whose next_run_at is due', () => {
    const due = findDueTasks('2026-08-19 10:00:00');
    expect(due.map((t) => t.id).sort()).toEqual([seedTaskId, otherTaskId].sort());
    expect(due[0].user_id).toBe(1);
  });

  it('excludes disabled tasks', () => {
    db.prepare('UPDATE task SET enabled = 0 WHERE id = ?').run(seedTaskId);
    const due = findDueTasks('2026-08-19 10:00:00');
    expect(due.map((t) => t.id)).toEqual([otherTaskId]);
  });

  it('excludes tasks with a future next_run_at', () => {
    db.prepare('UPDATE task SET next_run_at = ? WHERE id = ?').run('2026-08-20 09:00:00', seedTaskId);
    const due = findDueTasks('2026-08-19 10:00:00');
    expect(due.map((t) => t.id)).toEqual([otherTaskId]);
  });

  it('excludes tasks without next_run_at', () => {
    db.prepare('UPDATE task SET next_run_at = NULL WHERE id = ?').run(seedTaskId);
    const due = findDueTasks('2026-08-19 10:00:00');
    expect(due.map((t) => t.id)).toEqual([otherTaskId]);
  });

  it('excludes a task that has a recent running task_run (cross-process guard)', () => {
    db.prepare(
      `INSERT INTO task_run (user_id, task_id, interest_id, status, started_at)
       VALUES (1, ?, (SELECT interest_id FROM task WHERE id = ?), 'running', ?)`,
    ).run(seedTaskId, seedTaskId, '2026-08-19 09:55:00');

    const due = findDueTasks('2026-08-19 10:00:00');
    expect(due.map((t) => t.id)).toEqual([otherTaskId]);
  });

  it('re-runs a task whose running task_run is stale (crash recovery)', () => {
    db.prepare(
      `INSERT INTO task_run (user_id, task_id, interest_id, status, started_at)
       VALUES (1, ?, (SELECT interest_id FROM task WHERE id = ?), 'running', ?)`,
    ).run(seedTaskId, seedTaskId, '2026-08-19 09:30:00');

    const due = findDueTasks('2026-08-19 10:00:00');
    expect(due.map((t) => t.id).sort()).toEqual([seedTaskId, otherTaskId].sort());
  });
});

describe('runDueTasks', () => {
  it('runs every due task and advances its schedule', async () => {
    const before = db.prepare('SELECT next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    const calls: number[] = [];
    const runner = async (taskId: number) => {
      calls.push(taskId);
    };

    const executed = await runDueTasks({ runner, now: '2026-08-19 10:00:00' });

    expect(executed.sort()).toEqual([seedTaskId, otherTaskId].sort());
    expect(calls.sort()).toEqual([seedTaskId, otherTaskId].sort());

    const after = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    expect(after.last_run_at).toBeTruthy();
    expect(after.next_run_at).not.toBe(before.next_run_at);
    expect(after.next_run_at).toBeTruthy();
  });

  it('skips a task that is already running', async () => {
    db.prepare('DELETE FROM task WHERE id != ?').run(seedTaskId);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const calls: number[] = [];
    const runner = async (taskId: number) => {
      calls.push(taskId);
      await gate;
    };

    const p1 = runDueTasks({ runner, now: '2026-08-19 10:00:00' });
    const p2 = runDueTasks({ runner, now: '2026-08-19 10:00:00' });
    release();
    await Promise.all([p1, p2]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(seedTaskId);
  });

  it('does not run tasks that are not yet due', async () => {
    db.prepare('UPDATE task SET next_run_at = ? WHERE id != ?').run('2026-08-20 09:00:00', otherTaskId);
    const calls: number[] = [];
    const runner = async (taskId: number) => {
      calls.push(taskId);
    };

    const executed = await runDueTasks({ runner, now: '2026-08-19 10:00:00' });

    expect(executed).toEqual([otherTaskId]);
    expect(calls).toEqual([otherTaskId]);
  });
});
