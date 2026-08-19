import type { LanguageModel } from 'ai';
import { interestService } from '../services/interest.service.js';
import { settingsService } from '../services/settings.service.js';
import { taskRunService, type RunErrorType } from '../services/task-run.service.js';
import { updateService, type UpdateRow } from '../services/update.service.js';
import { channelService } from '../services/channel.service.js';
import { search, type SearchResult } from '../ai/search.js';
import { analyze } from '../ai/llm.js';
import { notify } from '../notify/index.js';

export interface CheckResult {
  runId: number;
  searchResultCount: number;
  createdCount: number;
  notifiedCount: number;
}

export interface CheckOptions {
  fetchImpl?: typeof fetch;
  model?: LanguageModel;
}

const KNOWN_STATE_LIMIT = 5;

function buildKnownState(updates: UpdateRow[]): string {
  if (updates.length === 0) return '';
  return updates
    .map(
      (u) =>
        `- ${u.title}（重要度 ${u.importance}${u.has_progress ? '，已确认有进展' : ''}）`,
    )
    .join('\n');
}

function buildNotifyText(interest: { name: string }, updates: UpdateRow[]): string {
  const lines = updates.map(
    (u) =>
      `【${u.importance}/10】${u.title}${
        u.source_url ? `\n${u.source_url}` : ''
      }`,
  );
  return `🔔「${interest.name}」有 ${updates.length} 条重要变化\n\n${lines.join('\n\n')}`;
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
  const runId = taskRunService.start(userId, task.id, interest.id);

  let results: SearchResult[];
  try {
    results = await search(interest, settings, { fetchImpl: opts.fetchImpl });
  } catch (e) {
    failRun(userId, runId, 'search_failed', e);
    return { runId, searchResultCount: 0, createdCount: 0, notifiedCount: 0 };
  }

  let analyzed: Awaited<ReturnType<typeof analyze>>;
  try {
    const recent = updateService.list(userId, {
      interestId: interest.id,
      limit: KNOWN_STATE_LIMIT,
    });
    analyzed = await analyze(
      interest,
      results,
      settings,
      { model: opts.model },
      buildKnownState(recent),
    );
  } catch (e) {
    failRun(userId, runId, 'llm_failed', e);
    return { runId, searchResultCount: results.length, createdCount: 0, notifiedCount: 0 };
  }

  const updates = analyzed.updates;
  const created = updateService.writeMany(
    userId,
    interest.id,
    runId,
    updates,
  );

  const toNotify = created.filter((u) => u.importance >= settings.notify_threshold);
  let notifiedCount = 0;

  if (toNotify.length > 0) {
    const channel = channelService.getDefault(userId);
    if (channel) {
      try {
        await notify(channel, buildNotifyText(interest, toNotify), {
          fetchImpl: opts.fetchImpl,
        });
        updateService.markNotified(
          userId,
          toNotify.map((u) => u.id),
        );
        notifiedCount = toNotify.length;
      } catch (e) {
        taskRunService.partial(userId, runId, 'notify_failed', e instanceof Error ? e : new Error(String(e)), analyzed.usage);
        return {
          runId,
          searchResultCount: results.length,
          createdCount: created.length,
          notifiedCount: 0,
        };
      }
    }
  }

  taskRunService.succeed(userId, runId, {
    searchQuery: interest.query_keywords ?? interest.name,
    searchResultCount: results.length,
    llmInputTokens: analyzed.usage.inputTokens,
    llmOutputTokens: analyzed.usage.outputTokens,
  });

  return {
    runId,
    searchResultCount: results.length,
    createdCount: created.length,
    notifiedCount,
  };
}