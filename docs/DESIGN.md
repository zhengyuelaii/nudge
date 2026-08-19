# Nudge — AI Interest Tracker 设计文档

> Self-hosted Personal Interest Monitoring System
> 你定义值得长期关注的事，它负责定期检查；只有发生重要变化时，才提醒你。
> Track what matters. Get notified when it changes.

---

## 1. 产品定位与边界

### 是什么
- 长期兴趣追踪与定时提醒系统。
- 用户定义长期关注对象 → 系统按设定周期自动检查 → AI 判断重要变化 → 值得关注时通知。

### 不是什么（明确不做，验证成功前暂缓）
- AI Chat / AI 写作 / 知识库 / RAG / 新闻推荐 / Deep Research / AI Agent 平台
- SaaS / 用户系统 / 多租户 / 云同步 / 插件市场 / 工作流
- 微服务 / MQ / Redis / Kubernetes / Repository 抽象 / Provider 抽象 / Plugin Interface
- 第二种数据源插件系统、向量库、Embedding

### 唯一评判标准
新增任何功能前先问：**它是否直接帮助用户更好地完成「长期兴趣 → 定时检查 → 发现变化 → 通知」闭环？** 否则默认不做。
核心竞争力不是"塞多少 AI 能力"，而是"只关注你真正关心的，且不用无关信息打扰你"。

### 产品原则
**主动检查，被动打扰。** 没有重要变化就不通知。

---

## 2. 技术决策（已定）

| 项 | 决策 | 说明 |
|---|---|---|
| 包管理 | pnpm（workspace） | 根 `package.json` + `pnpm-workspace.yaml` |
| 仓库形态 | 单仓库 `packages/` 多包 | `packages/backend` + `packages/frontend`，各自独立依赖 |
| 运行时 | Node.js 22 LTS + TypeScript | 前后端统一语言；better-sqlite3 需匹配运行时 Node 版本 |
| 后端框架 | Express | 单体应用，HTTP 路由 |
| 数据访问 | **待定** | better-sqlite3 / Drizzle / 等评估后定；确定前先用最简方案，不抽象 Repository |
| 表结构升级 | Flyway 风格工具（待定，候选 umzug / sql-migrate） | 版本化迁移，记录已执行 |
| 校验 | Zod | 请求响应校验 |
| 数据库 | SQLite | 唯一存储，不引 MySQL/PG/Redis/向量库 |
| 调度 | node-cron | 每天 / 每周 |
| HTTP 客户端 | 原生 fetch（Node 18+） | 调搜索 API 与 LLM |
| 前端 | Vue 3 + TypeScript + Vue Router | Pinia 非强制，无实际需求不加 |
| 部署 | Docker（self-hosted） | 数据、Key、配置全属用户，不依赖开发者服务器 |
| AI Search | 搜索 API + LLM 两步 | Tavily 等搜索 API 取原始结果，再交 LLM 分析 |
| 通知 | 飞书 Webhook | MVP 仅此一个渠道，不抽象 Provider |

---

## 3. 架构图

```
                Browser
                   │
                   ↓
          Vue 3 + TypeScript
                   │
                  HTTP
                   ↓
           Node.js + Express
                   │
      ┌────────────┼────────────┐
      ↓            ↓            ↓
   Interest       Task        Update
                   │
                   ↓
               node-cron
                    │
                    ↓
               Search API  (Tavily 等)
                    │
                    ↓
               AI Analysis (LLM, fetch)
                   │
                   ↓
                SQLite
                   │
                   ↓
             Feishu Webhook
```

第一版保持单体应用。

---

## 4. 目录结构

```
nudge/
├── packages/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── main.ts          # Express 入口
│   │   │   ├── db.ts            # SQLite 连接 + 建表/迁移
│   │   │   ├── models.ts        # 4 表类型 + 建表语句
│   │   │   ├── schemas.ts       # Zod 校验（请求/响应）
│   │   │   ├── routes/
│   │   │   │   ├── interests.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── updates.ts
│   │   │   │   └── settings.ts
│   │   │   ├── scheduler.ts     # node-cron 启动/调度
│   │   │   ├── check.ts         # 单次检查：搜索→分析→生成 Update
│   │   │   ├── ai.ts            # Search API + LLM 分析（fetch）
│   │   │   └── notify.ts        # 飞书 Webhook
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/
│       ├── src/
│       │   ├── router/
│       │   ├── views/           # Dashboard / Interests / InterestDetail / Settings
│       │   ├── api/             # 调后端
│       │   └── App.vue
│       └── package.json
├── docs/
│   └── DESIGN.md            # 本文件
├── package.json            # 根（pnpm workspace）
├── pnpm-workspace.yaml
└── docker-compose.yml
```

无 `repositories/`、`providers/`、`plugins/`、`services/` 抽象目录。

---

## 5. 数据模型（4 张表）

### interest — 长期关注对象
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int (PK) | |
| name | str | 名称，如「华友钴业」「Spring Framework」 |
| category | str | 分类：公司 / 政策 / 技术 / 游戏 等 |
| created_at | datetime | |

### task — 定时检查任务
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int (PK) | |
| interest_id | int (FK) | |
| frequency | str | `day` / `week` |
| time | str | `HH:MM` 执行时间 |
| enabled | bool | 默认 true |
| last_run_at | datetime | 上次执行 |
| next_run_at | datetime | 下次执行（由 scheduler 计算） |

MVP 只支持每天 / 每周，不设计 Cron 与复杂规则。

### updates — 值得知道的重要变化
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int (PK) | |
| interest_id | int (FK) | |
| title | str | |
| summary | str | |
| source_url | str | |
| source_name | str | 来源名 |
| published_at | datetime | 信息原始发布时间 |
| importance | int | 1-10 |
| created_at | datetime | 入库时间 |

重要度：1-3 无关 / 4-6 一般 / 7-8 重要 / 9-10 重大。
默认 `importance >= 7` 才触发通知。

### settings — 单行配置（id = 1）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int (PK, 固定 1) | |
| ai_base_url | str | OpenAI 兼容端点 |
| ai_api_key | str | |
| ai_model | str | |
| search_provider | str | 默认 `tavily` |
| search_api_key | str | |
| feishu_webhook | str | |
| timezone | str | 如 `Asia/Shanghai` |
| notify_threshold | int | 通知重要度阈值，默认 7 |

---

## 6. 核心业务流程（闭环）

```
用户创建 Interest
      ↓
创建 Task
      ↓
Scheduler 到达执行时间
      ↓
check.py:
  1. 取 interest → 拼查询词
  2. ai.py 调 Search API → 原始结果(标题/链接/摘要)
  3. 搜索结果 + 上下文 发 LLM → 去噪/去重/总结/判重要性
  4. LLM 返回结构化(title/summary/source_url/source_name/published_at/importance)
      ↓
  是否 importance >= notify_threshold?
   ┌────────┴────────┐
   否               是
   ↓                ↓
 写 update       写 update + 飞书通知
```

AI 职责仅限：搜索 → 理解 → 过滤 → 总结 → 判断变化是否重要。
Timeline 不是独立模型，仅是 `update WHERE interest_id=? ORDER BY published_at DESC` 的展示。

---

## 7. 页面（MVP 4 个）

1. **Dashboard** — 今日重要 Update、我的 Interest、最近变化。
2. **Interests** — 列表 + 添加 / 编辑 / 删除 / 查看详情。
3. **Interest Detail** — Interest 信息、Task（频率/时间/启用）、[立即检查]、历史 Update（倒序）。
4. **Settings** — AI（provider/base_url/key/model）、Notification（飞书 webhook + 测试）、System（时区 + 阈值）。

---

## 8. 开发优先级

### P0：核心闭环（先做）
- db / models / schemas
- interest、task CRUD API
- node-cron 启动与调度
- check + ai（搜索 API + LLM）+ notify 雏形
- update 写入与查询 API

### P1：完整可用
- Dashboard / Interests / Interest Detail / Settings 前端
- 飞书测试通知
- 完成后即第一个可用版本

### P2：体验优化（验证后再做）
- 手动立即检查
- Update 去重优化
- 重要度筛选
- Task 启用/禁用
- 通知测试入口
- 执行记录 / 错误提示
- 搜索结果质量优化

---

## 9. 架构原则（贯穿始终）

1. 没有第二个实现，不允许抽象接口。
2. 没有用户，不设计插件系统。
3. 没有性能问题，不做性能优化（单用户 / 个人服务器 / 低并发 / SQLite）。
4. 没有第二种存储，不抽象 Repository，直接 SQLite。
5. 优先实现功能，选择最简单、能工作的方案。

---

## 10. 未来扩展（暂缓，验证后再评估）

- 后续可能接入 **openclaw / dsh** 等插件/扩展能力。
- 在核心闭环被验证有价值之前，**不提前设计插件系统、Provider 抽象或扩展接口**。
- 届时若真有多个实现需求，再据此引入恰当的扩展点（与第 9 条原则一致：没有第二个实现，不允许抽象）。
