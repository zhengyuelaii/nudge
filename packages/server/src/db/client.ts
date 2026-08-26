import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, readInitSql } from '../config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db: DatabaseType = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(readInitSql());

// 渐进式 schema 迁移（MVP 不引入迁移框架）：init.sql 仅覆盖新建库，
// 已存在的库靠此处 PRAGMA 检测 + ALTER 兜底补齐缺列。所有 ALTER 幂等。
function tableExists(database: DatabaseType, table: string): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return !!row;
}

function columnExists(database: DatabaseType, table: string, column: string): boolean {
  if (!tableExists(database, table)) return false;
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function addColumn(database: DatabaseType, table: string, column: string, definition: string): void {
  if (!tableExists(database, table)) return;
  if (!columnExists(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations(database: DatabaseType): void {
  // interest_state: 跨轮结构化状态（程序维护）新增列
  addColumn(database, 'interest_state', 'last_query', 'TEXT');
  addColumn(database, 'interest_state', 'last_result_count', 'INTEGER');
  addColumn(database, 'interest_state', 'last_change_at', 'TEXT');
}

runMigrations(db);

export function transaction<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}
