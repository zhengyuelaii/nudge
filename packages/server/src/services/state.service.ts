import { db } from '../db/client.js';

export interface InterestStateRow {
  id: number;
  user_id: number;
  interest_id: number;
  summary: string | null;
  key_points: string[];
  query_hints: string[];
  last_checked_at: string | null;
  no_change_streak: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_ID = 1;

// 历史状态不再单独持久化，统一由 interest_event / source 派生（interest_state 表已废弃）。
// 只读视图：agent 的 get_last_state / save_source 据此读取「上轮巡检状态」，没有任何写回入口。
export const stateService = {
  get(userId = DEFAULT_USER_ID, interestId: number): InterestStateRow | null {
    const event = db
      .prepare(
        `SELECT * FROM interest_event
         WHERE user_id = ? AND interest_id = ?
         ORDER BY run_at DESC LIMIT 1`,
      )
      .get(userId, interestId) as
      | { id: number; title: string; summary: string | null; run_at: string }
      | undefined;
    if (!event) return null;

    const points = db
      .prepare(
        `SELECT title FROM source
         WHERE user_id = ? AND interest_id = ?
         ORDER BY created_at DESC LIMIT 5`,
      )
      .all(userId, interestId) as Array<{ title: string }>;

    return {
      id: 0,
      user_id: userId,
      interest_id: interestId,
      summary: event.summary ?? event.title,
      key_points: points.map((p) => p.title),
      query_hints: [],
      last_checked_at: event.run_at,
      no_change_streak: 0,
      created_at: event.run_at,
      updated_at: event.run_at,
    };
  },
};
