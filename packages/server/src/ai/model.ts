import { generateText, Output, NoObjectGeneratedError, type LanguageModel } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { Errors } from '../lib/errors.js';
import {
  analyzedOutputSchema,
  type AnalyzedOutput,
  type AnalyzeSettings,
  type LlmUsage,
} from './types.js';

/**
 * 模型层：装配 provider、封装一次结构化输出调用、把 SDK 异常翻译成本模块的错误类型。
 * 这里之外的地方不该直接碰 ai / @ai-sdk 的 API。
 */

/** 抽取类任务用低温度；输出上限兜住模型跑飞时的成本 */
const LLM_TEMPERATURE = 0.3;
const LLM_MAX_OUTPUT_TOKENS = 2000;

/** 单次调用超时 + 重试上限：不能让一个卡住的请求拖住整轮 run，也不能无限重试烧钱 */
const LLM_TIMEOUT_MS = 60_000;
const LLM_MAX_RETRIES = 2;

/**
 * 模型输出无法解析为预期结构。
 * 与「确实没有进展」（has_progress=false）是两回事：调用方应记 llm_failed 而不是 success，
 * 否则线上只会看到一堆「成功但什么都没发生」的记录。携带 usage —— 失败但 token 已经花了。
 */
export class AnalyzeOutputError extends Error {
  constructor(
    message: string,
    readonly usage: LlmUsage,
    readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'AnalyzeOutputError';
  }
}

/**
 * `Output.object` 的校验失败会抛 `NoObjectGeneratedError`（带 usage 与原始文本），
 * 统一包装成本模块的 `AnalyzeOutputError`，调用方只需认一个错误类型。
 */
function toAnalyzeError(e: unknown): unknown {
  if (!NoObjectGeneratedError.isInstance(e)) return e;
  return new AnalyzeOutputError(
    `LLM 输出结构不符合预期：${e.message}`,
    {
      inputTokens: e.usage?.inputTokens ?? 0,
      outputTokens: e.usage?.outputTokens ?? 0,
    },
    (e.text ?? '').slice(0, 500),
  );
}

/**
 * 装配模型。`override` 供测试注入；注意即便注入了模型，仍然要求 key 已配置
 * （保持与旧实现一致的失败语义：缺 key 一律先失败，不因注入了假模型而静默放过）。
 */
export function createAnalyzeModel(
  settings: AnalyzeSettings,
  override?: LanguageModel,
): LanguageModel {
  if (!settings.ai_api_key) {
    throw Errors.internal('未配置 AI API Key');
  }
  if (override) return override;

  return createDeepSeek({
    baseURL: settings.ai_base_url ?? 'https://api.deepseek.com',
    apiKey: settings.ai_api_key,
  }).chat(settings.ai_model ?? 'deepseek-chat');
}

/**
 * 调用一次模型并取回结构化输出。
 * Output.object 把 schema 交给 provider 做约束解码（DeepSeek 映射为 response_format: json_schema strict），
 * 并由 SDK 在运行时按 schema 校验；不匹配时抛 NoObjectGeneratedError 而非悄悄返回坏数据，
 * 所以这里不需要手写 safeParse 兜底。
 */
export async function callAnalyzeModel(
  model: LanguageModel,
  prompt: string,
): Promise<{ output: AnalyzedOutput; usage: LlmUsage }> {
  let result;
  try {
    result = await generateText({
      model,
      output: Output.object({
        schema: analyzedOutputSchema,
        name: 'AnalyzedUpdates',
        description: '筛选出的重要变化列表（对象）',
      }),
      temperature: LLM_TEMPERATURE,
      maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
      maxRetries: LLM_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      prompt,
    });
  } catch (e) {
    throw toAnalyzeError(e);
  }

  const usage: LlmUsage = {
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };

  // 被 maxOutputTokens 截断的输出结构必然不完整，明确报出来，别让"半个 JSON"混过去
  if (result.finishReason === 'length') {
    throw new AnalyzeOutputError(
      `LLM 输出在 ${LLM_MAX_OUTPUT_TOKENS} tokens 处被截断，结构不完整`,
      usage,
      '',
    );
  }

  return { output: result.output, usage };
}
