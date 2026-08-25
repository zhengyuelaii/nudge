import { db } from '../db/client.js';
import { nowUtc } from '../lib/time.js';

export interface InterestStateRow {
  id: number;
  user_id: number;
  interest_id: number;
  summary: string | null;
  key_points: string[];   // parsed JSON
  query_hints: string[];  // parsed JSON
  last_checked_at: string | null;
  no_change_streak: number;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

const DEFAULT_USER_ID = 1;

export const stateService = {
  get(userId = DEFAULT_USER_ID, interestId: number): InterestStateRow | null {
    const row = db
      .prepare('SELECT * FROM interest_state WHERE user_id = ? AND interest_id = ?')
      .get(userId, interestId) as Omit<InterestStateRow, 'key_points' | 'query_hints'> & {
        key_points: string | null;
        query_hints: string | null;
      } | undefined;
    if (!row) return null;
    return {
      ...row,
      key_points: parseJsonArray(row.key_points),
      query_hints: parseJsonArray(row.query_hints),
    };
  },

  upsert(
    userId: number,
    interestId: number,
    data: {
      summary: string;
      key_points: string[];
      query_hints_next: string[];
      has_new_progress: boolean;
      last_checked_at: string;
    },
  ): void {
    const existing = db
      .prepare('SELECT id, no_change_streak FROM interest_state WHERE user_id = ? AND interest_id = ?')
      .get(userId, interestId) as { id: number; no_change_streak: number } | undefined;

    const keyPoints = JSON.stringify(data.key_points);
    const queryHints = JSON.stringify(data.query_hints_next);

    if (existing) {
      const newStreak = data.has_new_progress ? 0 : existing.no_change_streak + 1;

      db.prepare(
        `UPDATE interest_state SET summary = ?, key_points = ?, query_hints = ?,
         last_checked_at = ?, no_change_streak = ?, updated_at = ?
         WHERE user_id = ? AND interest_id = ?`,
      ).run(
        data.summary,
        keyPoints,
        queryHints,
        data.last_checked_at,
        newStreak,
        nowUtc(),
        userId,
        interestId,
      );
    } else {
      db.prepare(
        `INSERT INTO interest_state (user_id, interest_id, summary, key_points, query_hints, last_checked_at, no_change_streak, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        interestId,
        data.summary,
        keyPoints,
        queryHints,
        data.last_checked_at,
        data.has_new_progress ? 0 : 1,
        nowUtc(),
        nowUtc(),
      );
    }
  },
};
