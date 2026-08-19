import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { updateSettingsSchema } from '../lib/zod.js';
import { settingsService } from '../services/settings.service.js';
import { jsonOk } from '../lib/http.js';

export const settings = new Hono();

settings.get('/', (c) => {
  const data = settingsService.get(1);
  return jsonOk(c, data);
});

settings.put('/', zValidator('json', updateSettingsSchema), (c) => {
  const input = c.req.valid('json');
  const data = settingsService.upsert(1, input);
  return jsonOk(c, data);
});
