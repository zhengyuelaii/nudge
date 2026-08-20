import { Hono } from 'hono';
import { z } from 'zod';
import { taskRunService } from '../services/task-run.service.js';
import { jsonOk, jsonError } from '../lib/http.js';

const listRunsQuery = z.object({
  interest_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['running', 'success', 'failed', 'partial']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const taskRuns = new Hono();

taskRuns.get('/', (c) => {
  const parsed = listRunsQuery.safeParse(c.req.query());
  if (!parsed.success) {
    return jsonError(c, 400, '查询参数无效');
  }
  const { interest_id, status, limit, offset } = parsed.data;

  const data = taskRunService.list(1, {
    interestId: interest_id,
    status,
    limit: limit ?? 20,
    offset: offset ?? 0,
  });
  const total = taskRunService.count(1, { interestId: interest_id, status });
  return jsonOk(c, { list: data, total });
});
