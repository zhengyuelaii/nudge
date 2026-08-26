import { Hono } from 'hono';
import { health } from './health.js';
import { settings } from './settings.js';
import { channels } from './channels.js';
import { interests } from './interests.js';
import { events } from './events.js';
import { sources } from './sources.js';
import { taskRuns } from './task-runs.js';

export const apiRoutes = new Hono();

apiRoutes.route('/health', health);
apiRoutes.route('/settings', settings);
apiRoutes.route('/notification-channels', channels);
apiRoutes.route('/interests', interests);
apiRoutes.route('/events', events);
apiRoutes.route('/sources', sources);
apiRoutes.route('/task-runs', taskRuns);
