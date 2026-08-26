import { db } from '../db/client.js';

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export interface SourceRow {
  id: number;
  user_id: number;
  interest_id: number;
  event_id: number;
  title: string;
  summary: string | null;
  source_url: string | null;
  source_name: string | null;
  published_at: string | null;
  created_at: string;
}

export interface SourceWithJoin extends SourceRow {
  event_title: string | null;
  interest_name: string | null;
  interest_tags: string[];
}

export interface CreateSourceInput {
  title: string;
  summary?: string;
  sourceUrl?: string;
  sourceName?: string;
  publishedAt?: string;
}

export interface ListSourceParams {
  interestId?: number;
  limit?: number;
  offset?: number;
}

export const sourceService = {
  list(userId: number, params: ListSourceParams = {}): SourceWithJoin[] {
    const conditions = ['s.user_id = ?'];
    const values: unknown[] = [userId];

    if (params.interestId) {
      conditions.push('s.interest_id = ?');
      values.push(params.interestId);
    }

    const where = conditions.join(' AND ');
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = db.prepare(`
      SELECT s.*, e.title AS event_title, i.name AS interest_name, i.tags AS interest_tags
      FROM source s
      INNER JOIN interest_event e ON e.id = s.event_id
      INNER JOIN interest i ON i.id = s.interest_id
      WHERE ${where}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as (Omit<SourceWithJoin, 'interest_tags'> & { interest_tags: string | null })[];

    return rows.map((r) => ({ ...r, interest_tags: parseTags(r.interest_tags) }));
  },

  listByEvent(userId: number, eventId: number): SourceRow[] {
    return db.prepare(`
      SELECT * FROM source WHERE event_id = ? AND user_id = ?
      ORDER BY published_at DESC
    `).all(eventId, userId) as SourceRow[];
  },

  listByInterest(userId: number, interestId: number, params: ListSourceParams = {}): SourceRow[] {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return db.prepare(`
      SELECT * FROM source WHERE interest_id = ? AND user_id = ?
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?
    `).all(interestId, userId, limit, offset) as SourceRow[];
  },

  createMany(
    userId: number,
    interestId: number,
    eventId: number,
    items: CreateSourceInput[],
  ): SourceRow[] {
    const insert = db.prepare(`
      INSERT INTO source (user_id, interest_id, event_id, title, summary, source_url, source_name, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const inserted: SourceRow[] = [];
    for (const item of items) {
      const result = insert.run(
        userId,
        interestId,
        eventId,
        item.title,
        item.summary ?? null,
        item.sourceUrl ?? null,
        item.sourceName ?? null,
        item.publishedAt ?? null,
      );
      if (result.changes > 0) {
        const row = db.prepare('SELECT * FROM source WHERE id = ?')
          .get(Number(result.lastInsertRowid)) as SourceRow;
        inserted.push(row);
      }
    }
    return inserted;
  },
};
