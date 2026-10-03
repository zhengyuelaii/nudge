# AGENTS.md

面向所有 AI coding agent（Claude Code / CodeBuddy / 其他）的项目指引，本文件是**唯一事实来源**。

> `CLAUDE.md` 不复制内容，只有一段说明 + 官方 import 语法 `@AGENTS.md`，启动时把本文件展开给 Claude Code。
> 因此**改动只改本文件**，不要去改 `CLAUDE.md`。

## 项目概览

Nudge — 自托管 AI 兴趣追踪器：定义兴趣 → 周期性搜索（Tavily）→ LLM 分析（Vercel AI SDK + DeepSeek）→ 重要变化通知（飞书 webhook / SMTP 邮件）。单用户：所有查询硬编码 `user_id = 1`（已预留 `user_id` 列以备多用户）。

## 命令

```bash
pnpm dev      # scripts/dev.mjs 并行起 server(tsx watch, :8787) + web(vite, :5173)，彩色日志，Ctrl+C 整组退出
pnpm build    # shared → server → web，顺序不可换（后两者依赖 @nudge/shared）
pnpm lint     # pnpm -r lint = server eslint --fix + web vue-tsc
```

- 根**无 `test` 脚本**。跑测：`pnpm --filter @nudge/server test`（vitest）。单文件：`pnpm --filter @nudge/server exec vitest run src/<path>.test.ts`。
- **E2E（真调 Tavily + DeepSeek）**：`pnpm --filter @nudge/server test:e2e` —— 自己生成一个兴趣、跑完整一轮、对产物打分。飞书被拦截（不真发消息，但通知链路与 `notify_log` 照跑）。缺 `AI_API_KEY` / `TAVILY_API_KEY` 时整套自动跳过，CI 安全。
- UI 文案中文；代码/测试可英文。

## 技术栈

- **Server = Hono，不是 NestJS**（早期 README/文档若提 NestJS 皆已过时）。栈：Hono + `@hono/node-server` + `@hono/zod-validator` + `better-sqlite3` + `node-cron` + `zod` + `ai` + `@ai-sdk/deepseek` + `nodemailer`。入口 `packages/server/src/main.ts` → `app.ts` 把路由挂在 `/api`。
- Web：Vue 3 + TS + Tailwind v4；vite 把 `/api` 代理到 `http://localhost:8787`。
- pnpm workspace；Node 24（`.nvmrc`）。当前 shell 的 node 多为 homebrew 版，需 `export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"` 才能用 nvm 装的 node/pnpm。
- better-sqlite3 走 prebuild（`node >=22`，Node 24 直接可用）。构建许可写在 `pnpm-workspace.yaml` 的 `allowBuilds` —— **不要**放回 `package.json` 的 `pnpm` 字段，pnpm 11 已不再读取该字段（会发 `pnpm.onlyBuiltDependencies` 被忽略的 warning）。

## Server 布局

`routes/` Hono 路由（按资源、zod 校验）、`services/` DB 访问、`scheduler/` 流水线（`check.ts` = 调 `analyze` → 写 event+source → notify → 记 task_run）、`ai/` 分析链路（`llm.ts` 编排：内部先检索再调模型，另有 `model`/`prompt`/`types` 三个职责模块；prompt 会注入兴趣的 `subject`/`criteria` 关注判据，两者留空则退化为无判据的旧行为）、`search/` 搜索 provider、`e2e/`（核心业务流程端到端测试 + 评分器）、`agent/` Agent Loop、`notify/`（`index.ts` 单渠道发送 + `dispatch.ts` 事件级分发）、`db/`、`lib/`（errors/http/time/zod/hash）、`migrations/`。路由聚合见 `routes/index.ts`：`/health` `/settings` `/notification-channels` `/interests` `/events` `/sources` `/task-runs`。

## SQLite / 迁移

- **无迁移框架**。单一幂等文件 `migrations/V20260818_001__init.sql` 每次启动 `CREATE TABLE IF NOT EXISTS`。明确决定不引入迁移 runner；新列直接加进 init SQL 即可。
- `"update"` 是 SQL 保留字，SQL 里始终双引号。
- DB 落在 **`~/.nudge/data/nudge.db`**（`config.ts` 里的 `join(homedir(), '.nudge', 'data', 'nudge.db')`，不在仓库内），`DB_PATH` 可覆盖；测试强制 `DB_PATH=:memory:`，故改表结构必须同步进 init 文件测试才可见。
- 仓库内**不含任何 db 文件**：`packages/server/data/` 已被 `.gitignore` 忽略，历史残留库已于 2026-10-03 删除。查 schema 只认 `~/.nudge/data/nudge.db` 或 `migrations/V20260818_001__init.sql`。
- 老库升级靠 `db/client.ts#runMigrations()` 的幂等 ALTER 兜底，它目前只覆盖 4 个列，缺口见 `docs/DATABASE.md` 末尾「历史遗留对象」。**改表结构必须同时改 init.sql 与 client.ts 两处**。

## Scheduler

- node-cron 每分钟，`main.ts` 启动，除非 `NUDGE_SCHEDULER=off`。vitest 下不跑（测试直接调 `runCheck` / `runDueTasks`）。
- `findDueTasks` 选 `enabled` 且 `next_run_at` 已过的 task，排除最近 ≤10 分钟存在 `running` task_run 的。**残留 `tsx watch` 进程会导致重复执行** —— 先杀旧 dev：`pgrep -fl "tsx watch|vite"`。

## 密钥

- 业务密钥（AI key、Tavily key、飞书 webhook、SMTP 密码）存 **SQLite**（`settings`、`notification_channel.config` JSON），经设置页配置 —— 绝不硬编码。仅测试凭据放 `packages/server/.env`（git-ignore）；测试经 `vitest.setup.ts`（`process.loadEnvFile()`，文件缺失静默 → 占位回退）。
- DingTalk 故意禁用：zod `createChannelSchema` 只允许 `['feishu','email']`；其设置 UI 已注释。
- 推 GitHub 无本地代理会卡：`export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897`。

## Agent（暂停优化）

- **Agent Loop（`packages/server/src/agent/`）暂停优化**：当前不再主动改进/重构 agent 相关代码。
- 只有**不影响项目**的改动才允许触碰 `agent/` 下文件，例如：为适配表结构/字段变更做的必要同步（列名、设置项、工具名），或修复阻塞运行/测试的 bug。
- 不要做功能增强、prompt 调优、新增工具、行为改进等优化类改动，除非用户明确要求。

## 测试约定

- 测试 colocated（`src/**/*.test.ts`），TDD 优先。所有 server 测试共享一个内存 DB；`beforeEach` 清各自涉及的表。
- `notify()` 及 check/search 路径接受注入的 `fetchImpl` / `mailer` / `model` —— 优先 stub 这些而非 mock 模块。
- **E2E（`src/e2e/`）例外：不打桩**。`core-flow.e2e.test.ts` 自建兴趣 → 真跑 `runCheck`（真检索 + 真模型），只用一个分流 `fetchImpl` 拦下飞书、并缓存本轮 Tavily 响应供评分比对。`scorer.ts` 出两类分：规则分（链路健康 / 证据可信 / 理由完整 / 推送可读，确定性可复现）与 LLM 评审分（噪音率 / 漏判率 / 理由质量，独立模型当评审员）。断言只卡硬底线：run success、来源必须可回溯、总分 ≥60。
- 改动后先跑单文件 → 全套 + `pnpm lint` + `pnpm build`。
