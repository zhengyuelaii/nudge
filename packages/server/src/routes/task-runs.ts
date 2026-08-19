import { Hono } from 'hono';
import { taskRunService } from '../services/task-run.service.js';
import { jsonOk, jsonError, parseOptionalInt } from '../lib/http.js';

export const taskRuns = new Hono();

taskRuns.get('/', (c) => {
  const interestIdRaw = parseOptionalInt(c, 'interest_id');
  const limitRaw = parseOptionalInt(c, 'limit');
  if (!interestIdRaw.ok || !limitRaw.ok) {
    return jsonError(c, 400, 'VALIDATION', '查询参数无效');
  }

  const data = taskRunService.list(1, {
    interestId: interestIdRaw.value,
    limit: limitRaw.value,
  });
  return jsonOk(c, data);
});
