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
  // interest_state 已废弃：历史状态改由 interest_event/source 派生，老库幂等清理
  database.exec('DROP TABLE IF EXISTS interest_state');

  // settings: agent v0.2 的 use_agent_loop/agent_* 系列字段收敛为 run_mode + extra
  addColumn(database, 'settings', 'run_mode', "TEXT NOT NULL DEFAULT 'default'");
  addColumn(database, 'settings', 'extra', 'TEXT');

  // task_run: update 时代遗留的 updates_created_count 更名为 sources_created_count
  addColumn(database, 'task_run', 'sources_created_count', 'INTEGER');

  // task_run: 模型对本轮执行情况的总结（无进展时也能知道模型做了什么）
  addColumn(database, 'task_run', 'summary', 'TEXT');

  // interest: 关注判据（主体 + 触发条件）。空串表示未配置 → 退化为无判据的旧行为
  addColumn(database, 'interest', 'subject', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'interest', 'criteria', "TEXT NOT NULL DEFAULT ''");

  // settings: AI 供应商由单套字段（ai_base_url/ai_api_key）改为独立的 ai_provider 记录
  addColumn(database, 'settings', 'ai_provider_id', 'INTEGER');

  // ai_provider: 每家供应商各自记住模型，切换供应商即换模型
  addColumn(database, 'ai_provider', 'model', 'TEXT');

  // 老配置的模型写在 settings.ai_model 上，回填给当前生效的那家，避免切家后模型名丢失
  database.exec(`
    UPDATE ai_provider
    SET model = (SELECT s.ai_model FROM settings s WHERE s.user_id = ai_provider.user_id)
    WHERE IFNULL(model, '') = ''
      AND id IN (SELECT ai_provider_id FROM settings WHERE ai_provider_id IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM settings s
        WHERE s.user_id = ai_provider.user_id AND IFNULL(s.ai_model, '') <> ''
      )
  `);

  // 老库平滑升级：单供应商配置搬到 ai_provider，再让 settings 指向它。
  // 仅在 ai_provider 尚无记录时执行，避免覆盖用户后来新建的供应商。
  database.exec(`
    INSERT INTO ai_provider (user_id, kind, name, base_url, api_key)
    SELECT s.user_id,
           CASE WHEN IFNULL(s.ai_base_url, '') LIKE '%deepseek%' THEN 'deepseek' ELSE 'custom' END,
           CASE WHEN IFNULL(s.ai_base_url, '') LIKE '%deepseek%' THEN 'DeepSeek' ELSE '自定义' END,
           s.ai_base_url,
           s.ai_api_key
    FROM settings s
    WHERE IFNULL(s.ai_api_key, '') <> ''
      AND NOT EXISTS (SELECT 1 FROM ai_provider p WHERE p.user_id = s.user_id)
  `);
  database.exec(`
    UPDATE settings
    SET ai_provider_id = (
      SELECT p.id FROM ai_provider p WHERE p.user_id = settings.user_id ORDER BY p.id LIMIT 1
    )
    WHERE ai_provider_id IS NULL
      AND EXISTS (SELECT 1 FROM ai_provider p WHERE p.user_id = settings.user_id)
  `);
}

runMigrations(db);

export function transaction<T>(fn: () => T): T {
  const run = db.transaction(fn);
  return run();
}
