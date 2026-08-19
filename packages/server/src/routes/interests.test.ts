import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';

vi.mock('../scheduler/check.js', () => ({
  runCheck: vi.fn(async () => ({
    runId: 1,
    searchResultCount: 3,
    createdCount: 1,
    notifiedCount: 1,
  })),
}));

let seedInterestId = 0;
let seedTaskId = 0;

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

describe('POST /api/interests/:id/check', () => {
  it('returns check result and refreshes last_run_at without touching next_run_at', async () => {
    const before = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;

    const res = await app.request(`/api/interests/${seedInterestId}/check`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      runId: 1,
      searchResultCount: 3,
      createdCount: 1,
      notifiedCount: 1,
    });

    const after = db.prepare('SELECT last_run_at, next_run_at FROM task WHERE id = ?').get(seedTaskId) as any;
    expect(after.last_run_at).toBeTruthy();
    expect(after.last_run_at).not.toBe(before.last_run_at);
    expect(after.next_run_at).toBe(before.next_run_at);
  });

  it('returns 404 when the interest does not exist', async () => {
    const res = await app.request('/api/interests/999/check', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
