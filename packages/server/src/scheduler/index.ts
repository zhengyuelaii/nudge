import cron from 'node-cron';
import { db } from '../db/client.js';
import { nowUtc } from '../lib/time.js';
import { interestService } from '../services/interest.service.js';
import { settingsService } from '../services/settings.service.js';
import { taskRunService, STALE_RUNNING_MINUTES } from '../services/task-run.service.js';
import { runCheck } from './check.js';
import { runAgentCheck } from '../agent/loop.js';

export interface DueTask {
  id: number;
  user_id: number;
  interest_id: number;
}

export function findDueTasks(now = nowUtc()): DueTask[] {
  const staleCutoff = new Date(
    new Date(now + 'Z').getTime() - STALE_RUNNING_MINUTES * 60_000,
  )
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  return db
    .prepare(
      `SELECT t.id, t.user_id, t.interest_id
       FROM task t
       WHERE t.enabled = 1 AND t.next_run_at IS NOT NULL AND t.next_run_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM task_run r
           WHERE r.task_id = t.id AND r.status = 'running' AND r.started_at > ?
         )
       ORDER BY t.next_run_at ASC`,
    )
    .all(now, staleCutoff) as DueTask[];
}

/**
 * 回收陈旧的 running 记录（进程崩溃、被 kill 或异常逃逸时留下的）。
 *
 * 不回收的话：执行历史永远显示「执行中」，且这条记录会一直参与 findDueTasks 的重复执行判定。
 * 阈值与 findDueTasks 的陈旧判定同源（STALE_RUNNING_MINUTES）。
 */
export function reapStaleRuns(now = nowUtc()): number {
  const users = db
    .prepare(`SELECT DISTINCT user_id FROM task_run WHERE status = 'running'`)
    .all() as { user_id: number }[];

  let reaped = 0;
  for (const row of users) {
    reaped += taskRunService.reapStale(row.user_id, STALE_RUNNING_MINUTES, now);
  }
  return reaped;
}

const running = new Set<number>();

export interface RunDueOptions {
  runner?: (taskId: number) => Promise<unknown>;
  now?: string;
}

async function defaultRunner(taskId: number): Promise<unknown> {
  const task = interestService.getTask(taskId);
  const settings = settingsService.get(task.user_id);
  if (settings.run_mode === 'agent') {
    return runAgentCheck(taskId);
  }
  return runCheck(taskId);
}

export async function runDueTasks(opts: RunDueOptions = {}): Promise<number[]> {
  const runner = opts.runner ?? defaultRunner;

  // 先回收再挑任务：否则上次崩溃留下的 running 会一直挡住该任务重跑
  const reaped = reapStaleRuns(opts.now);
  if (reaped > 0) {
    console.warn(`[scheduler] 回收陈旧执行记录 ${reaped} 条（执行中 → 失败）`);
  }

  const due = findDueTasks(opts.now);

  // 先整体认领，再逐个执行。
  //
  // 若改成「边挑边跑」，一次 tick 会因为前一个任务耗时而长时间停在原地（例如 CPO 那轮卡了 3 分钟）；
  // 期间每分钟的新 tick 会重新查到后面那些 task —— 它们的 next_run_at 尚未推进、也没有 running 记录 ——
  // 于是同一个兴趣在几分钟内被跑两轮，第二轮若读不到第一轮刚落库的事件就会重复推送。
  const claimed = due.filter((task) => !running.has(task.id));
  for (const task of claimed) running.add(task.id);

  const executed: number[] = [];

  for (const task of claimed) {
    try {
      await runner(task.id);
      interestService.markTaskRun(task.user_id, task.id, { advanceNext: true });
      executed.push(task.id);
    } catch (e) {
      // 单个任务失败不能中断整轮：否则排在它后面的 due 任务会被永久饿死。
      // next_run_at 不推进，下一分钟自然重试；该次 run 已由 runCheck / runAgentCheck 兜底收尾。
      console.error(`[scheduler] task ${task.id} 执行异常:`, e);
    } finally {
      running.delete(task.id);
    }
  }

  return executed;
}

export function startScheduler(): void {
  cron.schedule('* * * * *', () => {
    runDueTasks().catch((e) => console.error('[scheduler] runDueTasks failed:', e));
  });
  console.log('Scheduler started (every minute)');
}
