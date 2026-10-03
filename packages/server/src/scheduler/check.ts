import type { LanguageModel } from 'ai';
import { interestService } from '../services/interest.service.js';
import { settingsService } from '../services/settings.service.js';
import { taskRunService, type RunErrorType } from '../services/task-run.service.js';
import { eventService } from '../services/event.service.js';
import { sourceService } from '../services/source.service.js';
import { analyze, AnalyzeOutputError, AnalyzeSearchError } from '../ai/llm.js';
import { notifyEvent } from '../notify/dispatch.js';
import type { Mailer } from '../notify/index.js';

export interface CheckResult {
  runId: number;
  searchResultCount: number;
  createdCount: number;
  notifiedCount: number;
}

export interface CheckOptions {
  fetchImpl?: typeof fetch;
  model?: LanguageModel;
  mailer?: Mailer;
}

// 低于该重要度的变化不建事件、不通知（1-3 无关 / 4-6 一般 / 7-8 重要 / 9-10 重大）
const MIN_IMPORTANCE = 5;

type AnalyzeOutcome = Awaited<ReturnType<typeof analyze>>;

function buildKnownState(events: Awaited<ReturnType<typeof eventService.listRecent>>): string {
  if (events.length === 0) return '';
  return events
    .map((ev) => {
      const head = `· ${ev.run_at.slice(0, 10)}「${ev.title}」${
        ev.summary ? `：${ev.summary}` : ''
      }${ev.sources.length ? `（${ev.sources.length}条来源）` : ''}`;
      const lines = ev.sources.map(
        (s) => `    - ${s.title}${s.summary ? `：${s.summary}` : ''}${
          s.source_url ? ` (${s.source_url})` : ''
        }`,
      );
      return [head, ...lines].join('\n');
    })
    .join('\n');
}

/** 解析失败时 token 也已经花掉了，失败记录里要能看到成本 */
function llmFailureStats(e: unknown): { llmInputTokens?: number; llmOutputTokens?: number } {
  if (e instanceof AnalyzeOutputError) {
    return { llmInputTokens: e.usage.inputTokens, llmOutputTokens: e.usage.outputTokens };
  }
  return {};
}

function failRun(
  userId: number,
  runId: number,
  errorType: RunErrorType,
  e: unknown,
  stats: { llmInputTokens?: number; llmOutputTokens?: number; sourcesCreated?: number } = {},
): void {
  taskRunService.fail(
    userId,
    runId,
    errorType,
    e instanceof Error ? e : new Error(String(e)),
    stats,
  );
}

/** 成功记账：把本轮的检索/LLM 成本与产出落到 task_run */
function succeedRun(userId: number, runId: number, analyzed: AnalyzeOutcome, sourcesCreated: number): void {
  taskRunService.succeed(userId, runId, {
    searchResultCount: analyzed.searchResultCount,
    sourcesCreated,
    llmInputTokens: analyzed.usage.inputTokens,
    llmOutputTokens: analyzed.usage.outputTokens,
    summary: analyzed.summary || undefined,
  });
}

/**
 * 固定流水线：准备 → analyze（内含检索）→ 过滤 → 落库 → 通知 → 记账。
 *
 * 这里只做编排与记账；检索/分析细节在 ai/，渠道分发细节在 notify/dispatch.ts。
 */
export async function runCheck(taskId: number, opts: CheckOptions = {}): Promise<CheckResult> {
  // ── 准备 ──────────────────────────────────────────────
  const task = interestService.getTask(taskId);
  const userId = task.user_id;
  const interest = interestService.get(userId, task.interest_id);
  const settings = settingsService.get(userId);
  const runId = taskRunService.start(userId, task.id, interest.id, settings.run_mode);

  // 预检：AI key 缺失是必失败的情况，没必要交给 analyze 先花掉一次搜索调用才发现
  if (!settings.ai_api_key) {
    failRun(userId, runId, 'llm_failed', new Error('未配置 AI API Key'));
    return { runId, searchResultCount: 0, createdCount: 0, notifiedCount: 0 };
  }

  // ── 分析（检索 + 模型调用都在 analyze 内部）─────────────
  const knownState = buildKnownState(
    eventService.listRecent(userId, interest.id, { limit: 3, sourcesPerEvent: 3 }),
  );

  let analyzed: AnalyzeOutcome;
  try {
    analyzed = await analyze(
      interest,
      settings,
      { model: opts.model, fetchImpl: opts.fetchImpl },
      knownState,
    );
  } catch (e) {
    const errorType: RunErrorType = e instanceof AnalyzeSearchError ? 'search_failed' : 'llm_failed';
    failRun(userId, runId, errorType, e, llmFailureStats(e));
    return { runId, searchResultCount: 0, createdCount: 0, notifiedCount: 0 };
  }

  // ── 过滤：has_progress=false 视为相对历史无实质进展，来源再做重要度兜底 ──
  const llmSources = analyzed.has_progress
    ? analyzed.source.filter((s) => s.importance >= MIN_IMPORTANCE)
    : [];

  if (llmSources.length === 0) {
    succeedRun(userId, runId, analyzed, 0);
    return { runId, searchResultCount: analyzed.searchResultCount, createdCount: 0, notifiedCount: 0 };
  }

  // ── 落库：事件 + 来源 ─────────────────────────────────
  const event = eventService.create(userId, {
    interestId: interest.id,
    taskRunId: runId,
    title: analyzed.title || llmSources[0].title,
    runAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    summary: analyzed.summary || undefined,
  });

  const createdSources = sourceService.createMany(userId, interest.id, event.id, llmSources.map((s) => ({
    title: s.title,
    sourceUrl: s.source_url || undefined,
    sourceName: s.source_name || undefined,
    publishedAt: s.published_at || undefined,
  })));

  eventService.updateSourceCount(userId, event.id, createdSources.length);

  // ── 通知：渠道分发交给 notify/dispatch，这里只处理结果 ──
  const { notifiedCount, failures } = await notifyEvent(
    {
      userId,
      interest,
      event,
      sources: createdSources.map((s) => ({ title: s.title, sourceUrl: s.source_url })),
    },
    { fetchImpl: opts.fetchImpl, mailer: opts.mailer },
  );

  // ── 记账 ─────────────────────────────────────────────
  if (failures.length > 0) {
    failRun(
      userId,
      runId,
      'notify_failed',
      new Error(`通知失败渠道: ${failures.map((f) => f.channelName).join(', ')}`),
      {
        llmInputTokens: analyzed.usage.inputTokens,
        llmOutputTokens: analyzed.usage.outputTokens,
        sourcesCreated: createdSources.length,
      },
    );
    return {
      runId,
      searchResultCount: analyzed.searchResultCount,
      createdCount: createdSources.length,
      notifiedCount,
    };
  }

  succeedRun(userId, runId, analyzed, createdSources.length);
  return {
    runId,
    searchResultCount: analyzed.searchResultCount,
    createdCount: createdSources.length,
    notifiedCount,
  };
}
