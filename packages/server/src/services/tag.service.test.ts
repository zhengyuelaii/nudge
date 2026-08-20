import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { tagService } from './tag.service.js';

beforeEach(() => {
  db.exec('DELETE FROM tag;');
  db.exec(
    `INSERT INTO tag (code, label, color, sort_order, enabled) VALUES
     ('company', '公司', 'bg-blue-100 text-blue-700', 1, 1),
     ('policy',  '政策', 'bg-amber-100 text-amber-700', 2, 1),
     ('tech',    '技术', 'bg-green-100 text-green-700', 3, 1),
     ('game',    '游戏', 'bg-purple-100 text-purple-700', 4, 1),
     ('finance', '财经', 'bg-blue-100 text-blue-700', 5, 1)`,
  );
});

describe('tagService.list', () => {
  it('returns enabled tags ordered by sort_order', () => {
    const tags = tagService.list();
    expect(tags.map((t) => t.code)).toEqual([
      'company',
      'policy',
      'tech',
      'game',
      'finance',
    ]);
    expect(tags[0].label).toBe('公司');
    expect(tags[0].color).toBe('bg-blue-100 text-blue-700');
  });

  it('excludes disabled tags', () => {
    db.prepare("UPDATE tag SET enabled = 0 WHERE code = 'game'").run();
    const tags = tagService.list();
    expect(tags.map((t) => t.code)).not.toContain('game');
  });

  it('exposes the 5 seed tags as source of truth', () => {
    expect(tagService.list()).toHaveLength(5);
  });
});
