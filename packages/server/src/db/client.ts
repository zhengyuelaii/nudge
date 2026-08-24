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

// category → tags 迁移：旧库有 category 列，无 tags 列时补齐并转换数据
const interestCols = (db.prepare('PRAGMA table_info(interest)').all() as { name: string }[]).map(
  (c) => c.name,
);
if (interestCols.includes('category') && !interestCols.includes('tags')) {
  db.exec("ALTER TABLE interest ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  db.exec("UPDATE interest SET tags = json_array(category) WHERE category != '' AND category IS NOT NULL");
  db.exec('DROP INDEX IF EXISTS idx_interest_user_category');
}

// interest.channel_ids 早期 init 未含，已有库补齐（JSON 数组，存选中的通知渠道 id）
if (!interestCols.includes('channel_ids')) {
  db.exec("ALTER TABLE interest ADD COLUMN channel_ids TEXT NOT NULL DEFAULT '[]'");
}

// search_provider 早期 init 未设默认，已有库补 'tavily'（单 provider 阶段兜底）
db.exec(`UPDATE settings SET search_provider = 'tavily' WHERE search_provider IS NULL OR search_provider = ''`);

export function transaction<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}
