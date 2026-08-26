import type { LanguageModel } from 'ai';
import { interestService } from '../services/interest.service.js';
import { settingsService } from '../services/settings.service.js';
import { taskRunService, type RunErrorType } from '../services/task-run.service.js';
import { eventService } from '../services/event.service.js';
import { sourceService } from '../services/source.service.js';
import { search, type SearchResult } from '../ai/search.js';
import { analyze } from '../ai/llm.js';
import { notify, type Mailer } from '../notify/index.js';

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

function buildNotifyText(interest: { name: string }, sources: Array<{ title: string; source_url?: string | null }>): string {
  const lines = sources.map(
    (s) =>
      `${s.title}${
        s.source_url ? `\n${s.source_url}` : ''
      }`,
  );
  return `🔔「${interest.name}」有 ${sources.length} 条重要变化\n\n${lines.join('\n\n')}`;
}

function failRun(
  userId: number,
  runId: number,
  errorType: RunErrorType,
  e: unknown,
): void {
  taskRunService.fail(userId, runId, errorType, e instanceof Error ? e : new Error(String(e)));
}

export async function runCheck(taskId: number, opts: CheckOptions = {}): Promise<CheckResult> {
  const task = interestService.getTask(taskId);
  const userId = task.user_id;
  const interest = interestService.get(userId, task.interest_id);
  const settings = settingsService.get(userId);
  const runId = taskRunService.start(userId, task.id, interest.id, settings.run_mode);

  let results: SearchResult[];
  try {
    results = await search(interest, settings, { fetchImpl: opts.fetchImpl });
  } catch (e) {
    failRun(userId, runId, 'search_failed', e);
    return { runId, searchResultCount: 0, createdCount: 0, notifiedCount: 0 };
  }

  const knownState = buildKnownState(
    eventService.listRecent(userId, interest.id, { limit: 3, sourcesPerEvent: 3 }),
  );

  let analyzed: Awaited<ReturnType<typeof analyze>>;
  try {
    analyzed = await analyze(
      interest,
      results,
      settings,
      { model: opts.model },
      knownState,
    );
  } catch (e) {
    failRun(userId, runId, 'llm_failed', e);
    return { runId, searchResultCount: results.length, createdCount: 0, notifiedCount: 0 };
  }

  // 模型输出单条聚合结果；has_progress=false 说明相对历史无实质进展，来源再做重要度兜底过滤
  const llmSources = analyzed.has_progress
    ? analyzed.source.filter((s) => s.importance >= MIN_IMPORTANCE)
    : [];

  if (llmSources.length === 0) {
    taskRunService.succeed(userId, runId, {
      searchResultCount: results.length,
      sourcesCreated: 0,
      llmInputTokens: analyzed.usage.inputTokens,
      llmOutputTokens: analyzed.usage.outputTokens,
    });
    return { runId, searchResultCount: results.length, createdCount: 0, notifiedCount: 0 };
  }

  const event = eventService.create(userId, {
    interestId: interest.id,
    taskRunId: runId,
    title: analyzed.title || llmSources[0].title,
    runAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    summary: analyzed.summary || null,
  });

  const createdSources = sourceService.createMany(userId, interest.id, event.id, llmSources.map((s) => ({
    title: s.title,
    sourceUrl: s.source_url || undefined,
    sourceName: s.source_name || undefined,
    publishedAt: s.published_at || undefined,
  })));

  eventService.updateSourceCount(userId, event.id, createdSources.length);

  const toNotify = createdSources.map((s) => ({ title: s.title, source_url: s.source_url }));
  let notifiedCount = 0;

  if (toNotify.length > 0) {
    const channels = interestService.getNotifyChannels(userId, interest.id);
    const notifyErrors: { name: string; error: Error }[] = [];
    for (const channel of channels) {
      try {
        await notify(channel, buildNotifyText(interest, toNotify), {
          fetchImpl: opts.fetchImpl,
          mailer: opts.mailer,
          meta: { userId, interestId: interest.id, eventId: event.id, title: event.title },
        });
        notifiedCount += toNotify.length;
      } catch (e) {
        notifyErrors.push({ name: channel.name, error: e instanceof Error ? e : new Error(String(e)) });
      }
    }
    if (notifyErrors.length > 0) {
      taskRunService.fail(
        userId,
        runId,
        'notify_failed',
        new Error(`通知失败渠道: ${notifyErrors.map((f) => f.name).join(', ')}`),
        {
          llmInputTokens: analyzed.usage.inputTokens,
          llmOutputTokens: analyzed.usage.outputTokens,
          sourcesCreated: createdSources.length,
        },
      );
      return { runId, searchResultCount: results.length, createdCount: createdSources.length, notifiedCount };
    }
  }

  taskRunService.succeed(userId, runId, {
    searchResultCount: results.length,
    sourcesCreated: createdSources.length,
    llmInputTokens: analyzed.usage.inputTokens,
    llmOutputTokens: analyzed.usage.outputTokens,
  });

  return {
    runId,
    searchResultCount: results.length,
    createdCount: createdSources.length,
    notifiedCount,
  };
}
