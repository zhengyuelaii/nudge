import { db, transaction } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import { nowUtc, computeNextRun } from '../lib/time.js';
import type { CreateInterestInput, UpdateInterestInput } from '../lib/zod.js';

export interface InterestRow {
  id: number;
  user_id: number;
  name: string;
  category: string;
  description: string | null;
  query_keywords: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  task_id: number;
  frequency: string;
  time: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface TaskRow {
  id: number;
  user_id: number;
  interest_id: number;
  frequency: string;
  time: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_ID = 1;

function userTimezone(userId: number): string {
  const row = db
    .prepare('SELECT timezone FROM settings WHERE user_id = ?')
    .get(userId) as { timezone?: string } | undefined;
  return row?.timezone ?? 'Asia/Shanghai';
}

const LIST_SQL = `
  SELECT i.*, t.id AS task_id, t.frequency, t.time, t.enabled,
         t.last_run_at, t.next_run_at
  FROM interest i
  JOIN task t ON t.interest_id = i.id
  WHERE i.user_id = ? AND i.status = 'active'
  ORDER BY i.created_at DESC
`;

const GET_SQL = `
  SELECT i.*, t.id AS task_id, t.frequency, t.time, t.enabled,
         t.last_run_at, t.next_run_at
  FROM interest i
  JOIN task t ON t.interest_id = i.id
  WHERE i.id = ? AND i.user_id = ?
`;

export const interestService = {
  list(userId = DEFAULT_USER_ID): InterestRow[] {
    return db.prepare(LIST_SQL).all(userId) as InterestRow[];
  },

  get(userId: number, id: number): InterestRow {
    const row = db.prepare(GET_SQL).get(id, userId) as InterestRow | undefined;
    if (!row) throw Errors.notFound('兴趣不存在');
    return row;
  },

  create(userId: number, input: CreateInterestInput): InterestRow {
    return transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO interest (user_id, name, category, description, query_keywords)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          input.name,
          input.category,
          input.description ?? null,
          input.queryKeywords ?? null,
        );

      const interestId = Number(result.lastInsertRowid);
      const nextRun = computeNextRun(input.frequency, input.time, { timezone: userTimezone(userId) });

      db.prepare(
        `INSERT INTO task (user_id, interest_id, frequency, time, enabled, next_run_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      ).run(userId, interestId, input.frequency, input.time, nextRun);

      return interestService.get(userId, interestId);
    });
  },

  update(userId: number, id: number, input: UpdateInterestInput): InterestRow {
    interestService.get(userId, id);

    return transaction(() => {
      const iFields: string[] = [];
      const iValues: unknown[] = [];

      if (input.name !== undefined) { iFields.push('name = ?'); iValues.push(input.name); }
      if (input.category !== undefined) { iFields.push('category = ?'); iValues.push(input.category); }
      if (input.description !== undefined) { iFields.push('description = ?'); iValues.push(input.description); }
      if (input.queryKeywords !== undefined) { iFields.push('query_keywords = ?'); iValues.push(input.queryKeywords); }

      if (iFields.length > 0) {
        iFields.push('updated_at = ?');
        iValues.push(nowUtc());
        iValues.push(id);
        db.prepare(`UPDATE interest SET ${iFields.join(', ')} WHERE id = ?`).run(...iValues);
      }

      const tFields: string[] = [];
      const tValues: unknown[] = [];

      if (input.frequency !== undefined) { tFields.push('frequency = ?'); tValues.push(input.frequency); }
      if (input.time !== undefined) { tFields.push('time = ?'); tValues.push(input.time); }

      if (tFields.length > 0) {
        tFields.push('updated_at = ?');
        tValues.push(nowUtc());
        tValues.push(id);
        db.prepare(`UPDATE task SET ${tFields.join(', ')} WHERE interest_id = ?`).run(...tValues);

        if (input.frequency || input.time) {
          const task = db
            .prepare('SELECT frequency, time, enabled FROM task WHERE interest_id = ?')
            .get(id) as Pick<TaskRow, 'frequency' | 'time' | 'enabled'> | undefined;
          if (task?.enabled) {
            const nextRun = computeNextRun(task.frequency, task.time, { timezone: userTimezone(userId) });
            db.prepare('UPDATE task SET next_run_at = ? WHERE interest_id = ?').run(nextRun, id);
          }
        }
      }

      return interestService.get(userId, id);
    });
  },

  toggle(userId: number, id: number): InterestRow {
    interestService.get(userId, id);

    return transaction(() => {
      const task = db
        .prepare('SELECT enabled, frequency, time FROM task WHERE interest_id = ?')
        .get(id) as Pick<TaskRow, 'enabled' | 'frequency' | 'time'>;

      const newEnabled = task.enabled ? 0 : 1;
      const nextRun = newEnabled
        ? computeNextRun(task.frequency, task.time, { timezone: userTimezone(userId) })
        : null;

      db.prepare(
        'UPDATE task SET enabled = ?, next_run_at = ?, updated_at = ? WHERE interest_id = ?',
      ).run(newEnabled, nextRun, nowUtc(), id);

      return interestService.get(userId, id);
    });
  },

  remove(userId: number, id: number): void {
    interestService.get(userId, id);
    db.prepare('DELETE FROM interest WHERE id = ? AND user_id = ?').run(id, userId);
  },

  getTask(taskId: number): TaskRow {
    const row = db.prepare('SELECT * FROM task WHERE id = ?').get(taskId) as TaskRow | undefined;
    if (!row) throw Errors.notFound('任务不存在');
    return row;
  },

  markTaskRun(
    userId: number,
    taskId: number,
    opts: { advanceNext: boolean } = { advanceNext: false },
  ): void {
    const task = db
      .prepare('SELECT * FROM task WHERE id = ? AND user_id = ?')
      .get(taskId, userId) as TaskRow | undefined;
    if (!task) throw Errors.notFound('任务不存在');

    const fields: string[] = ['last_run_at = ?'];
    const values: unknown[] = [nowUtc()];

    if (opts.advanceNext) {
      fields.push('next_run_at = ?');
      values.push(computeNextRun(task.frequency, task.time, { timezone: userTimezone(userId) }));
    }
    fields.push('updated_at = ?');
    values.push(nowUtc());
    values.push(taskId);

    db.prepare(`UPDATE task SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },
};
