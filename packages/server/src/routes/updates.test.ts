import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';

beforeEach(() => {
  db.exec('DELETE FROM "update"; DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');

  const interest = db
    .prepare('INSERT INTO interest (user_id, name, category) VALUES (1, ?, ?)')
    .run('华友钴业', 'company');
  const interestId = Number(interest.lastInsertRowid);
  const task = db
    .prepare(
      'INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, ?, ?, 1)',
    )
    .run(interestId, 'day', '09:00');
  const taskId = Number(task.lastInsertRowid);
  db.prepare(
    `INSERT INTO task_run (user_id, task_id, interest_id, status, started_at)
     VALUES (1, ?, ?, 'success', '2026-08-19 09:00:00')`,
  ).run(taskId, interestId);
  db.prepare(
    `INSERT INTO "update" (user_id, interest_id, task_run_id, title, importance, created_at)
     VALUES (1, ?, ?, ?, 8, '2026-08-19 09:00:00')`,
  ).run(interestId, taskId, '华友钴业营收创新高');
});

describe('GET /api/updates', () => {
  it('lists updates and accepts numeric filters', async () => {
    const res = await app.request('/api/updates?limit=10&interest_id=1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe('华友钴业营收创新高');
  });

  it('rejects invalid query params with 400', async () => {
    const res = await app.request('/api/updates?interest_id=abc');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
  });

  it('paginates with offset', async () => {
    const row = db
      .prepare('SELECT interest_id, task_run_id FROM "update" LIMIT 1')
      .get() as { interest_id: number; task_run_id: number };
    db.prepare(
      `INSERT INTO "update" (user_id, interest_id, task_run_id, title, importance, created_at)
       VALUES (1, ?, ?, ?, 8, '2026-08-19 08:00:00')`,
    ).run(row.interest_id, row.task_run_id, '早期动态');

    const page1 = await app.request('/api/updates?limit=1');
    const b1 = await page1.json();
    expect(b1.data).toHaveLength(1);
    expect(b1.data[0].title).toBe('华友钴业营收创新高');

    const page2 = await app.request('/api/updates?limit=1&offset=1');
    const b2 = await page2.json();
    expect(b2.data).toHaveLength(1);
    expect(b2.data[0].title).toBe('早期动态');
  });
});
