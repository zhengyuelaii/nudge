import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { interestService } from '../services/interest.service.js';
import { settingsService } from '../services/settings.service.js';
import { taskRunService, type RunErrorType } from '../services/task-run.service.js';
import { sourceService } from '../services/source.service.js';
import { buildSystem, buildUserPrompt } from './prompt.js';
import { createTrace } from './trace.js';
import { buildTools } from './tools.js';
import type { Mailer } from '../notify/index.js';

export interface AgentCheckResult {
  runId: number;
  stepCount: number;
  savedCount: number;
  notifiedCount: number;
}

export interface AgentCheckOptions {
  fetchImpl?: typeof fetch;
  model?: LanguageModel;
  mailer?: Mailer;
}

function failRun(
  userId: number,
  runId: number,
  errorType: RunErrorType,
  e: unknown,
): void {
  taskRunService.fail(userId, runId, errorType, e instanceof Error ? e : new Error(String(e)));
}

/** settings.extra 容错解析：非法 JSON 或非对象一律当空配置，不因配置脏数据整轮失败 */
function parseExtra(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runAgentCheck(
  taskId: number,
  opts: AgentCheckOptions = {},
): Promise<AgentCheckResult> {
  const task = interestService.getTask(taskId);
  const userId = task.user_id;
  const interest = interestService.get(userId, task.interest_id);
  const settings = settingsService.get(userId);
  const runId = taskRunService.start(userId, task.id, interest.id, settings.run_mode);

  const extra = parseExtra(settings.extra);
  const traceEnabled = extra.agent_trace_enabled === true;
  const trace = createTrace({ enabled: traceEnabled });

  const runStats = { notifiedCount: 0, searchResultCount: 0 };

  const tools = buildTools({
    userId,
    interest,
    settings: settings as unknown as Record<string, unknown>,
    runId,
    trace,
    runStats,
    fetchImpl: opts.fetchImpl,
    mailer: opts.mailer,
  }) as unknown as ToolSet;

  const model =
    opts.model ??
    createDeepSeek({
      baseURL: settings.ai_base_url ?? 'https://api.deepseek.com',
      apiKey: settings.ai_api_key ?? '',
    }).chat(settings.ai_model ?? 'deepseek-chat');

  let result: Awaited<ReturnType<typeof generateText<ToolSet>>> | undefined;
  try {
    result = await generateText({
      model,
      system: buildSystem(interest),
      prompt: buildUserPrompt(interest),
      tools,
      stopWhen: stepCountIs(8),
    });
  } catch (e) {
    failRun(userId, runId, 'llm_failed', e);
    return { runId, stepCount: 0, savedCount: 0, notifiedCount: 0 };
  }

  const steps = result.steps as unknown as Array<{ toolCalls?: Array<{ toolName: string; args: unknown }>; toolResults?: Array<{ toolName: string; result: unknown }>; text?: string }>;
  trace.mergeSteps(steps);

  // 记账取本轮增量：source 经 event.task_run_id 关联本次 run，避免把历史累计当本轮产出
  const savedCount = sourceService.countByRun(userId, runId);
  const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };

  taskRunService.succeed(userId, runId, {
    searchResultCount: runStats.searchResultCount,
    sourcesCreated: savedCount,
    llmInputTokens: usage.inputTokens,
    llmOutputTokens: usage.outputTokens,
    agentSteps: steps.length,
    ...(traceEnabled ? { trace: trace.toJSON(), traceText: trace.render() } : {}),
  });

  if (traceEnabled) {
    const rendered = trace.render();
    if (rendered) {
      console.log(`[agent] task=${taskId} interest="${interest.name}" steps=${steps.length}\n${rendered}`);
    }
  }

  return {
    runId,
    stepCount: steps.length,
    savedCount,
    notifiedCount: runStats.notifiedCount,
  };
}
