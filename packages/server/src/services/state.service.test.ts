import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { stateService } from './state.service.js';

let seedInterestId = 0;

function seedInterest(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('黄金价格', '["commodity"]');
  seedInterestId = Number(interest.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM source; DELETE FROM interest_event; DELETE FROM interest;');
  seedInterest();
});

describe('stateService', () => {
  it('returns null when there is no event history', () => {
    const state = stateService.get(1, seedInterestId);
    expect(state).toBeNull();
  });

  it('returns state derived from the most recent event summary', () => {
    const event = db
      .prepare(
        "INSERT INTO interest_event (user_id, interest_id, title, summary, run_at) VALUES (1, ?, ?, ?, '2026-08-20 09:00:00')",
      )
      .run(seedInterestId, '黄金价格突破 2000 美元', '现货黄金盘中首次站上 2000 美元大关');
    const eventId = Number(event.lastInsertRowid);

    db.prepare(
      'INSERT INTO source (user_id, interest_id, event_id, title) VALUES (1, ?, ?, ?)',
    ).run(seedInterestId, eventId, '现货黄金创历史新高');

    const state = stateService.get(1, seedInterestId);
    expect(state).not.toBeNull();
    expect(state!.summary).toBe('现货黄金盘中首次站上 2000 美元大关');
    expect(state!.key_points).toContain('现货黄金创历史新高');
    expect(state!.last_checked_at).toBe('2026-08-20 09:00:00');
  });

  it('falls back to event title when the event has no summary', () => {
    db.prepare(
      "INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (1, ?, '黄金价格突破 2000 美元', '2026-08-20 09:00:00')",
    ).run(seedInterestId);

    const state = stateService.get(1, seedInterestId);
    expect(state!.summary).toBe('黄金价格突破 2000 美元');
  });

  it('prefers the newest event when multiple exist', () => {
    db.prepare(
      "INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (1, ?, '旧事件', '2026-08-10 09:00:00')",
    ).run(seedInterestId);
    db.prepare(
      "INSERT INTO interest_event (user_id, interest_id, title, run_at) VALUES (1, ?, '新事件', '2026-08-20 09:00:00')",
    ).run(seedInterestId);

    const state = stateService.get(1, seedInterestId);
    expect(state!.summary).toBe('新事件');
  });

  it('upsert is a no-op (history lives in events)', () => {
    expect(() =>
      stateService.upsert(1, seedInterestId, {
        summary: 'x',
        key_points: ['k'],
        query_hints_next: ['q'],
        has_new_progress: true,
        last_checked_at: '2026-08-20 09:00:00',
      }),
    ).not.toThrow();

    expect(stateService.get(1, seedInterestId)).toBeNull();
  });

  it('returns null for a non-existent interest', () => {
    expect(stateService.get(1, 99999)).toBeNull();
  });
});
