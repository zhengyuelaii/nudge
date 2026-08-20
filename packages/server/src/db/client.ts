import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, readInitSql } from '../config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db: DatabaseType = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(readInitSql());

// 幂等补列：SQLite 的 ADD COLUMN 无 IF NOT EXISTS，已有库启动时补齐
// （正式 SQL 迁移框架待项目稳定后实现，见 CLAUDE.md Key Decisions）
const taskRunCols = (db.prepare('PRAGMA table_info(task_run)').all() as { name: string }[]).map(
  (c) => c.name,
);
if (!taskRunCols.includes('updates_created_count')) {
  db.exec('ALTER TABLE task_run ADD COLUMN updates_created_count INTEGER');
}

export function transaction<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}
