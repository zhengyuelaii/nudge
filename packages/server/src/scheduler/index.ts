import cron from 'node-cron';
import { db } from '../db/client.js';
import { nowUtc } from '../lib/time.js';
import { interestService } from '../services/interest.service.js';
import { runCheck } from './check.js';

export interface DueTask {
  id: number;
  user_id: number;
  interest_id: number;
}

const RUNNING_STALE_MINUTES = 10;

export function findDueTasks(now = nowUtc()): DueTask[] {
  const staleCutoff = new Date(
    new Date(now + 'Z').getTime() - RUNNING_STALE_MINUTES * 60_000,
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

const running = new Set<number>();

export interface RunDueOptions {
  runner?: (taskId: number) => Promise<unknown>;
  now?: string;
}

export async function runDueTasks(opts: RunDueOptions = {}): Promise<number[]> {
  const runner = opts.runner ?? runCheck;
  const due = findDueTasks(opts.now);
  const executed: number[] = [];

  for (const task of due) {
    if (running.has(task.id)) continue;
    running.add(task.id);
    try {
      await runner(task.id);
      interestService.markTaskRun(task.user_id, task.id, { advanceNext: true });
      executed.push(task.id);
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
