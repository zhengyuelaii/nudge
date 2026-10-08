import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createInterestSchema, updateInterestSchema } from '../lib/zod.js';
import { interestService } from '../services/interest.service.js';
import { jsonOk, jsonError } from '../lib/http.js';
import { runCheck } from '../scheduler/check.js';
import { Errors } from '../lib/errors.js';
import { db } from '../db/client.js';

export const interests = new Hono();

interests.get('/', (c) => {
  const data = interestService.list(1);
  return jsonOk(c, data);
});

interests.get('/tags', (c) => {
  const rows = db
    .prepare("SELECT DISTINCT value FROM interest, json_each(interest.tags) WHERE user_id = 1 AND status = 'active' ORDER BY value")
    .all() as { value: string }[];
  return jsonOk(c, rows.map((r) => r.value));
});

interests.post('/', zValidator('json', createInterestSchema), (c) => {
  const input = c.req.valid('json');
  const data = interestService.create(1, input);
  return jsonOk(c, data, 201);
});

interests.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const data = interestService.get(1, id);
  return jsonOk(c, data);
});

interests.put('/:id', zValidator('json', updateInterestSchema), (c) => {
  const id = Number(c.req.param('id'));
  const input = c.req.valid('json');
  const data = interestService.update(1, id, input);
  return jsonOk(c, data);
});

interests.put('/:id/toggle', (c) => {
  const id = Number(c.req.param('id'));
  const data = interestService.toggle(1, id);
  return jsonOk(c, data);
});

interests.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  interestService.remove(1, id);
  return jsonOk(c, { ok: true });
});

interests.post('/:id/check', async (c) => {
  const id = Number(c.req.param('id'));
  const interest = interestService.get(1, id);
  try {
    const result = await runCheck(interest.task_id);
    // advanceNext: true —— 手动执行也算跑过这个周期。
    // 否则 next_run_at 仍停在已过期的时刻，调度下一分钟就会把同一个兴趣再跑一遍。
    interestService.markTaskRun(1, interest.task_id, { advanceNext: true });
    return jsonOk(c, result);
  } catch (e) {
    const err = e as Error;
    const appError = Errors.internal(`检查失败: ${err.message}`);
    return jsonError(c, appError.status, appError.message);
  }
});
