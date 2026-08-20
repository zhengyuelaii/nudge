import { Hono } from 'hono';
import { updateService } from '../services/update.service.js';
import { jsonOk, jsonError, parseOptionalInt } from '../lib/http.js';

export const updates = new Hono();

updates.get('/', (c) => {
  const interestIdRaw = parseOptionalInt(c, 'interest_id');
  const importanceRaw = parseOptionalInt(c, 'importance');
  const limitRaw = parseOptionalInt(c, 'limit');
  const offsetRaw = parseOptionalInt(c, 'offset');
  if (!interestIdRaw.ok || !importanceRaw.ok || !limitRaw.ok || !offsetRaw.ok) {
    return jsonError(c, 400, '查询参数无效');
  }
  const since = c.req.query('since') ?? undefined;

  const data = updateService.list(1, {
    interestId: interestIdRaw.value,
    since,
    importance: importanceRaw.value,
    limit: limitRaw.value,
    offset: offsetRaw.value,
  });
  return jsonOk(c, data);
});

updates.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const data = updateService.get(1, id);
  return jsonOk(c, data);
});

updates.put('/:id/read', (c) => {
  const id = Number(c.req.param('id'));
  updateService.markRead(1, id);
  return jsonOk(c, { ok: true });
});
