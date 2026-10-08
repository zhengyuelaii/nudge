import { db } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';

export interface TaskRunRow {
  id: number;
  user_id: number;
  task_id: number;
  interest_id: number;
  run_mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  search_result_count: number | null;
  sources_created_count: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_total_cost: number | null;
  error_type: string | null;
  error_message: string | null;
  summary: string | null;
  agent_steps: number | null;
  trace: string | null;
  trace_text: string | null;
  created_at: string;
  interest_name?: string;
}

export type RunErrorType = 'search_failed' | 'llm_failed' | 'notify_failed' | 'unknown';

/**
 * 超过该时长仍处于 running 的记录，视为执行已中断（进程崩溃/被 kill/异常逃逸）。
 * 调度每分钟据此回收，并与 findDueTasks 的「陈旧 running 不再阻塞重跑」判定同源。
 */
export const STALE_RUNNING_MINUTES = 10;

export interface TaskRunListParams {
  interestId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface TaskRunFilter {
  interestId?: number;
  status?: string;
}

function buildWhere(
  userId: number,
  f: TaskRunFilter,
): { where: string; values: unknown[] } {
  const conditions = ['r.user_id = ?'];
  const values: unknown[] = [userId];
  if (f.interestId) {
    conditions.push('r.interest_id = ?');
    values.push(f.interestId);
  }
  if (f.status) {
    conditions.push('r.status = ?');
    values.push(f.status);
  }
  return { where: conditions.join(' AND '), values };
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export const taskRunService = {
  start(userId: number, taskId: number, interestId: number, runMode = 'default'): number {
    const result = db
      .prepare(
        `INSERT INTO task_run (user_id, task_id, interest_id, run_mode, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(userId, taskId, interestId, runMode, nowUtc());
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
    const { where, values } = buildWhere(userId, params);
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    return db.prepare(`
      SELECT r.*, i.name AS interest_name
      FROM task_run r
      LEFT JOIN interest i ON i.id = r.interest_id
      WHERE ${where}
      ORDER BY r.started_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as TaskRunRow[];
  },

  count(userId: number, params: TaskRunFilter = {}): number {
    const { where, values } = buildWhere(userId, params);
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM task_run r WHERE ${where}`)
      .get(...values) as { c: number };
    return row.c;
  },

  /**
   * 回收陈旧的 running 记录，返回回收条数。
   *
   * succeed/fail 只在正常流程里被调用；进程崩溃、被 kill 或异常逃逸时 run 来不及收尾，
   * 会永久停在 running（执行历史卡在「执行中」）。由调度每分钟兜底扫描一次。
   */
  reapStale(
    userId: number,
    staleMinutes = STALE_RUNNING_MINUTES,
    now = nowUtc(),
  ): number {
    const cutoff = new Date(new Date(now + 'Z').getTime() - staleMinutes * 60_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    const result = db
      .prepare(
        `UPDATE task_run
         SET status = 'failed',
             finished_at = ?,
             duration_ms = (strftime('%s', ?) - strftime('%s', started_at)) * 1000,
             error_type = 'unknown',
             error_message = ?
         WHERE user_id = ? AND status = 'running' AND started_at <= ?`,
      )
      .run(
        now,
        now,
        `执行中断：超过 ${staleMinutes} 分钟未结束，已自动标记为失败`,
        userId,
        cutoff,
      );

    return result.changes;
  },

  succeed(
    userId: number,
    id: number,
    stats: {
      searchResultCount?: number;
      sourcesCreated?: number;
      llmInputTokens?: number;
      llmOutputTokens?: number;
      agentSteps?: number;
      trace?: string;
      traceText?: string;
      summary?: string;
    } = {},
  ): void {
    const run = taskRunService.get(userId, id);
    const started = new Date(run.started_at + 'Z').getTime();
    const finishedAt = nowUtc();
    const durationMs = Math.max(0, Date.now() - started);

    db.prepare(
      `UPDATE task_run
       SET status = 'success', finished_at = ?, duration_ms = ?,
           search_result_count = ?,
           sources_created_count = ?,
           llm_input_tokens = ?, llm_output_tokens = ?,
           agent_steps = ?, trace = ?, trace_text = ?,
           summary = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      finishedAt,
      durationMs,
      stats.searchResultCount ?? run.search_result_count,
      stats.sourcesCreated ?? run.sources_created_count,
      stats.llmInputTokens ?? run.llm_input_tokens,
      stats.llmOutputTokens ?? run.llm_output_tokens,
      stats.agentSteps ?? run.agent_steps,
      stats.trace ?? run.trace,
      stats.traceText ?? run.trace_text,
      stats.summary ?? run.summary,
      id,
      userId,
    );
  },

  fail(
    userId: number,
    id: number,
    errorType: RunErrorType,
    error: Error,
    stats: {
      llmInputTokens?: number;
      llmOutputTokens?: number;
      sourcesCreated?: number;
    } = {},
  ): void {
    const run = taskRunService.get(userId, id);
    const started = new Date(run.started_at + 'Z').getTime();
    const finishedAt = nowUtc();
    const durationMs = Math.max(0, Date.now() - started);

    db.prepare(
      `UPDATE task_run
       SET status = 'failed', finished_at = ?, duration_ms = ?,
           error_type = ?, error_message = ?,
           sources_created_count = ?,
           llm_input_tokens = ?, llm_output_tokens = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      finishedAt,
      durationMs,
      errorType,
      error.message,
      stats.sourcesCreated ?? run.sources_created_count,
      stats.llmInputTokens ?? run.llm_input_tokens,
      stats.llmOutputTokens ?? run.llm_output_tokens,
      id,
      userId,
    );
  },
};
