import { db } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';

export interface TaskRunRow {
  id: number;
  user_id: number;
  task_id: number;
  interest_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  search_query: string | null;
  search_result_count: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_total_cost: number | null;
  error_type: string | null;
  error_message: string | null;
  created_at: string;
  interest_name?: string;
}

export type RunErrorType = 'search_failed' | 'llm_failed' | 'notify_failed' | 'unknown';

export interface TaskRunListParams {
  interestId?: number;
  limit?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export const taskRunService = {
  start(userId: number, taskId: number, interestId: number): number {
    const result = db
      .prepare(
        `INSERT INTO task_run (user_id, task_id, interest_id, status, started_at)
         VALUES (?, ?, ?, 'running', ?)`,
      )
      .run(userId, taskId, interestId, nowUtc());
    return Number(result.lastInsertRowid);
  },

  get(userId: number, id: number): TaskRunRow {
    const row = db
      .prepare('SELECT * FROM task_run WHERE id = ? AND user_id = ?')
      .get(id, userId) as TaskRunRow | undefined;
    if (!row) throw Errors.notFound('执行记录不存在');
    return row;
  },

  list(userId: number, params: TaskRunListParams = {}): TaskRunRow[] {
    const conditions = ['r.user_id = ?'];
    const values: unknown[] = [userId];

    if (params.interestId) {
      conditions.push('r.interest_id = ?');
      values.push(params.interestId);
    }

    const where = conditions.join(' AND ');
    const limit = params.limit ?? 20;

    return db.prepare(`
      SELECT r.*, i.name AS interest_name
      FROM task_run r
      LEFT JOIN interest i ON i.id = r.interest_id
      WHERE ${where}
      ORDER BY r.started_at DESC, r.id DESC
      LIMIT ?
    `).all(...values, limit) as TaskRunRow[];
  },

  succeed(
    userId: number,
    id: number,
    stats: {
      searchQuery?: string;
      searchResultCount?: number;
      llmInputTokens?: number;
      llmOutputTokens?: number;
    } = {},
  ): void {
    const run = taskRunService.get(userId, id);
    const started = new Date(run.started_at + 'Z').getTime();
    const finishedAt = nowUtc();
    const durationMs = Math.max(0, Date.now() - started);

    db.prepare(
      `UPDATE task_run
       SET status = 'success', finished_at = ?, duration_ms = ?,
           search_query = ?, search_result_count = ?,
           llm_input_tokens = ?, llm_output_tokens = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      finishedAt,
      durationMs,
      stats.searchQuery ?? run.search_query,
      stats.searchResultCount ?? run.search_result_count,
      stats.llmInputTokens ?? run.llm_input_tokens,
      stats.llmOutputTokens ?? run.llm_output_tokens,
      id,
      userId,
    );
  },

  partial(
    userId: number,
    id: number,
    errorType: RunErrorType,
    error: Error,
    usage?: LlmUsage,
  ): void {
    taskRunService.finish(userId, id, 'partial', errorType, error, usage);
  },

  fail(userId: number, id: number, errorType: RunErrorType, error: Error): void {
    taskRunService.finish(userId, id, 'failed', errorType, error);
  },

  finish(
    userId: number,
    id: number,
    status: 'partial' | 'failed',
    errorType: RunErrorType,
    error: Error,
    usage?: LlmUsage,
  ): void {
    const run = taskRunService.get(userId, id);
    const started = new Date(run.started_at + 'Z').getTime();
    const finishedAt = nowUtc();
    const durationMs = Math.max(0, Date.now() - started);

    db.prepare(
      `UPDATE task_run
       SET status = ?, finished_at = ?, duration_ms = ?,
           error_type = ?, error_message = ?,
           llm_input_tokens = ?, llm_output_tokens = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      status,
      finishedAt,
      durationMs,
      errorType,
      error.message,
      usage?.inputTokens ?? run.llm_input_tokens,
      usage?.outputTokens ?? run.llm_output_tokens,
      id,
      userId,
    );
  },
};