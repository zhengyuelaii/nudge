import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { stateService } from './state.service.js';

let seedInterestId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, tags) VALUES (1, ?, ?)')
    .run('华友钴业', '["company"]');
  seedInterestId = Number(interest.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM interest_state; DELETE FROM interest;');
  seed();
});

describe('stateService', () => {
  it('returns null when no state exists', () => {
    const state = stateService.get(1, seedInterestId);
    expect(state).toBeNull();
  });

  it('creates state via upsert', () => {
    stateService.upsert(1, seedInterestId, {
      summary: '黄金价格稳定',
      key_points: ['价格在 2000 美元/盎司'],
      query_hints_next: ['关注美联储政策'],
      has_new_progress: true,
      last_checked_at: '2026-01-01 00:00:00',
    });

    const state = stateService.get(1, seedInterestId);
    expect(state).not.toBeNull();
    expect(state!.summary).toBe('黄金价格稳定');
    expect(state!.key_points).toEqual(['价格在 2000 美元/盎司']);
    expect(state!.query_hints).toEqual(['关注美联储政策']);
    expect(state!.last_checked_at).toBe('2026-01-01 00:00:00');
    expect(state!.no_change_streak).toBe(0);
  });

  it('updates existing state via upsert', () => {
    stateService.upsert(1, seedInterestId, {
      summary: '初始状态',
      key_points: [],
      query_hints_next: [],
      has_new_progress: false,
      last_checked_at: '2026-01-01 00:00:00',
    });

    stateService.upsert(1, seedInterestId, {
      summary: '更新后状态',
      key_points: ['新发现'],
      query_hints_next: ['下次关注'],
      has_new_progress: true,
      last_checked_at: '2026-01-02 00:00:00',
    });

    const state = stateService.get(1, seedInterestId);
    expect(state!.summary).toBe('更新后状态');
    expect(state!.key_points).toEqual(['新发现']);
    expect(state!.no_change_streak).toBe(0);
  });

  it('increments no_change_streak when no progress', () => {
    stateService.upsert(1, seedInterestId, {
      summary: '状态1',
      key_points: [],
      query_hints_next: [],
      has_new_progress: false,
      last_checked_at: '2026-01-01 00:00:00',
    });

    stateService.upsert(1, seedInterestId, {
      summary: '状态2',
      key_points: [],
      query_hints_next: [],
      has_new_progress: false,
      last_checked_at: '2026-01-02 00:00:00',
    });

    const state = stateService.get(1, seedInterestId);
    expect(state!.no_change_streak).toBe(2);
  });

  it('resets no_change_streak when progress', () => {
    stateService.upsert(1, seedInterestId, {
      summary: '状态1',
      key_points: [],
      query_hints_next: [],
      has_new_progress: false,
      last_checked_at: '2026-01-01 00:00:00',
    });

    stateService.upsert(1, seedInterestId, {
      summary: '状态2',
      key_points: [],
      query_hints_next: [],
      has_new_progress: true,
      last_checked_at: '2026-01-02 00:00:00',
    });

    const state = stateService.get(1, seedInterestId);
    expect(state!.no_change_streak).toBe(0);
  });

  it('returns null for non-existent interest', () => {
    const state = stateService.get(1, 99999);
    expect(state).toBeNull();
  });
});
