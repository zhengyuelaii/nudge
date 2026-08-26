import { db } from '../db/client.js';
import { Errors } from '../lib/errors.js';

export interface InterestEventRow {
  id: number;
  user_id: number;
  interest_id: number;
  task_run_id: number | null;
  title: string;
  run_at: string;
  source_count: number;
  summary: string | null;
  created_at: string;
  interest_name?: string;
}

export interface InterestEventWithSources extends InterestEventRow {
  sources: Array<{
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
  }>;
}

export interface ListEventParams {
  interestId?: number;
  limit?: number;
  offset?: number;
}

export interface CreateEventInput {
  interestId: number;
  taskRunId?: number;
  title: string;
  runAt: string;
  summary?: string | null;
}

export const eventService = {
  list(userId: number, params: ListEventParams = {}): InterestEventRow[] {
    const conditions = ['e.user_id = ?'];
    const values: unknown[] = [userId];

    if (params.interestId) {
      conditions.push('e.interest_id = ?');
      values.push(params.interestId);
    }

    const where = conditions.join(' AND ');
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = db.prepare(`
      SELECT e.*, i.name AS interest_name
      FROM interest_event e
      INNER JOIN interest i ON i.id = e.interest_id
      WHERE ${where}
      ORDER BY e.run_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as InterestEventRow[];

    return rows;
  },

  /** 最近 N 次事件的最近进展，作为下一轮巡检的已知状态传给模型 */
  listRecent(
    userId: number,
    interestId: number,
    params: { limit?: number; sourcesPerEvent?: number } = {},
  ): InterestEventWithSources[] {
    const limit = params.limit ?? 3;
    const sourcesPerEvent = params.sourcesPerEvent ?? 3;

    const events = db.prepare(`
      SELECT e.*, i.name AS interest_name
      FROM interest_event e
      INNER JOIN interest i ON i.id = e.interest_id
      WHERE e.user_id = ? AND e.interest_id = ?
      ORDER BY e.run_at DESC
      LIMIT ?
    `).all(userId, interestId, limit) as InterestEventRow[];

    if (events.length === 0) return [];

    const ids = events.map((e) => e.id);
    const placeholders = ids.map(() => '?').join(',');
    const sources = db.prepare(`
      SELECT * FROM source
      WHERE event_id IN (${placeholders}) AND user_id = ?
      ORDER BY published_at DESC, id DESC
    `).all(...ids, userId) as InterestEventWithSources['sources'];

    const byEvent = new Map<number, InterestEventWithSources['sources']>();
    for (const s of sources) {
      const list = byEvent.get(s.event_id) ?? [];
      if (list.length < sourcesPerEvent) list.push(s);
      byEvent.set(s.event_id, list);
    }

    return events.map((e) => ({ ...e, sources: byEvent.get(e.id) ?? [] }));
  },

  get(userId: number, id: number): InterestEventWithSources {
    const row = db.prepare(`
      SELECT * FROM interest_event WHERE id = ? AND user_id = ?
    `).get(id, userId) as InterestEventRow | undefined;
    if (!row) throw Errors.notFound('更新事件不存在');

    const sources = db.prepare(`
      SELECT * FROM source WHERE event_id = ? AND user_id = ? ORDER BY published_at DESC
    `).all(id, userId) as InterestEventWithSources['sources'];

    return { ...row, sources };
  },

  create(userId: number, input: CreateEventInput): InterestEventRow {
    const result = db.prepare(`
      INSERT INTO interest_event (user_id, interest_id, task_run_id, title, run_at, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      input.interestId,
      input.taskRunId ?? null,
      input.title,
      input.runAt,
      input.summary ?? null,
    );

    return db.prepare(`
      SELECT * FROM interest_event WHERE id = ?
    `).get(Number(result.lastInsertRowid)) as InterestEventRow;
  },

  updateSourceCount(userId: number, eventId: number, count: number): void {
    db.prepare(`
      UPDATE interest_event SET source_count = ? WHERE id = ? AND user_id = ?
    `).run(count, eventId, userId);
  },
};
