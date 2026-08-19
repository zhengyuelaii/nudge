import { serve } from '@hono/node-server';
import { app } from './app.js';
import { config } from './config.js';
import { startScheduler } from './scheduler/index.js';

if (config.schedulerEnabled) {
  startScheduler();
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
