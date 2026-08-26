import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';

let seedInterestId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('黄金投资', '["gold"]');
  seedInterestId = Number(interest.lastInsertRowid);

  const event = db
    .prepare('INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (?, ?, ?, ?)')
    .run(1, seedInterestId, '黄金价格创新高', '2026-08-25 10:00:00');
  const eventId = Number(event.lastInsertRowid);

  db.prepare(`INSERT INTO source (user_id, interest_id, event_id, title, source_name, source_url)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(1, seedInterestId, eventId, '金价突破 2500 美元', '路透社', 'https://reuters.com/gold');
}

beforeEach(() => {
  db.exec('DELETE FROM source; DELETE FROM interest_event; DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

describe('GET /api/events', () => {
  it('lists events with nested sources', async () => {
    const res = await app.request('/api/events');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe('黄金价格创新高');
    expect(body.data[0].sources).toHaveLength(1);
    expect(body.data[0].sources[0].title).toBe('金价突破 2500 美元');
  });

  it('filters by interest_id', async () => {
    const otherInterest = db.prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)').run('AI 大模型', '["ai"]');
    db.prepare('INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (?, ?, ?, ?)')
      .run(1, Number(otherInterest.lastInsertRowid), 'AI 事件', '2026-08-25 11:00:00');

    const res = await app.request(`/api/events?interest_id=${seedInterestId}`);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].interest_id).toBe(seedInterestId);
  });

  it('rejects invalid query params', async () => {
    const res = await app.request('/api/events?interest_id=abc');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/events/:id', () => {
  it('returns a single event with sources', async () => {
    const listRes = await app.request('/api/events');
    const listBody = await listRes.json();
    const eventId = listBody.data[0].id;

    const res = await app.request(`/api/events/${eventId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe('黄金价格创新高');
    expect(body.data.sources).toHaveLength(1);
  });

  it('returns 404 for non-existent event', async () => {
    const res = await app.request('/api/events/999');
    expect(res.status).toBe(404);
  });
});
