import { Hono } from 'hono';
import { jsonOk } from '../lib/http.js';

export const health = new Hono();

health.get('/', (c) => {
  return jsonOk(c, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});
