import { Hono } from 'hono';
import { health } from './health.js';
import { settings } from './settings.js';
import { channels } from './channels.js';
import { interests } from './interests.js';
import { updates } from './updates.js';
import { taskRuns } from './task-runs.js';

export const apiRoutes = new Hono();

apiRoutes.route('/health', health);
apiRoutes.route('/settings', settings);
apiRoutes.route('/notification-channels', channels);
apiRoutes.route('/interests', interests);
apiRoutes.route('/updates', updates);
apiRoutes.route('/task-runs', taskRuns);
