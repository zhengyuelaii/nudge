import { db } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';
import { hashContent } from '../lib/hash.js';

export interface UpdateRow {
  id: number;
  user_id: number;
  interest_id: number;
  task_run_id: number | null;
  title: string;
  summary: string | null;
  source_url: string | null;
  source_name: string | null;
  published_at: string | null;
  importance: number;
  has_progress: number;
  is_read: number;
  is_notified: number;
  notified_at: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  interest_name?: string;
  interest_category?: string;
}

export interface ListUpdatesParams {
  interestId?: number;
  since?: string;
  importance?: number;
  limit?: number;
  offset?: number;
}

export const updateService = {
  list(userId: number, params: ListUpdatesParams = {}): UpdateRow[] {
    const conditions = ['u.user_id = ?'];
    const values: unknown[] = [userId];

    if (params.interestId) {
      conditions.push('u.interest_id = ?');
      values.push(params.interestId);
    }
    if (params.since) {
      conditions.push('u.created_at >= ?');
      values.push(params.since);
    }
    if (params.importance) {
      conditions.push('u.importance >= ?');
      values.push(params.importance);
    }

    const where = conditions.join(' AND ');
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    return db.prepare(`
      SELECT u.*, i.name AS interest_name, i.category AS interest_category
      FROM "update" u
      LEFT JOIN interest i ON i.id = u.interest_id
      WHERE ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as UpdateRow[];
  },

  get(userId: number, id: number): UpdateRow {
    const row = db.prepare(`
      SELECT u.*, i.name AS interest_name, i.category AS interest_category
      FROM "update" u
      LEFT JOIN interest i ON i.id = u.interest_id
      WHERE u.id = ? AND u.user_id = ?
    `).get(id, userId) as UpdateRow | undefined;
    if (!row) throw Errors.notFound('更新记录不存在');
    return row;
  },

  markRead(userId: number, id: number): void {
    updateService.get(userId, id);
    db.prepare('UPDATE "update" SET is_read = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(nowUtc(), id, userId);
  },

  writeMany(
    userId: number,
    interestId: number,
    taskRunId: number | null,
    items: Array<{
      title: string;
      summary?: string;
      source_url?: string;
      source_name?: string;
      published_at?: string;
      importance: number;
      has_progress?: boolean;
    }>,
  ): UpdateRow[] {
    const inserted: UpdateRow[] = [];
    const insert = db.prepare(`
      INSERT INTO "update" (user_id, interest_id, task_run_id, title, summary, source_url, source_name, published_at, importance, has_progress, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(content_hash) DO NOTHING
    `);

    for (const item of items) {
      const hash = hashContent(item.source_url ?? '', item.title);
      const result = insert.run(
        userId,
        interestId,
        taskRunId,
        item.title,
        item.summary ?? null,
        item.source_url ?? null,
        item.source_name ?? null,
        item.published_at ?? null,
        item.importance,
        item.has_progress ? 1 : 0,
        hash,
      );
      if (result.changes > 0) {
        inserted.push(updateService.get(userId, Number(result.lastInsertRowid)));
      }
    }

    return inserted;
  },

  markNotified(userId: number, ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`
      UPDATE "update" SET is_notified = 1, notified_at = ?, updated_at = ?
      WHERE id IN (${placeholders}) AND user_id = ?
    `).run(nowUtc(), nowUtc(), ...ids, userId);
  },
};
