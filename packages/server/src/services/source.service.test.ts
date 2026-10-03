import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { sourceService } from './source.service.js';

let seedInterestId = 0;
let seedEventId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('黄金投资', '["gold"]');
  seedInterestId = Number(interest.lastInsertRowid);

  const event = db
    .prepare('INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (?, ?, ?, ?)')
    .run(1, seedInterestId, '黄金价格创新高', '2026-08-25 10:00:00');
  seedEventId = Number(event.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM source; DELETE FROM interest_event; DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

describe('sourceService.createMany', () => {
  it('creates multiple sources and returns them', () => {
    const sources = sourceService.createMany(1, seedInterestId, seedEventId, [
      { title: '金价突破 2500', sourceName: '路透社', sourceUrl: 'https://reuters.com/gold' },
      { title: '黄金 ETF 持仓增加', sourceName: '东方财富' },
    ]);

    expect(sources).toHaveLength(2);
    expect(sources[0].title).toBe('金价突破 2500');
    expect(sources[0].source_name).toBe('路透社');
    expect(sources[0].event_id).toBe(seedEventId);
  });

  it('handles optional fields', () => {
    const sources = sourceService.createMany(1, seedInterestId, seedEventId, [
      { title: '金价突破 2500', summary: '详细摘要', publishedAt: '2026-08-25' },
    ]);

    expect(sources[0].summary).toBe('详细摘要');
    expect(sources[0].published_at).toBe('2026-08-25');
  });

  it('returns empty array for empty input', () => {
    const sources = sourceService.createMany(1, seedInterestId, seedEventId, []);
    expect(sources).toHaveLength(0);
  });
});

describe('sourceService.listByEvent', () => {
  beforeEach(() => {
    sourceService.createMany(1, seedInterestId, seedEventId, [
      { title: '来源1' },
      { title: '来源2' },
    ]);
  });

  it('returns sources for an event', () => {
    const sources = sourceService.listByEvent(1, seedEventId);
    expect(sources).toHaveLength(2);
  });

  it('returns empty for non-existent event', () => {
    const sources = sourceService.listByEvent(1, 999);
    expect(sources).toHaveLength(0);
  });
});

describe('sourceService.listByInterest', () => {
  beforeEach(() => {
    sourceService.createMany(1, seedInterestId, seedEventId, [
      { title: '来源1' },
    ]);

    const otherEvent = db.prepare('INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (?, ?, ?, ?)')
      .run(1, seedInterestId, '另一事件', '2026-08-24 10:00:00');
    sourceService.createMany(1, seedInterestId, Number(otherEvent.lastInsertRowid), [
      { title: '来源2' },
    ]);
  });

  it('returns all sources for an interest', () => {
    const sources = sourceService.listByInterest(1, seedInterestId);
    expect(sources).toHaveLength(2);
  });

  it('supports pagination', () => {
    const sources = sourceService.listByInterest(1, seedInterestId, { limit: 1 });
    expect(sources).toHaveLength(1);
  });
});

describe('sourceService.countByRun', () => {
  function seedRun(): number {
    const task = db
      .prepare("INSERT INTO task (user_id, interest_id, frequency, time, enabled) VALUES (1, ?, 'day', '09:00', 1)")
      .run(seedInterestId);
    const run = db
      .prepare("INSERT INTO task_run (user_id, task_id, interest_id, status, started_at) VALUES (1, ?, ?, 'running', datetime('now'))")
      .run(Number(task.lastInsertRowid), seedInterestId);
    return Number(run.lastInsertRowid);
  }

  it('counts only the sources created by that run', () => {
    const runId = seedRun();

    const runEvent = db
      .prepare("INSERT INTO interest_event (user_id, interest_id, task_run_id, title, run_at) VALUES (1, ?, ?, '本轮事件', '2026-08-25 11:00:00')")
      .run(seedInterestId, runId);
    sourceService.createMany(1, seedInterestId, Number(runEvent.lastInsertRowid), [
      { title: '本轮来源1' },
      { title: '本轮来源2' },
    ]);

    sourceService.createMany(1, seedInterestId, seedEventId, [{ title: '上轮来源' }]);

    expect(sourceService.countByRun(1, runId)).toBe(2);
  });

  it('returns 0 when the run saved nothing', () => {
    const runId = seedRun();
    expect(sourceService.countByRun(1, runId)).toBe(0);
  });
});
