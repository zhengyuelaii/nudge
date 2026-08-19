import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, readInitSql } from '../config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db: DatabaseType = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(readInitSql());

export function transaction<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}
