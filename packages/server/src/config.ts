import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVER_ROOT = resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? join(SERVER_ROOT, 'data', 'nudge.db'),
  isDev: process.env.NODE_ENV !== 'production',
  schedulerEnabled: process.env.NUDGE_SCHEDULER !== 'off',
} as const;

const MIGRATION_PATH = join(
  import.meta.dirname,
  'migrations',
  'V20260818_001__init.sql',
);

export function readInitSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf-8');
}
