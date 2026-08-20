-- ============================================================
-- Nudge 初始化迁移 V20260818_001__init
-- Target: SQLite 3.35+
-- 说明: 8 张表 + 索引 + 初始数据
--       所有业务/配置表预留 user_id（默认 1 = 默认用户），
--       为后续多用户系统预留；schema_migration 为全局表不带 user_id。
-- 执行前确保 PRAGMA foreign_keys = ON
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ------------------------------------------------------------
-- 1. interest — 兴趣对象
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interest (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL DEFAULT 1,  -- 预留：默认用户=1
  name            TEXT    NOT NULL,
  category        TEXT    NOT NULL,
  description     TEXT,
  query_keywords  TEXT,
  status          TEXT    NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interest_user_status   ON interest(user_id, status);
CREATE INDEX IF NOT EXISTS idx_interest_user_category ON interest(user_id, category);

-- ------------------------------------------------------------
-- 2. task — 调度任务 (1:1 interest)
--    user_id 冗余自 interest，方便按用户查询任务列表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL DEFAULT 1,
  interest_id     INTEGER NOT NULL,
  frequency       TEXT    NOT NULL CHECK (frequency IN ('day', 'week')),
  time            TEXT    NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_run_at     TEXT,
  next_run_at     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (interest_id),
  FOREIGN KEY (interest_id) REFERENCES interest(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_user_next_run ON task(user_id, next_run_at);
CREATE INDEX IF NOT EXISTS idx_task_user_enabled  ON task(user_id, enabled);

-- ------------------------------------------------------------
-- 3. task_run — 执行记录
--    user_id 冗余自 interest/task，避免按用户查执行历史时多级 JOIN
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_run (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL DEFAULT 1,
  task_id              INTEGER NOT NULL,
  interest_id          INTEGER NOT NULL,
  status               TEXT    NOT NULL CHECK (status IN ('running', 'success', 'failed', 'partial')),
  started_at           TEXT    NOT NULL,
  finished_at          TEXT,
  duration_ms          INTEGER,
  search_query         TEXT,
  search_result_count  INTEGER,
  updates_created_count INTEGER,
  llm_input_tokens     INTEGER,
  llm_output_tokens    INTEGER,
  llm_total_cost       REAL,
  error_type           TEXT    CHECK (error_type IS NULL OR error_type IN ('search_failed', 'llm_failed', 'notify_failed', 'unknown')),
  error_message        TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id)     REFERENCES task(id)     ON DELETE CASCADE,
  FOREIGN KEY (interest_id) REFERENCES interest(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_user_task      ON task_run(user_id, task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_user_interest  ON task_run(user_id, interest_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_user_status     ON task_run(user_id, status);
CREATE INDEX IF NOT EXISTS idx_run_user_started    ON task_run(user_id, started_at DESC);

-- ------------------------------------------------------------
-- 4. update — 变化记录
--    user_id 冗余自 interest，方便按用户查时间线/未读/Dashboard
--    注意: "update" 是 SQL 保留字，需双引号包裹
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "update" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL DEFAULT 1,
  interest_id     INTEGER NOT NULL,
  task_run_id     INTEGER,
  title           TEXT    NOT NULL,
  summary         TEXT,
  source_url      TEXT,
  source_name     TEXT,
  published_at    TEXT,
  importance      INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
  has_progress    INTEGER NOT NULL DEFAULT 0 CHECK (has_progress IN (0, 1)),
  is_read         INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_notified     INTEGER NOT NULL DEFAULT 0 CHECK (is_notified IN (0, 1)),
  notified_at     TEXT,
  content_hash    TEXT    UNIQUE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (interest_id) REFERENCES interest(id)   ON DELETE CASCADE,
  FOREIGN KEY (task_run_id) REFERENCES task_run(id)   ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_update_user_interest_published ON "update"(user_id, interest_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_update_user_importance          ON "update"(user_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_update_user_created             ON "update"(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_update_user_unread             ON "update"(user_id, is_read) WHERE is_read = 0;

-- ------------------------------------------------------------
-- 5. settings — 用户配置 (每用户一行)
--    预留多用户：UNIQUE(user_id) 保证每用户一行
--    单用户自托管场景下 user_id 恒为 1
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL DEFAULT 1,
  ai_base_url       TEXT    DEFAULT 'https://api.openai.com/v1',
  ai_api_key        TEXT,
  ai_model          TEXT    DEFAULT 'gpt-4o',
  search_provider   TEXT    NOT NULL DEFAULT 'tavily',
  search_api_key    TEXT,
  timezone          TEXT    NOT NULL DEFAULT 'Asia/Shanghai',
  notify_threshold  INTEGER NOT NULL DEFAULT 7 CHECK (notify_threshold BETWEEN 1 AND 10),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id)
);

-- ------------------------------------------------------------
-- 6. notification_channel — 通知渠道
--    每用户可配置多个渠道；每用户至多一个默认渠道（部分唯一索引）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_channel (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL DEFAULT 1,
  type         TEXT    NOT NULL CHECK (type IN ('feishu', 'dingtalk', 'email')),
  name         TEXT    NOT NULL,
  config       TEXT    NOT NULL,  -- JSON
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_channel_user_type ON notification_channel(user_id, type);
-- 每用户至多一个默认渠道（部分唯一索引，仅约束 is_default=1 的行）
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_user_default ON notification_channel(user_id) WHERE is_default = 1;

-- ------------------------------------------------------------
-- 7. tag — 兴趣分类标签（分类元数据源）
--    全局定义不带 user_id；interest.category 存 tag.code（文本）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tag (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  color       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- 8. schema_migration — 迁移版本（全局，不带 user_id）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migration (
  version     TEXT PRIMARY KEY,
  name        TEXT,
  checksum    TEXT,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 初始数据（默认用户 user_id = 1）
-- ============================================================

-- 默认用户配置（单行）
INSERT OR IGNORE INTO settings (user_id) VALUES (1);

-- 默认飞书渠道占位（用户需填 config.webhook_url）
INSERT OR IGNORE INTO notification_channel (user_id, type, name, config, enabled, is_default)
VALUES (1, 'feishu', '默认飞书', '{"webhook_url":"","secret":""}', 0, 1);

-- 默认标签种子（分类元数据；label/color 与前端 UI 一致）
INSERT OR IGNORE INTO tag (code, label, color, sort_order) VALUES
  ('company', '公司', 'bg-blue-100 text-blue-700', 1),
  ('policy',  '政策', 'bg-amber-100 text-amber-700', 2),
  ('tech',    '技术', 'bg-green-100 text-green-700', 3),
  ('game',    '游戏', 'bg-purple-100 text-purple-700', 4),
  ('finance', '财经', 'bg-blue-100 text-blue-700', 5);

-- 记录本次迁移
INSERT OR IGNORE INTO schema_migration (version, name) VALUES ('20260818_001', 'init schema');
