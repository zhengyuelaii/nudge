import { beforeEach, describe, expect, it } from 'vitest';
import { createAnalyzeModel } from '../ai/model.js';
import { db } from '../db/client.js';
import { runCheck } from '../scheduler/check.js';
import type { SearchResult } from '../search/types.js';
import { channelService } from '../services/channel.service.js';
import { interestService } from '../services/interest.service.js';
import { settingsService } from '../services/settings.service.js';
import { scoreRun } from './scorer.js';

/**
 * 核心业务流程 E2E：**真的**生成一个兴趣 → 真的走一遍「检索 → 分析 → 判定 → 落库 → 通知 → 记账」
 * → 对整条链路的产物打分。
 *
 * 与其它测试的区别：不打桩。检索走真 Tavily、分析走真 DeepSeek，只有飞书被拦截
 * （E2E 不该往群里发消息），但通知链路本身照跑、notify_log 照落。
 *
 * 没有凭据（CI / 干净环境）时整个套件跳过。跑法：
 *   pnpm --filter @nudge/server test:e2e
 */

const HAS_CREDENTIALS = Boolean(process.env.AI_API_KEY && process.env.TAVILY_API_KEY);

/**
 * 被测的兴趣 —— 判据刻意写成「可证伪的具体事件」：
 * 金价日常小幅波动、机构观点、板块综述都属于不该推的噪音，正好用来检验噪音过滤。
 */
const INTEREST_DRAFT = {
  name: '国际金价异动',
  tags: ['commodity'],
  description: '关注国际金价的重大波动；日常小幅波动、机构观点、板块综述不需要提醒。',
  queryKeywords: '国际金价 黄金价格 走势',
  subject: '国际金价',
  criteria: '单日涨跌幅超过 2%，或价格创下历史新高 / 跌破重要整数关口',
  frequency: 'day' as const,
  time: '09:00',
};

interface E2ERecorder {
  /** 本轮 Tavily 真实返回的全部结果 —— 评分的参照系 */
  tavilyResults: SearchResult[];
  /** 被拦截的飞书请求体，用于确认通知链路确实走到了发送 */
  feishuPayloads: unknown[];
}

/**
 * 分流 fetch：只放行「检索 / 模型」，拦下飞书。
 *
 * 拦飞书是为了不打扰人，但**不绕过 notify 逻辑** —— notify() 仍会正常构造正文并落 notify_log，
 * 所以推送内容照样可被评分。放行检索的同时把响应缓存下来，评分才有本事判断来源是否编造。
 */
function makeE2EFetch(recorder: E2ERecorder): typeof fetch {
  const realFetch = globalThis.fetch;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('feishu')) {
      recorder.feishuPayloads.push(init?.body ? JSON.parse(String(init.body)) : {});
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const res = await realFetch(input as RequestInfo, init);

    if (url.includes('tavily.com')) {
      // clone 后再读：原响应要原样交还给调用方
      const body = (await res.clone().json()) as { results?: SearchResult[] };
      recorder.tavilyResults.push(...(body.results ?? []));
    }

    return res;
  }) as typeof fetch;
}

describe.skipIf(!HAS_CREDENTIALS)('E2E 核心业务流程（真实 Tavily + 真实 DeepSeek）', () => {
  beforeEach(() => {
    db.exec(
      `DELETE FROM notify_log; DELETE FROM source; DELETE FROM interest_event;
       DELETE FROM task_run; DELETE FROM notification_channel; DELETE FROM task; DELETE FROM interest;`,
    );

    // 真实凭据从 .env 注入（vitest.setup.ts 已 loadEnvFile）
    db.prepare(
      `UPDATE settings
         SET ai_api_key = ?, search_api_key = ?, ai_model = ?, search_provider = 'tavily', run_mode = 'default'
       WHERE user_id = 1`,
    ).run(
      process.env.AI_API_KEY,
      process.env.TAVILY_API_KEY,
      process.env.E2E_AI_MODEL ?? 'deepseek-chat',
    );
  });

  it(
    '生成兴趣 → 跑完整一轮 → 对产物评分',
    async () => {
      // ── 1. 生成兴趣（走真实服务入口，连带建好 task） ──
      const interest = interestService.create(1, INTEREST_DRAFT);

      // ── 2. 挂一个飞书渠道（E2E 中会被拦截，但通知链路真实执行） ──
      channelService.create(1, {
        type: 'feishu',
        name: '飞书（E2E 拦截）',
        config: {
          webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/e2e-intercepted',
          secret: '',
        },
        enabled: true,
        isDefault: true,
      });

      // ── 3. 跑完整一轮 ──
      const recorder: E2ERecorder = { tavilyResults: [], feishuPayloads: [] };
      const result = await runCheck(interest.task_id, { fetchImpl: makeE2EFetch(recorder) });

      // ── 4. 收集产物 ──
      const run = db.prepare('SELECT * FROM task_run WHERE id = ?').get(result.runId) as {
        status: string;
        summary: string | null;
        error_type: string | null;
        error_message: string | null;
        search_result_count: number | null;
        llm_input_tokens: number | null;
        llm_output_tokens: number | null;
      };

      const event = db
        .prepare('SELECT * FROM interest_event WHERE task_run_id = ?')
        .get(result.runId) as { id: number; title: string } | undefined;

      const sources = event
        ? (db
            .prepare('SELECT * FROM source WHERE event_id = ? ORDER BY id')
            .all(event.id) as Array<{
            title: string;
            source_url: string | null;
            source_name: string | null;
            published_at: string | null;
          }>)
        : [];

      // 本轮只有一次通知（单渠道），取最近一条即可；未推送时为空
      const notifyLog = db
        .prepare('SELECT * FROM notify_log ORDER BY id DESC LIMIT 1')
        .get() as { content: string; status: string } | undefined;

      // ── 5. 评分（用同一份检索原料做参照，独立模型当评审员） ──
      const report = await scoreRun({
        interest: {
          name: interest.name,
          subject: interest.subject,
          criteria: interest.criteria,
        },
        searchResults: recorder.tavilyResults,
        run,
        sources,
        eventTitle: event?.title ?? null,
        notifyText: notifyLog?.content ?? null,
        judgeModel: createAnalyzeModel(settingsService.get(1)),
      });

      for (const line of report.lines) console.log(line);

      // ── 6. 断言：链路必须跑通，来源必须可回溯，总分不能塌 ──
      expect(run.status).toBe('success');
      expect(recorder.tavilyResults.length).toBeGreaterThan(0);

      // 通知链路确实走到了发送（被拦截也算走到）
      if (sources.length > 0) {
        expect(recorder.feishuPayloads.length).toBeGreaterThan(0);
        expect(notifyLog?.status).toBe('success');
      }

      // 硬性质量底线：落库的每条来源都必须对得回本轮检索结果（编造链接 = E2E 失败）
      const evidence = report.dimensions.find((d) => d.label === '证据可信');
      expect(evidence?.score).toBe(evidence?.max);

      // 总分为软阈值：判定质量本身有波动，只要求不塌到不合格区间
      expect(report.percent).toBeGreaterThanOrEqual(60);
    },
    240_000,
  );
});
