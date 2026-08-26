import { Hono } from 'hono';
import { sourceService } from '../services/source.service.js';
import { jsonOk, jsonError, parseOptionalInt } from '../lib/http.js';

export const sources = new Hono();

sources.get('/', (c) => {
  const interestIdRaw = parseOptionalInt(c, 'interest_id');
  const limitRaw = parseOptionalInt(c, 'limit');
  const offsetRaw = parseOptionalInt(c, 'offset');
  if (!interestIdRaw.ok || !limitRaw.ok || !offsetRaw.ok) {
    return jsonError(c, 400, '查询参数无效');
  }

  const data = sourceService.list(1, {
    interestId: interestIdRaw.value,
    limit: limitRaw.value,
    offset: offsetRaw.value,
  });
  return jsonOk(c, data);
});
