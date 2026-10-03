-- ============================================================
-- Nudge 初始化迁移 V20260818_001__init
-- Target: SQLite 3.35+
-- 说明: 9 张表（含 notify_log 通知日志）+ 索引 + 初始数据
--       所有业务/配置表预留 user_id（默认 1 = 默认用户），
--       为后续多用户系统预留；schema_migration 为全局表不带 user_id。
--       task_run → interest_event → source 三层结构。
--       旧 "update" 表已废弃（P1 删除）。
--       notify_log 记录每次通知发送（无论成败），用于追溯与失败排查。
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
  tags            TEXT    NOT NULL DEFAULT '[]',
  description     TEXT,
  query_keywords  TEXT,
  subject         TEXT    NOT NULL DEFAULT '',  -- 关注判据：监控主体（空串表示未配置，退化为无判据）
  criteria        TEXT    NOT NULL DEFAULT '',  -- 关注判据：触发条件，命中才算「变化」
  channel_ids     TEXT    NOT NULL DEFAULT '[]',  -- 选中的通知渠道 id 数组（JSON），空则回退默认渠道
  status          TEXT    NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interest_user_status ON interest(user_id, status);

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
  run_mode             TEXT    NOT NULL DEFAULT 'default',
  status               TEXT    NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at           TEXT    NOT NULL,
  finished_at          TEXT,
  duration_ms          INTEGER,
  search_result_count  INTEGER,
  sources_created_count INTEGER,
  llm_input_tokens     INTEGER,
  llm_output_tokens    INTEGER,
  llm_total_cost       REAL,
  error_type           TEXT    CHECK (error_type IS NULL OR error_type IN ('search_failed', 'llm_failed', 'notify_failed', 'unknown')),
  error_message        TEXT,
  summary              TEXT,
  agent_steps          INTEGER,
  trace                TEXT,
  trace_text           TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id)     REFERENCES task(id)     ON DELETE CASCADE,
  FOREIGN KEY (interest_id) REFERENCES interest(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_user_task      ON task_run(user_id, task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_user_interest  ON task_run(user_id, interest_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_user_status     ON task_run(user_id, status);
CREATE INDEX IF NOT EXISTS idx_run_user_started    ON task_run(user_id, started_at DESC);

-- ------------------------------------------------------------
-- 4. interest_event — 兴趣更新事件（仅产生更新时才写入）
--    一条 event 对应多条 source，是「这个兴趣什么时刻冒出了哪些更新」的聚合头
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interest_event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL DEFAULT 1,
  interest_id   INTEGER NOT NULL,
  task_run_id   INTEGER,
  title         TEXT    NOT NULL,
  run_at        TEXT    NOT NULL,
  source_count  INTEGER NOT NULL DEFAULT 0,
  summary       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (interest_id) REFERENCES interest(id) ON DELETE CASCADE,
  FOREIGN KEY (task_run_id) REFERENCES task_run(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_event_user ON interest_event(user_id);
CREATE INDEX IF NOT EXISTS idx_event_user_interest ON interest_event(user_id, interest_id, run_at DESC);

-- ------------------------------------------------------------
-- 5. source — 变化来源
--    一条 source 必须归属一条 interest_event
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL DEFAULT 1,
  interest_id   INTEGER NOT NULL,
  event_id      INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  summary       TEXT,
  source_url    TEXT,
  source_name   TEXT,
  published_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (interest_id) REFERENCES interest(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES interest_event(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_user_interest_published ON source(user_id, interest_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_user_created ON source(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_user_event ON source(user_id, event_id);

-- ------------------------------------------------------------
-- 6. settings — 用户配置 (每用户一行)
--    预留多用户：UNIQUE(user_id) 保证每用户一行
--    单用户自托管场景下 user_id 恒为 1
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL DEFAULT 1,
  ai_base_url       TEXT,
  ai_api_key        TEXT,
  ai_model          TEXT,
  search_provider   TEXT    DEFAULT 'tavily',
  search_api_key    TEXT,
  timezone          TEXT    NOT NULL DEFAULT 'Asia/Shanghai',
  locale            TEXT    NOT NULL DEFAULT 'zh-CN',
  run_mode          TEXT    NOT NULL DEFAULT 'default' CHECK (run_mode IN ('default', 'agent')),
  extra             TEXT,    -- JSON 扩展配置
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id)
);

-- ------------------------------------------------------------
-- 7. notification_channel — 通知渠道
--    每用户可配置多个渠道；每用户至多一个默认渠道（部分唯一索引）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_channel (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL DEFAULT 1,
  type         TEXT    NOT NULL CHECK (type IN ('feishu', 'email')),
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
-- 8. schema_migration — 迁移版本（全局，不带 user_id）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migration (
  version     TEXT PRIMARY KEY,
  name        TEXT,
  checksum    TEXT,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- 9. notify_log — 通知发送日志（每次发送无论成败都记一条）
--     channel_id / interest_id / event_id 关联来源；status 标记成功/失败
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notify_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL DEFAULT 1,
  channel_id    INTEGER,
  interest_id   INTEGER,
  event_id      INTEGER,
  title         TEXT,
  content       TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  sent_at       TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (channel_id)  REFERENCES notification_channel(id) ON DELETE SET NULL,
  FOREIGN KEY (interest_id) REFERENCES interest(id)           ON DELETE CASCADE,
  FOREIGN KEY (event_id)    REFERENCES interest_event(id)     ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notify_log_user_sent      ON notify_log(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notify_log_user_channel   ON notify_log(user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_notify_log_user_interest  ON notify_log(user_id, interest_id, sent_at DESC);

-- ============================================================
-- 初始数据（默认用户 user_id = 1）
-- ============================================================

-- 默认用户配置（单行）
INSERT OR IGNORE INTO settings (user_id) VALUES (1);

-- 飞书渠道占位（用户需填 config.webhook_url）；is_default=1 表示默认渠道，显示名不重复写"默认"
INSERT OR IGNORE INTO notification_channel (user_id, type, name, config, enabled, is_default)
VALUES (1, 'feishu', '飞书', '{"webhook_url":"","secret":""}', 0, 1);

-- 记录本次迁移
INSERT OR IGNORE INTO schema_migration (version, name) VALUES ('20260818_001', 'init schema');
