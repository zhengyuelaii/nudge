# Nudge — AI 兴趣追踪系统

自托管的个人兴趣监控系统：定义兴趣 → 定期搜索 → AI 判断重要变化 → 飞书通知。

## 功能

- **兴趣管理**：创建/编辑/启停兴趣点，支持每日/每周调度
- **智能分析**：Tavily 搜索 + LLM 结构化分析，判定「是否有实质进展」
- **飞书通知**：重要变化推送到飞书群（支持签名验签）
- **手动检查**：一键立即检查，无需等待定时任务
- **执行留痕**：每次执行的耗时、token 用量、状态均记录可查

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Hono + TypeScript + better-sqlite3 |
| 前端 | Vue 3 + Vite + Tailwind CSS v4 |
| AI | Vercel AI SDK + DeepSeek |
| 搜索 | Tavily API |
| 构建 | pnpm workspace 单仓库 |

## 快速开始

```bash
pnpm install

# 配置凭证（AI / 搜索 / 飞书）
# 启动后在前端「设置」页填写，或直接写入 SQLite

pnpm dev        # 同时启动 server(8787) + web(5173)
```

前端访问 `http://localhost:5173`，API 通过 `/api` 代理到 `http://localhost:8787`。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 服务端口 | `8787` |
| `DB_PATH` | SQLite 数据库路径 | `~/.nudge/data/nudge.db` |
| `NUDGE_SCHEDULER` | 设为 `off` 关闭定时调度 | 开启 |

> AI/搜索/飞书等业务凭证存于数据库 `settings` / `notification_channel` 表，在「设置」页维护。

## 部署

需要一台常驻 Linux 主机（定时调度跑在进程内，进程停了就不再触发）和持久磁盘。

```bash
cd deploy
bash setup.sh                 # 生成配置，并打印用户名与密码
docker compose up -d --build
```

打开 `http://<主机IP>:8080` 即可。数据库在 `deploy/data/nudge.db`，容器重建不丢；代码更新后重新 `docker compose up -d --build`。

`deploy/.env` 可按需调整：

| 变量 | 说明 | 默认 |
|---|---|---|
| `HTTP_PORT` | 对外端口 | `8080` |
| `TZ` | 容器时区 | `UTC` |

## 目录结构

```
packages/
├── shared/   # 共享类型
├── server/   # 后端（routes / services / scheduler / ai / notify / db / lib）
└── web/      # 前端（Dashboard / Interests / InterestDetail / Updates / Settings）
```

## 开发

```bash
pnpm lint      # ESLint + vue-tsc
pnpm build     # shared → server → web

pnpm --filter @nudge/server test       # 后端 vitest 测试（根目录没有 test 脚本）
pnpm --filter @nudge/server test:e2e   # E2E：真调 Tavily + DeepSeek，缺 key 自动跳过
```

## License

MIT
