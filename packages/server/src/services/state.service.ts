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
// agent 的 get_last_state / save_state 等工具仍依赖本接口，待 agent 重构后一并移除。
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

  // 事件链即历史，无需写回；保留空实现以兼容 agent tool 调用
  upsert(
    _userId: number,
    _interestId: number,
    _data: {
      summary: string;
      key_points: string[];
      query_hints_next: string[];
      has_new_progress: boolean;
      last_checked_at: string;
    },
  ): void {},
};
