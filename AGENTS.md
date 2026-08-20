# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 与 `AGENTS.md` 同步维护（后者同样面向其他 AI agent）。改动请两处同改。两者内容一致，以 `AGENTS.md` 为准。

## 项目概览

Nudge — 自托管 AI 兴趣追踪器：定义兴趣 → 周期性搜索（Tavily）→ LLM 分析（Vercel AI SDK + DeepSeek）→ 重要变化通知（飞书 webhook / SMTP 邮件）。单用户：所有查询硬编码 `user_id = 1`（已预留 `user_id` 列以备多用户）。

## 命令

```bash
pnpm dev      # scripts/dev.mjs 并行起 server(tsx watch, :8787) + web(vite, :5173)，彩色日志，Ctrl+C 整组退出
pnpm build    # shared → server → web，顺序不可换（后两者依赖 @nudge/shared）
pnpm lint     # pnpm -r lint = server eslint --fix + web vue-tsc
```

- 根**无 `test` 脚本**。跑测：`pnpm --filter @nudge/server test`（vitest）。单文件：`pnpm --filter @nudge/server exec vitest run src/<path>.test.ts`。
- UI 文案中文；代码/测试可英文。

## 技术栈

- **Server = Hono，不是 NestJS**（早期 README/文档若提 NestJS 皆已过时）。栈：Hono + `@hono/node-server` + `@hono/zod-validator` + `better-sqlite3` + `node-cron` + `zod` + `ai` + `@ai-sdk/deepseek` + `nodemailer`。入口 `packages/server/src/main.ts` → `app.ts` 把路由挂在 `/api`。
- Web：Vue 3 + TS + Tailwind v4；vite 把 `/api` 代理到 `http://localhost:8787`。
- pnpm workspace；Node 24（`.nvmrc`）。当前 shell 的 node 多为 homebrew 版，需 `export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"` 才能用 nvm 装的 node/pnpm。
- better-sqlite3 走 prebuild（`node >=22`，Node 24 直接可用）。构建许可写在 `pnpm-workspace.yaml` 的 `allowBuilds` —— **不要**放回 `package.json` 的 `pnpm` 字段，pnpm 11 已不再读取该字段（会发 `pnpm.onlyBuiltDependencies` 被忽略的 warning）。

## Server 布局

`routes/` Hono 路由（按资源、zod 校验）、`services/` DB 访问、`scheduler/` 流水线（`check.ts` = search → LLM 分析 → 写 updates → notify → 记 task_run）、`ai/` search+llm、`notify/` 飞书+邮件、`db/`、`lib/`（errors/http/time/zod/hash）、`migrations/`。路由聚合见 `routes/index.ts`：`/health` `/settings` `/notification-channels` `/interests` `/updates` `/task-runs` `/tags`。

## SQLite / 迁移

- **无迁移框架**。单一幂等文件 `migrations/V20260818_001__init.sql` 每次启动 `CREATE TABLE IF NOT EXISTS`。SQLite 的 `ADD COLUMN` 无 `IF NOT EXISTS`，**新增列必须在代码里 guard** —— 见 `db/client.ts`（`PRAGMA table_info(...)` 后条件 `ALTER TABLE`）。明确决定不引入迁移 runner。
- `"update"` 是 SQL 保留字，SQL 里始终双引号。
- `tag` 表是分类元数据源（种子 5 条：company/policy/tech/game/finance，label+color+sort_order），`interest.category` 存 `tag.code` 文本；`GET /api/tags` 供前端 `composables/useTags.ts` 使用（前端禁止再硬编码分类数组/颜色映射）。
- DB 落在 `packages/server/data/nudge.db`，`DB_PATH` 可覆盖；测试强制 `DB_PATH=:memory:`，故改表结构必须同步进 init 文件测试才可见。

## Scheduler

- node-cron 每分钟，`main.ts` 启动，除非 `NUDGE_SCHEDULER=off`。vitest 下不跑（测试直接调 `runCheck` / `runDueTasks`）。
- `findDueTasks` 选 `enabled` 且 `next_run_at` 已过的 task，排除最近 ≤10 分钟存在 `running` task_run 的。**残留 `tsx watch` 进程会导致重复执行** —— 先杀旧 dev：`pgrep -fl "tsx watch|vite"`。

## 密钥

- 业务密钥（AI key、Tavily key、飞书 webhook、SMTP 密码）存 **SQLite**（`settings`、`notification_channel.config` JSON），经设置页配置 —— 绝不硬编码。仅测试凭据放 `packages/server/.env`（git-ignore）；测试经 `vitest.setup.ts`（`process.loadEnvFile()`，文件缺失静默 → 占位回退）。
- DingTalk 故意禁用：zod `createChannelSchema` 只允许 `['feishu','email']`；其设置 UI 已注释。
- 推 GitHub 无本地代理会卡：`export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897`。

## 测试约定

- 测试 colocated（`src/**/*.test.ts`），TDD 优先。所有 server 测试共享一个内存 DB；`beforeEach` 清各自涉及的表。
- `notify()` 及 check/search 路径接受注入的 `fetchImpl` / `mailer` / `model` —— 优先 stub 这些而非 mock 模块。
- 改动后先跑单文件 → 全套 + `pnpm lint` + `pnpm build`。
