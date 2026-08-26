import { db } from '../db/client.js';
import { nowUtc } from '../lib/time.js';

export interface NotifyLogRow {
  id: number;
  user_id: number;
  channel_id: number | null;
  interest_id: number | null;
  event_id: number | null;
  title: string | null;
  content: string;
  status: string;
  error_message: string | null;
  sent_at: string;
  created_at: string;
}

export interface NotifyLogInput {
  userId?: number;
  channelId?: number | null;
  interestId?: number | null;
  eventId?: number | null;
  title?: string | null;
  content: string;
  status: 'success' | 'failed';
  errorMessage?: string | null;
  sentAt?: string;
}

export interface NotifyLogListParams {
  channelId?: number;
  interestId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_USER_ID = 1;

function buildWhere(
  userId: number,
  p: NotifyLogListParams,
): { where: string; values: unknown[] } {
  const conditions = ['n.user_id = ?'];
  const values: unknown[] = [userId];
  if (p.channelId) {
    conditions.push('n.channel_id = ?');
    values.push(p.channelId);
  }
  if (p.interestId) {
    conditions.push('n.interest_id = ?');
    values.push(p.interestId);
  }
  if (p.status) {
    conditions.push('n.status = ?');
    values.push(p.status);
  }
  return { where: conditions.join(' AND '), values };
}

export const notifyLogService = {
  insert(input: NotifyLogInput): number {
    const sentAt = input.sentAt ?? nowUtc();
    const result = db
      .prepare(
        `INSERT INTO notify_log (user_id, channel_id, interest_id, event_id, title, content, status, error_message, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId ?? DEFAULT_USER_ID,
        input.channelId ?? null,
        input.interestId ?? null,
        input.eventId ?? null,
        input.title ?? null,
        input.content,
        input.status,
        input.errorMessage ?? null,
        sentAt,
      );
    return Number(result.lastInsertRowid);
  },

  get(userId: number, id: number): NotifyLogRow {
    const row = db
      .prepare('SELECT * FROM notify_log WHERE id = ? AND user_id = ?')
      .get(id, userId) as NotifyLogRow | undefined;
    if (!row) throw new Error('通知日志不存在');
    return row;
  },

  list(userId: number = DEFAULT_USER_ID, params: NotifyLogListParams = {}): NotifyLogRow[] {
    const { where, values } = buildWhere(userId, params);
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return db
      .prepare(
        `SELECT n.* FROM notify_log n
         WHERE ${where}
         ORDER BY n.sent_at DESC, n.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as NotifyLogRow[];
  },

  count(userId: number = DEFAULT_USER_ID, params: NotifyLogListParams = {}): number {
    const { where, values } = buildWhere(userId, params);
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM notify_log n WHERE ${where}`)
      .get(...values) as { c: number };
    return row.c;
  },
};
