import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';

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

describe('GET /api/tags', () => {
  it('returns the seed tags under data', async () => {
    const res = await app.request('/api/tags');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(5);
    expect(body.data[0]).toEqual({
      code: 'company',
      label: '公司',
      color: 'bg-blue-100 text-blue-700',
      sort_order: 1,
    });
  });

  it('excludes disabled tags', async () => {
    db.prepare("UPDATE tag SET enabled = 0 WHERE code = 'finance'").run();
    const res = await app.request('/api/tags');
    const body = await res.json();
    expect(body.data.map((t: { code: string }) => t.code)).not.toContain('finance');
  });
});
