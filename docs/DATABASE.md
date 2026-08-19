# Nudge 数据库设计文档

> 基于现有原型（5 个 Vue 视图）与 DESIGN.md，由 DBA/架构师视角全局梳理。
> SQLite、克制原则；所有业务/配置表预留 `user_id`（默认 1 = 默认用户），为后续多用户系统留扩展点。
> 执行留痕、去重、迁移、多渠道通知等运维与扩展需求一并落地。

---

## 1. 设计原则

### 1.1 遵循项目既定原则（不破坏 DESIGN.md 第 9 条）

1. **没有第二个实现，不抽象接口**——不引入 Repository、Provider、Plugin 层。
2. **SQLite 唯一存储**——不引 MySQL/PG/Redis；不追求高并发 schema。
3. **优先简单可用**——能 TEXT 存的不上 JSON，能单行存的不开表。

### 1.2 DBA/架构师全局补强（在克制前提下做对的事）

| 维度 | 决策 | 理由 |
|---|---|---|
| 主键 | 全部 `INTEGER PRIMARY KEY AUTOINCREMENT`（schema_migration 例外） | 量级足够，避免 UUID 索引膨胀 |
| 时间存储 | `TEXT`，ISO 8601 UTC（`datetime('now')`） | SQLite 原生支持，可读、可排序、可比较 |
| 布尔 | `INTEGER` 0/1 | SQLite 无原生 BOOL |
| **用户预留** | **所有业务/配置表带 `user_id INTEGER NOT NULL DEFAULT 1`** | **单用户自托管时恒为 1；未来多用户无需改表结构，只加 user 表 + FK 约束** |
| 软删除 | `status` 枚举字段（`active`/`archived`） | 兴趣删除实际是归档，保留历史 update 引用完整性 |
| 外键 | 显式 `FOREIGN KEY` + `ON DELETE CASCADE` | SQLite 默认关闭 FK，需启动 `PRAGMA foreign_keys=ON` |
| 审计字段 | 所有业务表带 `created_at` + `updated_at` | 可追溯 |
| 去重 | `update.content_hash` UNIQUE | 防止同源信息重复入库（原型 P2 已提） |
| 执行留痕 | 独立 `task_run` 表 | 排查、重试、成本核算、去重依据 |
| 迁移版本 | 独立 `schema_migration` 表（全局，不带 user_id） | DESIGN.md 已要求 Flyway 风格 |
| 多渠道通知 | 独立 `notification_channel` 表 | 原型已暴露飞书/钉钉/邮件三类，单行 settings 会字段爆炸 |
| 配置敏感字段 | API Key 等以明文存 SQLite | 自托管，加密 Key 反而无处置；Docker 卷由用户掌控 |
| 命名 | 表名单数、snake_case；字段 snake_case | 与 DESIGN.md 保持一致 |
| 索引前缀 | 业务/配置表索引统一以 `user_id` 开头 | 未来 per-user 查询主路径；单用户时退化为普通索引，无副作用 |

### 1.3 命名规范

- 表名：单数名词，`snake_case`（`interest`、`task_run`、`schema_migration`）。
- 字段：`snake_case`；时间字段统一 `_at` 后缀；布尔字段用 `is_` / `has_` 前缀。
- 外键字段：`<引用表单数>_id`（`interest_id`、`task_run_id`）。
- `user_id`：统一字段名，默认 `1`；不带外键约束（用户表暂未建），由应用层保证取值合法。
- 索引：`idx_<表>_<字段>`；唯一索引 `uq_<表>_<字段>`；带 user 前缀的复合索引用 `idx_<表>_user_<字段>`。

### 1.4 `user_id` 预留策略

| 表 | 是否带 user_id | 说明 |
|---|---|---|
| interest / task / update / task_run | 是（NOT NULL DEFAULT 1） | task/task_run/update 的 user_id 冗余自 interest，避免多级 JOIN |
| settings | 是（NOT NULL DEFAULT 1，UNIQUE(user_id)） | 每用户一行配置 |
| notification_channel | 是（NOT NULL DEFAULT 1） | 每用户多渠道；部分唯一索引保证每用户至多 1 个默认 |
| schema_migration | 否 | 全局迁移版本表，与用户无关 |

**预留而非提前实现用户系统**：
- 当前 `user_id` 默认值 `1` 代表「默认用户」，应用层所有写入默认填 1。
- 不建 `user` 表、不加外键约束（遵循「没有第二个实现不抽象」）。
- 未来做多用户时：建 `user` 表 → 给 `user_id` 加 `FK` 约束 → 迁移历史数据（`user_id=1` 映射到首个真实用户）→ 应用层从会话注入 `user_id`。
- 此举把「多用户改造」从「全表加列 + 重建索引」降为「加约束 + 数据迁移」，成本可控。

---

## 2. 表清单（7 张）

| # | 表名 | 中文 | 层 | 关系 | user_id | 对应原型 |
|---|---|---|---|---|---|---|
| 1 | `interest` | 兴趣对象 | 业务 | 1:1 task, 1:N update/task_run | ✓ | Interests / InterestDetail |
| 2 | `task` | 调度任务 | 业务 | N:1 interest (1:1) | ✓ 冗余 | Interests 的 frequency/time/enabled |
| 3 | `update` | 变化记录 | 业务 | N:1 interest, N:1 task_run | ✓ 冗余 | Dashboard / Updates 时间线 |
| 4 | `settings` | 用户配置（每用户一行） | 配置 | — | ✓ UNIQUE | Settings 的 AI/搜索/阈值/时区 |
| 5 | `notification_channel` | 通知渠道 | 配置 | — | ✓ | Settings 的飞书/钉钉/邮件三块 |
| 6 | `task_run` | 执行记录 | 运维 | N:1 task, N:1 interest | ✓ 冗余 | DESIGN.md P2「执行记录」 |
| 7 | `schema_migration` | 迁移版本 | 运维 | — | ✗ 全局 | DESIGN.md「Flyway 风格工具」 |

> 与 DESIGN.md 4 张表的差异：
> - 所有业务/配置表预留 `user_id`，为多用户系统留扩展点。
> - `notification_channel` 从 `settings` 拆出（原型已需 3 渠道 × 多字段）。
> - `task_run` 新增（运维必须：去重、排查、成本核算）。
> - `schema_migration` 新增（迁移版本管理）。
> - `interest` 增加 `status`、`description`、`query_keywords`、`updated_at`。
> - `update` 增加 `task_run_id`、`is_read`、`is_notified`、`notified_at`、`content_hash`、`updated_at`。
> - `settings` 从「单行 CHECK(id=1)」改为「按 user_id 一行，UNIQUE(user_id)」。

---

## 3. ER 关系图

```mermaid
erDiagram
    interest ||--o| task : "1:1"
    interest ||--o{ update : "1:N"
    interest ||--o{ task_run : "1:N (冗余)"
    task ||--o{ task_run : "1:N"
    task_run ||--o{ update : "1:N"

    interest {
        INTEGER id PK
        INTEGER user_id "默认1,预留"
        TEXT name
        TEXT category
        TEXT description
        TEXT query_keywords
        TEXT status
        TEXT created_at
        TEXT updated_at
    }
    task {
        INTEGER id PK
        INTEGER user_id "冗余自interest"
        INTEGER interest_id FK_UQ
        TEXT frequency
        TEXT time
        INTEGER enabled
        TEXT last_run_at
        TEXT next_run_at
        TEXT created_at
        TEXT updated_at
    }
    update {
        INTEGER id PK
        INTEGER user_id "冗余自interest"
        INTEGER interest_id FK
        INTEGER task_run_id FK
        TEXT title
        TEXT summary
        TEXT source_url
        TEXT source_name
        TEXT published_at
        INTEGER importance
        INTEGER is_read
        INTEGER is_notified
        TEXT notified_at
        TEXT content_hash UQ
        TEXT created_at
        TEXT updated_at
    }
    settings {
        INTEGER id PK
        INTEGER user_id UQ "默认1"
        TEXT ai_base_url
        TEXT ai_api_key
        TEXT ai_model
        TEXT search_provider
        TEXT search_api_key
        TEXT timezone
        INTEGER notify_threshold
        TEXT created_at
        TEXT updated_at
    }
    notification_channel {
        INTEGER id PK
        INTEGER user_id "默认1"
        TEXT type
        TEXT name
        TEXT config "JSON"
        INTEGER enabled
        INTEGER is_default "每用户至多1"
        TEXT created_at
        TEXT updated_at
    }
    task_run {
        INTEGER id PK
        INTEGER user_id "冗余自interest"
        INTEGER task_id FK
        INTEGER interest_id FK
        TEXT status
        TEXT started_at
        TEXT finished_at
        INTEGER duration_ms
        TEXT search_query
        INTEGER search_result_count
        INTEGER llm_input_tokens
        INTEGER llm_output_tokens
        REAL llm_total_cost
        TEXT error_type
        TEXT error_message
        TEXT created_at
    }
    schema_migration {
        TEXT version PK
        TEXT name
        TEXT checksum
        TEXT applied_at
    }
```

---

## 4. 数据字典

> 字段说明中标注 `[冗余]` 的 user_id 表示该值可从父表推导，本地存储仅为查询便捷（避免多级 JOIN）。

### 4.1 `interest` — 兴趣对象

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | | 主键 |
| user_id | INTEGER | NOT NULL | 1 | 所属用户，预留多用户 |
| name | TEXT | NOT NULL | | 兴趣描述，如「华友钴业」「Spring Framework」 |
| category | TEXT | NOT NULL | | 分类枚举：`company`/`policy`/`tech`/`game`/`finance` |
| description | TEXT | | NULL | 补充说明，作为 LLM 上下文 |
| query_keywords | TEXT | | NULL | 搜索关键词（可不同于 name） |
| status | TEXT | NOT NULL CHECK(status IN('active','archived')) | 'active' | 生命周期：归档后不再调度，但保留历史 |
| created_at | TEXT | NOT NULL | datetime('now') | 创建时间 UTC |
| updated_at | TEXT | NOT NULL | datetime('now') | 更新时间 UTC |

**索引**：
- `idx_interest_user_status` — `(user_id, status)` — 列表只展示当前用户 active
- `idx_interest_user_category` — `(user_id, category)` — 按分类筛选

**说明**：
- 原型 `Interests.vue` 中 `enabled` toggle 实际控制的是关联 `task.enabled`，而非 interest 本身。
- `status='archived'` 字段预留（软删除设计），MVP 未使用：删除走物理 `DELETE`（级联清理 task/update/task_run），service 层暂无 `archive` 方法。
- 分类枚举值使用英文 key，前端做中文映射。原型两处分类用词不一致（Dashboard 用「科技/财经」，Interests 用「技术/公司」），统一为英文枚举后由前端映射层处理。

---

### 4.2 `task` — 调度任务（1:1 interest）

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | | 主键 |
| user_id | INTEGER | NOT NULL | 1 | [冗余] 所属用户，来自 interest.user_id |
| interest_id | INTEGER | NOT NULL, UNIQUE, FK→interest(id) ON DELETE CASCADE | | 关联兴趣（1:1，UNIQUE 保证） |
| frequency | TEXT | NOT NULL CHECK(frequency IN('day','week')) | | 执行频率 |
| time | TEXT | NOT NULL | | 执行时间 `HH:MM` |
| enabled | INTEGER | NOT NULL CHECK(enabled IN(0,1)) | 1 | 是否启用调度 |
| last_run_at | TEXT | | NULL | 上次执行时间 |
| next_run_at | TEXT | | NULL | 下次执行时间（scheduler 写入） |
| created_at | TEXT | NOT NULL | datetime('now') | |
| updated_at | TEXT | NOT NULL | datetime('now') | |

**索引**：
- `uq_task_interest_id` — UNIQUE，保证 1:1
- `idx_task_user_next_run` — `(user_id, next_run_at)` — scheduler 扫描 `WHERE user_id=? AND enabled=1 AND next_run_at <= ?`
- `idx_task_user_enabled` — `(user_id, enabled)` — 启用筛选

**说明**：
- 1:1 设计而非把字段塞进 interest：调度逻辑独立于兴趣本体，未来若一个兴趣需要多套调度策略（如同时日检 + 周报），只需放开 UNIQUE 约束，无需改表结构。
- MVP 仅 `day`/`week`，不设计 cron 表达式（遵循 DESIGN.md）。

---

### 4.3 `update` — 变化记录

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | | 主键 |
| user_id | INTEGER | NOT NULL | 1 | [冗余] 所属用户，来自 interest.user_id |
| interest_id | INTEGER | NOT NULL, FK→interest(id) ON DELETE CASCADE | | 关联兴趣 |
| task_run_id | INTEGER | FK→task_run(id) ON DELETE SET NULL | NULL | 产生该 update 的执行记录 |
| title | TEXT | NOT NULL | | 标题 |
| summary | TEXT | | NULL | AI 摘要 |
| source_url | TEXT | | NULL | 来源 URL |
| source_name | TEXT | | NULL | 来源名（如「东方财富」「Spring Blog」） |
| published_at | TEXT | | NULL | 信息原始发布时间 |
| importance | INTEGER | NOT NULL CHECK(importance BETWEEN 1 AND 10) | | 重要度 1-10 |
| is_read | INTEGER | NOT NULL CHECK(is_read IN(0,1)) | 0 | 是否已读 |
| is_notified | INTEGER | NOT NULL CHECK(is_notified IN(0,1)) | 0 | 是否已通知 |
| notified_at | TEXT | | NULL | 通知发送时间 |
| content_hash | TEXT | UNIQUE | NULL | 去重哈希（source_url + title 归一化后 SHA-256） |
| created_at | TEXT | NOT NULL | datetime('now') | 入库时间 |
| updated_at | TEXT | NOT NULL | datetime('now') | |

**索引**：
- `idx_update_user_interest_published` — `(user_id, interest_id, published_at DESC)` — 时间线查询主索引
- `idx_update_user_importance` — `(user_id, importance DESC)` — Dashboard 取重要变化
- `idx_update_user_created` — `(user_id, created_at DESC)` — 全局最新
- `idx_update_user_unread` — `(user_id, is_read) WHERE is_read=0` — 部分索引，未读筛选
- `uq_update_content_hash` — UNIQUE，去重

**重要度分级**（沿用 DESIGN.md）：1-3 无关 / 4-6 一般 / 7-8 重要 / 9-10 重大；`importance >= settings.notify_threshold`（默认 7）才触发通知。

**去重策略**：写入前计算 `content_hash = sha256(normalize(source_url) + '|' + normalize(title))`，命中 UNIQUE 则跳过（或更新 importance/summary，由业务决定）。

**说明**：
- `task_run_id` 允许 NULL：兼容手动触发或历史数据；ON DELETE SET NULL 保留 update 不丢失。
- 原型只展示单个 `source`，本表保留 `source_url` + `source_name` 两字段；若未来 LLM 聚合多来源，可拆 `update_source` 子表（1:N），当前不提前抽象。

---

### 4.4 `settings` — 用户配置（每用户一行）

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | | 主键 |
| user_id | INTEGER | NOT NULL, UNIQUE | 1 | 所属用户，UNIQUE 保证每用户一行 |
| ai_base_url | TEXT | | 'https://api.openai.com/v1' | OpenAI 兼容端点 |
| ai_api_key | TEXT | | NULL | API Key |
| ai_model | TEXT | | 'gpt-4o' | 模型名 |
| search_provider | TEXT | NOT NULL | 'tavily' | 搜索提供商 |
| search_api_key | TEXT | | NULL | 搜索 API Key |
| timezone | TEXT | NOT NULL | 'Asia/Shanghai' | 调度时区 |
| notify_threshold | INTEGER | NOT NULL CHECK(BETWEEN 1 AND 10) | 7 | 通知重要度阈值 |
| created_at | TEXT | NOT NULL | datetime('now') | |
| updated_at | TEXT | NOT NULL | datetime('now') | |

**约束**：
- `UNIQUE(user_id)` 保证每用户一行
- 初始化时 INSERT 一行 `user_id=1`（见 §6 初始数据）

**说明**：
- 从 v1.0 的「单行 CHECK(id=1)」改为「按 user_id 一行」：为多用户预留，单用户时 `user_id` 恒为 1，行为等价。
- 通知渠道（飞书/钉钉/邮件）已拆到 `notification_channel` 表，本表只保留「阈值/时区/AI/搜索」这类单值配置。

---

### 4.5 `notification_channel` — 通知渠道

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | | 主键 |
| user_id | INTEGER | NOT NULL | 1 | 所属用户 |
| type | TEXT | NOT NULL CHECK(type IN('feishu','dingtalk','email')) | | 渠道类型 |
| name | TEXT | NOT NULL | | 用户自定义名称，如「我的飞书」 |
| config | TEXT | NOT NULL | JSON 字符串 | 渠道配置（见下方 schema） |
| enabled | INTEGER | NOT NULL CHECK(enabled IN(0,1)) | 1 | 是否启用 |
| is_default | INTEGER | NOT NULL CHECK(is_default IN(0,1)) | 0 | 是否默认渠道 |
| created_at | TEXT | NOT NULL | datetime('now') | |
| updated_at | TEXT | NOT NULL | datetime('now') | |

**索引**：
- `idx_channel_user_type` — `(user_id, type)` — 按用户+类型筛选
- `uq_channel_user_default` — 部分唯一索引 `(user_id) WHERE is_default=1` — 每用户至多 1 个默认渠道

**`config` JSON Schema（按 type）**：

```json
// type = "feishu"
{ "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx", "secret": "" }

// type = "dingtalk"
{ "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=xxx", "secret": "" }

// type = "email"
{ "smtp_host": "smtp.qq.com", "smtp_port": 465, "from": "your@email.com",
  "password": "授权码", "to": "receiver@email.com", "use_tls": true }
```

**说明**：
- 用 JSON 存 config：三类渠道字段差异大，强行拍平会产生大量空字段；SQLite 对 JSON 有原生函数支持。
- `is_default=1` 每用户至多一条，由部分唯一索引 `uq_channel_user_default` 保证。
- **不抽象 NotificationProvider 接口**（遵循原则）；新增渠道类型只需扩 `type` CHECK 约束 + 实现 notify 函数中的 switch 分支。

---

### 4.6 `task_run` — 执行记录

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | | 主键 |
| user_id | INTEGER | NOT NULL | 1 | [冗余] 所属用户，来自 interest.user_id |
| task_id | INTEGER | NOT NULL, FK→task(id) ON DELETE CASCADE | | 关联任务 |
| interest_id | INTEGER | NOT NULL, FK→interest(id) ON DELETE CASCADE | | [冗余] 冗余存储，方便按兴趣查执行历史 |
| status | TEXT | NOT NULL CHECK(status IN('running','success','failed','partial')) | | 执行状态 |
| started_at | TEXT | NOT NULL | | 开始时间 |
| finished_at | TEXT | | NULL | 结束时间 |
| duration_ms | INTEGER | | NULL | 耗时毫秒 |
| search_query | TEXT | | NULL | 实际使用的搜索词 |
| search_result_count | INTEGER | | NULL | 搜索返回条数 |
| llm_input_tokens | INTEGER | | NULL | LLM 输入 token |
| llm_output_tokens | INTEGER | | NULL | LLM 输出 token |
| llm_total_cost | REAL | | NULL | 本次成本（USD） |
| error_type | TEXT | | NULL | 错误类型：`search_failed`/`llm_failed`/`notify_failed`/`unknown` |
| error_message | TEXT | | NULL | 错误详情 |
| created_at | TEXT | NOT NULL | datetime('now') | |

**索引**：
- `idx_run_user_task` — `(user_id, task_id, started_at DESC)` — 按任务查历史
- `idx_run_user_interest` — `(user_id, interest_id, started_at DESC)` — 按兴趣查历史
- `idx_run_user_status` — `(user_id, status)` — 状态筛选（排查失败）
- `idx_run_user_started` — `(user_id, started_at DESC)` — 全局执行历史

**状态机**：`running → success | partial | failed`（partial = 部分成功，如搜索成功但通知失败）

**说明**：
- 这是 DESIGN.md P2「执行记录 / 错误提示」的落地，提前到 P0——没有它，去重、排查、成本核算全无依据。
- `interest_id` 与 `user_id` 均冗余存储：避免每次查执行历史都要多级 JOIN。
- 保留策略：暂不做自动清理；若未来需要，按 `started_at` 滚动删除 90 天前 `success` 记录（保留 `failed`）。

---

### 4.7 `schema_migration` — 迁移版本（全局，不带 user_id）

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| version | TEXT | PK | | 版本号，如 `20260818_001_init` |
| name | TEXT | | NULL | 迁移名称 |
| checksum | TEXT | | NULL | 文件 SHA-256，用于检测迁移文件被篡改 |
| applied_at | TEXT | NOT NULL | datetime('now') | 应用时间 |

**说明**：
- 沿用 Flyway 风格：版本号 + 名称 + 校验。
- **不带 user_id**：schema 是全局的，与用户无关。
- 迁移文件存放路径：`packages/server/src/migrations/V<YYYYMMDD>_<seq>__<name>.sql`。

---

## 5. 完整 DDL（SQLite）

> 完整可执行版本见 `packages/server/src/migrations/V20260818_001__init.sql`。
> 此处给出与该文件一致的 DDL 摘要，以文档可读性为先。

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 1. interest
CREATE TABLE IF NOT EXISTS interest (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL DEFAULT 1,
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

-- 2. task (1:1 interest)
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

-- 3. task_run
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

-- 4. update ("update" 是保留字,需双引号)
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

-- 5. settings (每用户一行)
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

-- 6. notification_channel
CREATE TABLE IF NOT EXISTS notification_channel (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL DEFAULT 1,
  type         TEXT    NOT NULL CHECK (type IN ('feishu', 'dingtalk', 'email')),
  name         TEXT    NOT NULL,
  config       TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_user_type ON notification_channel(user_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_user_default ON notification_channel(user_id) WHERE is_default = 1;

-- 7. schema_migration (全局,不带 user_id)
CREATE TABLE IF NOT EXISTS schema_migration (
  version     TEXT PRIMARY KEY,
  name        TEXT,
  checksum    TEXT,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 6. 初始数据

```sql
-- 默认用户(user_id=1)配置
INSERT OR IGNORE INTO settings (user_id) VALUES (1);

-- 默认飞书渠道占位(用户需自行填 config)
INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
VALUES (1, 'feishu', '默认飞书', '{"webhook_url":"","secret":""}', 0, 1);

-- 记录初始迁移
INSERT INTO schema_migration (version, name) VALUES ('20260818_001', 'init schema');
```

---

## 7. 迁移策略

### 7.1 MVP 阶段（当前）：不引入迁移工具

遵循 DESIGN.md「没有第二个实现不抽象」——当前只有一个 init 脚本，不需要版本管理框架。

**启动时直接执行** `packages/server/src/migrations/V20260818_001__init.sql`：

- 脚本全部使用 `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`，**幂等可重复执行**。
- `packages/server/src/db.ts` 启动逻辑：
  1. `PRAGMA foreign_keys = ON;`
  2. 读取并 `exec` init.sql
  3. 校验关键表存在（`SELECT name FROM sqlite_master WHERE type='table'`）
- 不引入 `umzug` 等依赖，单文件 init.sql 即可。

### 7.2 设计保留：未来接入点

下列设计已就位，未来 schema 演进时直接接入迁移工具，无需改表结构：

- `schema_migration` 表：已建（记录已应用版本 + checksum）。
- 迁移文件目录：`packages/server/src/migrations/`，已放首版 `V20260818_001__init.sql`。
- 命名规范：`V<YYYYMMDD>_<seq>__<name>.sql`（Flyway 风格）。
- 候选工具：`umzug`（Promise 化，支持事务/checksum/前后置钩子）。

### 7.3 接入时机

当出现以下任一情况，再引入迁移工具：

- 出现第 2 条迁移文件（schema 需要演进，如加字段、改约束）。
- 需在多环境间保证 schema 一致（开发/生产）。
- 需要回滚能力。

届时只需：引入 umzug → 把 init.sql 登记为 V1 → 后续迁移按规范新增文件。

### 7.4 迁移规范（接入工具后适用）

- 迁移文件**只进不退**（no rollback），回滚通过新写一条反向迁移实现。
- 不修改已发布的迁移文件（checksum 校验会报错）；要改就新增一条。
- DDL 与 DML 分离，不在同一条迁移里既改结构又灌数据。
- **本次 init 迁移可直接修改**：项目 DB 尚未接入（见 CLAUDE.md「not yet implemented」），无历史数据需保护。

---

## 8. 索引与查询场景

> 单用户自托管时 `user_id` 恒为 1，以下查询中 `?` 占位传入会话 user_id 即可，索引在单用户时退化为普通索引，无副作用。

| 场景 | 查询 | 命中索引 |
|---|---|---|
| Dashboard 今日重要变化 | `SELECT * FROM "update" WHERE user_id=? AND importance >= ? AND created_at >= date('now','-1 day') ORDER BY created_at DESC` | idx_update_user_importance, idx_update_user_created |
| 按兴趣查时间线 | `SELECT * FROM "update" WHERE user_id=? AND interest_id=? ORDER BY published_at DESC` | idx_update_user_interest_published |
| 未读列表 | `SELECT * FROM "update" WHERE user_id=? AND is_read=0 ORDER BY created_at DESC LIMIT 50` | idx_update_user_unread, idx_update_user_created |
| 调度器扫描待执行任务 | `SELECT * FROM task WHERE user_id=? AND enabled=1 AND next_run_at <= datetime('now')` | idx_task_user_next_run, idx_task_user_enabled |
| 按兴趣查执行历史 | `SELECT * FROM task_run WHERE user_id=? AND interest_id=? ORDER BY started_at DESC LIMIT 20` | idx_run_user_interest |
| 失败任务排查 | `SELECT * FROM task_run WHERE user_id=? AND status='failed' ORDER BY started_at DESC LIMIT 50` | idx_run_user_status, idx_run_user_started |
| 默认通知渠道 | `SELECT * FROM notification_channel WHERE user_id=? AND is_default=1 AND enabled=1` | uq_channel_user_default |
| 活跃兴趣列表 | `SELECT * FROM interest WHERE user_id=? AND status='active' ORDER BY created_at DESC` | idx_interest_user_status |
| 按分类筛选 | `SELECT * FROM interest WHERE user_id=? AND status='active' AND category=?` | idx_interest_user_status, idx_interest_user_category |
| 去重写入 | `INSERT INTO "update" (...) VALUES (...) ON CONFLICT(content_hash) DO NOTHING` | uq_update_content_hash |
| 用户配置读取 | `SELECT * FROM settings WHERE user_id=?` | UNIQUE(user_id) 隐含索引 |

---

## 9. 关键业务流程的表协作

### 9.1 创建兴趣（Interests 页面「添加兴趣」）

```
BEGIN
  -- 应用层从会话取 user_id (单用户时=1)
  INSERT INTO interest (user_id, name, category, ...) VALUES (?, ...)
  INSERT INTO task (user_id, interest_id, frequency, time, enabled)
         VALUES (?, last_insert_rowid(), ?, ?, 1)
COMMIT
```

### 9.2 调度执行（核心闭环）

```
1. scheduler 扫描: SELECT * FROM task WHERE user_id=? AND enabled=1 AND next_run_at <= now
2. 对每个 task:
   BEGIN
     INSERT INTO task_run (user_id, task_id, interest_id, status, started_at)
            VALUES (?, ?, ?, 'running', now)
     -- a. 取 interest, 拼 search_query
     -- b. 调搜索 API → 原始结果
     -- c. 调 LLM → 结构化 updates[]
     -- d. 对每个 update:
     --      计算 content_hash
     --      INSERT ... ON CONFLICT(content_hash) DO NOTHING
     --      若 importance >= threshold 且新插入:
     --        调 notification_channel(默认) 发送
     --        UPDATE "update" SET is_notified=1, notified_at=now WHERE id=?

     UPDATE task_run SET status='success', finished_at=now, duration_ms=?, llm_tokens=?, cost=?
     UPDATE task SET last_run_at=now, next_run_at=compute_next(frequency, time) WHERE id=?
   COMMIT
   -- 异常: UPDATE task_run SET status='failed', error_type=?, error_message=?
```

### 9.3 归档兴趣

```sql
UPDATE interest SET status='archived' WHERE id=? AND user_id=?;
UPDATE task SET enabled=0 WHERE interest_id=? AND user_id=?;
-- 不删除 update/task_run，保留历史
```

### 9.4 物理删除兴趣（确认对话框）

```sql
DELETE FROM interest WHERE id=? AND user_id=?;
-- CASCADE 自动清理 task, update, task_run
```

---

## 10. 扩展预案（暂不实现，留接口）

| 未来需求 | 扩展方式 | 影响表 |
|---|---|---|
| **多用户系统** | 建 `user` 表 → 给所有 `user_id` 加 FK 约束 → 迁移历史数据（user_id=1 映射首个真实用户）→ 应用层会话注入 user_id | 加 user 表 + FK，不改业务表结构 |
| 一个兴趣多套调度 | 去掉 `task.interest_id` 的 UNIQUE 约束 | task |
| 自定义 cron 频率 | `task.frequency` 枚举新增 `'cron'` + 新增 `cron_expr` 字段 | task |
| 多来源聚合 | 拆 `update_source` 子表（update_id, url, name, is_primary） | 新表 |
| 用户标记/收藏 | `update` 增加 `is_starred` 字段 | update |
| 兴趣分组/标签 | 新增 `tag` 表 + `interest_tag` 关联表 | 新表 |
| 通知规则细化（按兴趣指定渠道） | 新增 `interest_channel` 关联表 | 新表 |
| 历史数据归档 | 定时清理 `task_run` 中 90 天前 success 记录 | task_run |

> `user_id` 预留使得「多用户」从「全表加列 + 重建索引」降为「加约束 + 数据迁移」，是本次设计的关键前置投资。
> 其余扩展均为「验证后有真实需求才做」，当前 schema 为它们留出了扩展空间，但**不提前实现**（遵循 DESIGN.md 第 9 条）。

---

## 11. 与原型的字段映射

| 原型字段（Vue） | 表.字段 | 备注 |
|---|---|---|
| Dashboard: `item.title/source/category/time` | update.title/source_name/interest.category/published_at | time 为相对时间，由前端计算 |
| Interests: `item.id/name/category/frequency/time/enabled` | interest.id/name/category + task.frequency/time/enabled | 联表查询，均带 user_id 过滤 |
| Updates: `item.importance` | update.importance | 1-10 |
| Settings.ai.{baseUrl,apiKey,model} | settings.ai_base_url/ai_api_key/ai_model | WHERE user_id=? |
| Settings.search.{provider,apiKey} | settings.search_provider/search_api_key | WHERE user_id=? |
| Settings.feishu.{webhookUrl,secret} | notification_channel WHERE type='feishu' AND user_id=?, config JSON | |
| Settings.dingtalk.{webhookUrl,secret} | notification_channel WHERE type='dingtalk' AND user_id=?, config JSON | |
| Settings.email.{smtpHost,smtpPort,from,password,to} | notification_channel WHERE type='email' AND user_id=?, config JSON | |
| Settings（隐含）notify_threshold/timezone | settings.notify_threshold/timezone | WHERE user_id=? |

---

## 12. 风险与权衡说明

1. **`update` 是 SQL 保留字**：DDL 中需双引号包裹 `"update"`，应用层 ORM/查询构建器需注意转义。若嫌麻烦可改名为 `change`/`event`，但 DESIGN.md 已用 `updates`，本文档统一为单数 `update` 并加双引号。**建议团队评估后决定是否改名**。

2. **`user_id` 预留的代价**：
   - 所有业务表多一个 INTEGER 字段，存储开销可忽略。
   - 索引以 `user_id` 开头，单用户时 selectivity 极低（恒为 1），但 SQLite 仍会使用索引，不会比无 user_id 差。
   - 当前 `user_id` 无外键约束（user 表未建），数据完整性由应用层保证（默认填 1）。
   - **收益**：未来多用户改造无需「全表加列 + 重建索引 + 数据回填」，只需「建 user 表 + 加 FK 约束 + user_id=1 数据映射」。

3. **JSON 字段查询能力**：SQLite JSON 函数（`json_extract`）性能尚可，但无法走索引。当前 `notification_channel.config` 仅在应用启动时按 user_id 全量加载到内存，不构成性能问题。若未来需按 config 内字段查询，考虑提取为独立列。

4. **外键级联删除**：`ON DELETE CASCADE` 在 SQLite 默认关闭，必须 `PRAGMA foreign_keys=ON`。应用层每次连接需确保开启，否则级联失效。

5. **时间存储为 TEXT**：依赖 ISO 8601 字符串字典序与时间序一致。所有时间必须 UTC 存储，展示时由应用层按 `settings.timezone` 转换。严禁混存本地时间。

6. **content_hash 去重的局限**：基于 URL+title，对「同一事件不同标题报道」无法去重。若需语义去重，需引入 embedding（DESIGN.md 明确暂不做）。

7. **冗余 user_id 一致性**：task/task_run/update 的 user_id 冗余自 interest.user_id，写入时必须与 interest 保持一致。应用层在创建 task/update/task_run 时从 interest 读取 user_id 一并写入，禁止跨用户赋值。

---

*文档版本：v1.1 · 2026-08-18 · 基于 DESIGN.md 与 5 个 Vue 原型视图；v1.1 全表预留 user_id*
