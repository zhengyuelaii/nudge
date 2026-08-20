import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { apiRoutes } from './routes/index.js';
import './db/client.js';
import { jsonError } from './lib/http.js';
import { AppError } from './lib/errors.js';

export const app = new Hono();

app.use('*', logger());

app.route('/api', apiRoutes);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return jsonError(c, err.status, err.message);
  }
  console.error(err);
  return jsonError(c, 500, '服务器内部错误');
});
