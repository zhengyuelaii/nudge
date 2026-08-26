import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { eventService } from './event.service.js';

let seedInterestId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('黄金投资', '["gold"]');
  seedInterestId = Number(interest.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM source; DELETE FROM interest_event; DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

describe('eventService.create', () => {
  it('creates an event and returns it', () => {
    const event = eventService.create(1, {
      interestId: seedInterestId,
      title: '黄金价格创新高',
      runAt: '2026-08-25 10:00:00',
      summary: '国际金价突破 2500 美元',
    });

    expect(event.id).toBeGreaterThan(0);
    expect(event.title).toBe('黄金价格创新高');
    expect(event.interest_id).toBe(seedInterestId);
    expect(event.source_count).toBe(0);
    expect(event.summary).toBe('国际金价突破 2500 美元');
  });

  it('creates event with optional task_run_id', () => {
    const task = db.prepare('INSERT INTO task (user_id, interest_id, frequency, time) VALUES (1, ?, ?, ?)')
      .run(seedInterestId, 'day', '09:00');
    const taskRun = db.prepare('INSERT INTO task_run (user_id, task_id, interest_id, status, started_at) VALUES (1, ?, ?, ?, ?)')
      .run(task.lastInsertRowid, seedInterestId, 'running', '2026-08-25 09:00:00');

    const event = eventService.create(1, {
      interestId: seedInterestId,
      taskRunId: Number(taskRun.lastInsertRowid),
      title: '黄金价格创新高',
      runAt: '2026-08-25 09:00:00',
    });

    expect(event.task_run_id).toBe(Number(taskRun.lastInsertRowid));
  });
});

describe('eventService.list', () => {
  beforeEach(() => {
    eventService.create(1, { interestId: seedInterestId, title: '事件1', runAt: '2026-08-25 10:00:00' });
    eventService.create(1, { interestId: seedInterestId, title: '事件2', runAt: '2026-08-24 10:00:00' });
  });

  it('returns events ordered by run_at DESC', () => {
    const events = eventService.list(1);
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('事件1');
    expect(events[1].title).toBe('事件2');
  });

  it('supports pagination', () => {
    const events = eventService.list(1, { limit: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('事件1');
  });

  it('filters by interest_id', () => {
    const otherInterest = db.prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)').run('AI 大模型', '["ai"]');
    eventService.create(1, { interestId: Number(otherInterest.lastInsertRowid), title: 'AI事件', runAt: '2026-08-25 11:00:00' });

    const events = eventService.list(1, { interestId: seedInterestId });
    expect(events).toHaveLength(2);
    expect(events.every(e => e.interest_id === seedInterestId)).toBe(true);
  });

  it('includes interest_name from JOIN', () => {
    const events = eventService.list(1);
    expect(events[0].interest_name).toBe('黄金投资');
  });
});

describe('eventService.get', () => {
  it('returns event with sources', () => {
    const event = eventService.create(1, {
      interestId: seedInterestId,
      title: '黄金价格创新高',
      runAt: '2026-08-25 10:00:00',
    });

    db.prepare(`INSERT INTO source (user_id, interest_id, event_id, title, source_name) VALUES (?, ?, ?, ?, ?)`)
      .run(1, seedInterestId, event.id, '金价突破 2500', '路透社');

    const result = eventService.get(1, event.id);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].title).toBe('金价突破 2500');
  });

  it('throws for non-existent event', () => {
    expect(() => eventService.get(1, 999)).toThrow('更新事件不存在');
  });
});

describe('eventService.updateSourceCount', () => {
  it('updates source_count', () => {
    const event = eventService.create(1, {
      interestId: seedInterestId,
      title: '黄金价格创新高',
      runAt: '2026-08-25 10:00:00',
    });

    eventService.updateSourceCount(1, event.id, 5);
    const updated = db.prepare('SELECT source_count FROM interest_event WHERE id = ?').get(event.id) as { source_count: number };
    expect(updated.source_count).toBe(5);
  });
});
