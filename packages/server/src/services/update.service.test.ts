import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { updateService } from './update.service.js';

let seedInterestId = 0;

function seed(): void {
  const interest = db
    .prepare('INSERT INTO interest (user_id, name, category) VALUES (1, ?, ?)')
    .run('华友钴业', 'company');
  seedInterestId = Number(interest.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM "update"; DELETE FROM task_run; DELETE FROM task; DELETE FROM interest;');
  seed();
});

describe('updateService.writeMany', () => {
  it('persists has_progress from the analyzed items', () => {
    const rows = updateService.writeMany(1, seedInterestId, null, [
      {
        title: '华友钴业上半年净利创新高',
        summary: '营收同比增长 49.39%',
        source_url: 'https://example.com/news/1',
        source_name: '东方财富',
        published_at: '2026-08-18',
        importance: 8,
        has_progress: true,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].has_progress).toBe(1);
  });

  it('defaults has_progress to 0 when not provided', () => {
    const rows = updateService.writeMany(1, seedInterestId, null, [
      {
        title: '重复报道',
        importance: 5,
      },
    ]);

    expect(rows[0].has_progress).toBe(0);
  });

  it('dedupes by content_hash and returns only newly inserted rows', () => {
    const item = {
      title: '华友钴业上半年净利创新高',
      summary: '营收同比增长 49.39%',
      source_url: 'https://example.com/news/1',
      importance: 8,
      has_progress: true,
    };

    const first = updateService.writeMany(1, seedInterestId, null, [item]);
    const second = updateService.writeMany(1, seedInterestId, null, [item]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});

describe('updateService.markNotified', () => {
  it('sets is_notified and notified_at for the given updates', () => {
    const rows = updateService.writeMany(1, seedInterestId, null, [
      {
        title: '华友钴业净利新高',
        source_url: 'https://example.com/news/2',
        importance: 8,
      },
      {
        title: '华友钴业锂矿动态',
        source_url: 'https://example.com/news/3',
        importance: 5,
      },
    ]);

    updateService.markNotified(1, [rows[0].id]);

    const notified = db
      .prepare('SELECT is_notified, notified_at FROM "update" WHERE id = ?')
      .get(rows[0].id) as any;
    const untouched = db
      .prepare('SELECT is_notified, notified_at FROM "update" WHERE id = ?')
      .get(rows[1].id) as any;

    expect(notified.is_notified).toBe(1);
    expect(notified.notified_at).toBeTruthy();
    expect(untouched.is_notified).toBe(0);
    expect(untouched.notified_at).toBeNull();
  });
});
