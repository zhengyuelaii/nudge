import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';
import { taskRunService } from '../services/task-run.service.js';

let seedTaskId = 0;
let seedInterestId = 0;

beforeEach(() => {
  db.exec('DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');

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
});

describe('GET /api/task-runs', () => {
  it('lists runs newest first with interest name', async () => {
    const a = taskRunService.start(1, seedTaskId, seedInterestId);
    const b = taskRunService.start(1, seedTaskId, seedInterestId);
    taskRunService.succeed(1, a, { searchResultCount: 3 });
    taskRunService.fail(1, b, 'search_failed', new Error('boom'));

    const res = await app.request('/api/task-runs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe(b);
    expect(body.data[0].status).toBe('failed');
    expect(body.data[0].interest_name).toBe('华友钴业');
  });

  it('filters by interest_id query param', async () => {
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

    const res = await app.request(`/api/task-runs?interest_id=${seedInterestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].interest_id).toBe(seedInterestId);
  });

  it('rejects invalid query params with 400', async () => {
    const res = await app.request('/api/task-runs?interest_id=abc');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
  });
});
