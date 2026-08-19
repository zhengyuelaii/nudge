# Nudge MVP Code Review

> Review 时间：2026-08-19  
> 范围：`packages/server` 全量 + `packages/web` 关键视图 + `packages/shared`  
> 方法：逐文件通读 + 实跑测试（56 passed）+ tsc 类型检查（0 errors）

---

## 0. 总体评价

**MVP 落地度高，质量基础扎实。** 架构、测试、类型三方面都立住了：

| 维度 | 结论 |
|---|---|
| 架构落地 | ✓ 严格遵循 `BACKEND_STRUCTURE.md` 的四层目录（routes/services/scheduler/ai+notify/db+lib），依赖单向无环 |
| 测试 | ✓ 11 文件 56 用例全过，覆盖 scheduler 闭环（崩溃恢复、并发防护）、check 全流程（成功/低于阈值/搜索失败/通知失败 partial）、notify 签名/发送/错误分支 |
| 类型 | ✓ `tsc --noEmit` 零错误 |
| 契约对齐 | ✓ 前后端字段命名一致，`has_progress`/`importance`/`is_notified` 等在 web 和 server 两侧对齐 |
| 克制原则 | ✓ 无 DI、无 Repository 抽象、无 use-case 层，符合 DESIGN.md「没有第二个实现不抽象」 |

**但存在 1 个安全问题 + 2 个功能 bug + 若干健壮性/一致性问题。** 按优先级如下。

---

## 1. 问题清单（按优先级）

### P0 — 安全：测试文件硬编码真实飞书凭证

**位置**：`packages/server/src/notify/index.test.ts:4-5`

```ts
const WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/ccc01090-1d26-4765-b027-d9d54da92d38';
const SECRET = '1AqSz3QKINg5HLsGDNqqsh';
```

**现象**：真实的 webhook URL 和签名 secret 硬编码在源码里。

**影响**：
- 虽然测试 mock 了 `fetch` 不会真发消息，但凭证已进入 git 历史。
- secret 泄露后任何人可向该 webhook 对应的飞书群发消息。
- 即便这是"测试群"，凭证入库就是违规。

**建议**：
1. 立即用占位常量替换（如 `const WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook'`），签名测试用固定 secret。
2. `signFeishu` 的签名验证测试已用固定 timestamp `'1539585323'` 和已知正确签名 `nk38hJViCUe2UVjBkramBdVXg0PhzrGUNXzzc1rDarg=`，这个 fixture 不依赖真实 secret——换占位 secret 后同步更新 expected 签名值即可。
3. 若该 secret 仍在使用，建议在飞书后台重置。
4. git history 清理（`git filter-repo` 或接受历史已泄露、仅改当前版本）视情况而定。

---

### P1 — Bug：`check.ts` 的 `failRun` 硬编码 userId=1

**位置**：`packages/server/src/scheduler/check.ts:45-47`

```ts
function failRun(runId: number, errorType: RunErrorType, e: unknown): void {
  taskRunService.fail(1, runId, errorType, e instanceof Error ? e : new Error(String(e)));
  //                   ↑ 硬编码 1
}
```

**现象**：`runCheck` 第 51 行明明取了 `const userId = task.user_id`，但 `failRun` 闭包里没用，直接写死 `1`。

**影响**：
- 多用户场景下，`taskRunService.fail` 会用 `WHERE id = ? AND user_id = ?` 查不到记录（task_run 的 user_id 是 task.user_id，不是 1），**fail 写不进去**，run 永远停在 `running` 状态。
- 单用户 MVP 阶段（user_id 恒为 1）不会触发，但与「全表预留 user_id」的设计意图冲突。

**建议**：`failRun` 加 userId 参数，或把 `failRun` 改成闭包捕获 `userId`：
```ts
const failRun = (errorType: RunErrorType, e: unknown) =>
  taskRunService.fail(userId, runId, errorType, e instanceof Error ? e : new Error(String(e)));
```

---

### P1 — Bug：`duration_ms` 字段名与实际单位不符

**位置**：`packages/server/src/services/task-run.service.ts:91, 136`

```ts
const durationMs = Math.max(0, Math.round((Date.now() - started) / 1000));
//                                                            ↑ /1000 = 秒
...
SET ... duration_ms = ? ...
```

**现象**：字段叫 `duration_ms`（毫秒），但计算的是秒（`/ 1000`）。

**影响**：
- DATABASE.md 定义 `duration_ms INTEGER`，语义是毫秒。
- 前端 `InterestDetail.vue:370` 「将错就错」：`run.duration_ms + 's'` 把秒数加 `s` 后缀显示，但变量名仍叫 `duration_ms`，误导后来者。
- 未来如果有人信任字段名做 `ms / 1000` 换算，会得到毫秒级的错误数值。

**建议**：二选一（推荐前者）：
- **A**：改计算为 `Date.now() - started`（真存毫秒），前端去掉 `'s'` 后缀改成格式化（如 `(ms/1000).toFixed(1) + 's'`）。
- **B**：改字段名为 `duration_s`，同步改 init.sql、service、前端、DATABASE.md。

---

### P2 — 死代码：`db/client.ts` 的 `ensureColumn` 重复

**位置**：`packages/server/src/db/client.ts:15-26`

```ts
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('"update"', 'has_progress', 'has_progress INTEGER NOT NULL DEFAULT 0 ...');
```

**现象**：`init.sql:100` 已经定义了 `has_progress` 列。`ensureColumn` 运行时检查会发现列已存在，`ALTER TABLE` 永远不执行——**纯死代码**。

**推测**：开发过程中先在 client 里加了兜底，后来补进 init.sql，但忘了删 client 里的。

**影响**：违背「init.sql 是唯一真相」（DATABASE.md §7）的约定，未来新增字段会有人照葫芦画瓢往 client 里塞，schema 真相分裂。

**建议**：删除 `ensureColumn` 函数和调用，保持 `db.exec(readInitSql())` 为唯一的 schema 入口。

---

### P2 — 健壮性：`scheduler/index.ts` 未捕获 promise rejection

**位置**：`packages/server/src/scheduler/index.ts:66`

```ts
cron.schedule('* * * * *', () => {
  void runDueTasks();  // void 丢弃 promise，错误变 unhandledRejection
});
```

**影响**：`runDueTasks` 内部 `runCheck` 抛错（如 DB 异常）会变成 unhandled rejection，进程可能崩溃（取决于 Node 的 `--unhandled-rejections` 设置）。

**建议**：
```ts
cron.schedule('* * * * *', () => {
  runDueTasks().catch((e) => console.error('[scheduler] runDueTasks failed:', e));
});
```

---

### P2 — 健壮性：`updates.ts` query 参数未校验

**位置**：`packages/server/src/routes/updates.ts:8-11`（task-runs.ts 同样）

```ts
const interestId = c.req.query('interest_id') ? Number(c.req.query('interest_id')) : undefined;
```

**影响**：`?interest_id=abc` 会得到 `NaN`，传入 SQL `WHERE u.interest_id = ?` 行为未定义（SQLite 会当作 NULL 比较，查不出数据但不报错——静默失败）。

**建议**：用 zod 校验 query，或在 `Number()` 后检查 `Number.isFinite()`。MVP 阶段可接受，但应记下。

---

### P2 — 设计未闭环：`computeNextRun` 忽略时区

**位置**：`packages/server/src/lib/time.ts:5-14`

```ts
export function computeNextRun(frequency: string, time: string, from?: string): string {
  const base = from ? new Date(from + 'Z') : new Date();
  const [h, m] = time.split(':').map(Number);
  const next = new Date(base);
  next.setUTCHours(h, m, 0, 0);  // ← 用 UTC
  ...
}
```

**现象**：用户在 settings 里配 `timezone: 'Asia/Shanghai'`，前端填 `time: '09:00'` 表示"早上 9 点"。但 `computeNextRun` 直接 `setUTCHours(9, 0)`——把 9 点当 UTC（= 北京 17 点）。

**影响**：实际执行时间比用户预期晚 8 小时（东八区）。单用户 MVP 可接受，但与 settings.timezone 字段的存在矛盾——既然存了时区就该用。

**建议**：用 `Intl.DateTimeFormat` 或轻量时区库做本地时间→UTC 转换。MVP 可记为已知限制，文档里标注。

---

### P3 — 冗余代码

1. **`check.ts:87`**：`updates.map((u) => ({ ...u, importance: u.importance }))` 等于 `updates` 本身，`importance` 已在 `u` 里。删掉 map。
2. **`interest.service.ts:144-152`**：`toggle` 方法查了两次 task（`SELECT enabled` 和 `SELECT frequency, time`），合并成一次 `SELECT enabled, frequency, time`。

---

### P3 — 类型：`lib/http.ts` 用 `as any` 绕过 status 类型

**位置**：`packages/server/src/lib/http.ts:4, 8`

```ts
return c.json({ data }, status as any);
```

**建议**：`import type { StatusCode } from 'hono/utils/http-status'`，参数类型改 `status: StatusCode`。

---

### P3 — 未实现：`notify` 只支持 feishu

**位置**：`packages/server/src/notify/index.ts:58-68`

**现象**：zod schema 允许 `feishu | dingtalk | email`，但 `notify` 函数只有 feishu 分支，其他抛 `不支持的渠道类型`。前端 Settings.vue 三个渠道都能填能存，但「发送测试」对钉钉/邮件会 400。

**建议**：MVP 阶段可接受，但应：
- 在 `notify/index.ts` 顶部加 `// TODO: dingtalk, email` 注释。
- 或在 zod schema 里临时只允许 `feishu`，避免用户存了无法使用的配置。

---

### P3 — 一致性：`interest.service` 有 `archive` 但 route 未暴露

**位置**：`interest.service.ts:162-168`（archive 方法）vs `routes/interests.ts:41-45`（DELETE 物理删除）

**现象**：DATABASE.md 设计了软删除归档（`status='archived'`），service 也实现了 `archive`，但 route 的 `DELETE /:id` 调的是 `remove`（物理删除 + 级联）。前端 InterestDetail.vue 的删除按钮调 DELETE。

**影响**：设计与实现不一致。归档能力存在但用户用不到。

**建议**：MVP 阶段二选一：
- **A**：DELETE 改调 `archive`（保留数据，符合软删除设计）。
- **B**：暂时不需要归档，删掉 `archive` 方法，DATABASE.md 标注「status 字段预留，MVP 不用」。

---

## 2. 做得好的地方（不要改）

- **scheduler 并发防护双保险**：`running` Set 防同进程 + DB 层 `NOT EXISTS status='running'` 防跨进程 + stale 10 分钟恢复——设计周到（`scheduler/index.test.ts` 9 个用例全覆盖）。
- **check 闭环错误分级**：search 失败→failed、notify 失败→partial（updates 已写入）、成功→success，`task_run.status` 三态清晰，`check.test.ts` 4 个场景全覆盖。
- **`writeMany` 去重**：`ON CONFLICT(content_hash) DO NOTHING` + `result.changes > 0` 判断是否真插入，避免重复通知。
- **测试用 `MockLanguageModelV4` + `mockFetch`**：AI SDK 官方 mock 工具，不依赖网络，测试快（1.24s）。
- **配置分层**：env 走 `config.ts`，业务配置走 DB `settings` 表，符合 BACKEND_STRUCTURE.md。
- **`userId` 贯穿 service**：所有 service 方法第一参数 `userId`，与 DB 预留字段对齐（除 P1 的 `failRun` 漏网）。

---

## 3. 优先级处理建议

| 优先级 | 项 | 建议 |
|---|---|---|
| P0 | 测试硬编码凭证 | 立即改占位值，评估是否重置飞书 secret |
| P1 | `failRun` userId 硬编码 | 改闭包捕获，补一个 user_id≠1 的测试 |
| P1 | `duration_ms` 单位 | 选方案 A 或 B，统一字段名/计算/前端显示 |
| P2 | `ensureColumn` 死代码 | 直接删 |
| P2 | scheduler 未 catch | 加 `.catch()` |
| P2 | query 参数校验 | 加 zod 或 isFinite 检查 |
| P2 | 时区 | 记为已知限制或实现时区转换 |
| P3 | 冗余/类型/未实现/一致性 | 有空再清理，不影响 MVP |

---

## 4. 建议的下一步

1. **先修 P0 + P1**（凭证 + failRun + duration_ms），这三个影响安全和正确性。
2. **P2 按需修**，死代码和 scheduler catch 成本极低，顺手做。
3. **P3 进 backlog**，不阻塞 MVP 验证。
4. **补端到端冒烟测试**：当前单元/集成测试覆盖好，但缺一个「启动 server → 建兴趣 → 手动 trigger check → 看到 update」的 e2e。MVP 验证后可补。
