import { Hono } from 'hono';
import { eventService } from '../services/event.service.js';
import { jsonOk, jsonError, parseOptionalInt } from '../lib/http.js';

export const events = new Hono();

events.get('/', (c) => {
  const interestIdRaw = parseOptionalInt(c, 'interest_id');
  const limitRaw = parseOptionalInt(c, 'limit');
  const offsetRaw = parseOptionalInt(c, 'offset');
  if (!interestIdRaw.ok || !limitRaw.ok || !offsetRaw.ok) {
    return jsonError(c, 400, '查询参数无效');
  }

  const eventList = eventService.list(1, {
    interestId: interestIdRaw.value,
    limit: limitRaw.value,
    offset: offsetRaw.value,
  });

  const data = eventList.map((event) => ({
    ...event,
    sources: eventService.get(1, event.id).sources,
  }));

  return jsonOk(c, data);
});

events.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const data = eventService.get(1, id);
  return jsonOk(c, data);
});
