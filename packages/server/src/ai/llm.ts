import { generateText, Output, type LanguageModel } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import type { SearchResult } from './search.js';

export interface AnalyzedUpdate {
  title: string;
  summary: string;
  source_url: string;
  source_name: string;
  published_at: string;
  importance: number;
  has_progress: boolean;
}

export const analyzedUpdateSchema = z.object({
  title: z.string().describe('变化的标题，简明扼要'),
  summary: z
    .string()
    .optional()
    .describe('变化的中文摘要，1-3 句话（可用 description 代替）'),
  description: z.string().optional().describe('摘要的别名，与 summary 等价'),
  source_url: z.string().url().optional().describe('来源链接'),
  source_name: z.string().optional().describe('来源名称，如「东方财富」'),
  published_at: z.string().optional().describe('信息原始发布时间，ISO 8601'),
  importance: z
    .number()
    .optional()
    .describe('重要度 1-10：1-3 无关 / 4-6 一般 / 7-8 重要 / 9-10 重大'),
  has_progress: z
    .boolean()
    .optional()
    .describe('相比目前已知状态是否有实质进展（新变化/进展/重要动态），否则为 false'),
});

function toAnalyzedUpdate(raw: z.infer<typeof analyzedUpdateSchema>): AnalyzedUpdate {
  return {
    title: raw.title,
    summary: raw.summary ?? raw.description ?? '',
    source_url: raw.source_url ?? '',
    source_name: raw.source_name ?? '',
    published_at: raw.published_at ?? '',
    importance: raw.importance ?? 5,
    has_progress: raw.has_progress ?? false,
  };
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AnalyzeSettings {
  ai_base_url?: string | null;
  ai_api_key?: string | null;
  ai_model?: string | null;
}

export interface AnalyzeOptions {
  model?: LanguageModel;
}

const outputSchema = z.object({
  elements: z.array(analyzedUpdateSchema),
});

export interface AnalyzeResult {
  updates: AnalyzedUpdate[];
  usage: LlmUsage;
}

export async function analyze(
  interest: { name: string; query_keywords?: string | null; description?: string | null },
  results: SearchResult[],
  settings: AnalyzeSettings,
  opts: AnalyzeOptions = {},
  knownState?: string,
): Promise<AnalyzeResult> {
  if (!settings.ai_api_key) {
    throw Errors.internal('未配置 AI API Key');
  }

  const model =
    opts.model ??
    createDeepSeek({
      baseURL: settings.ai_base_url ?? 'https://api.deepseek.com',
      apiKey: settings.ai_api_key,
    }).chat(settings.ai_model ?? 'deepseek-chat');

  const context = interest.description ? `背景说明：${interest.description}\n\n` : '';
  const knownStateBlock = knownState
    ? `目前已知状态（此前的更新记录，用于判断是否构成进展）：\n${knownState}\n\n`
    : '';

  const prompt = `你是「Nudge」兴趣追踪系统。请分析下面针对「${interest.name}」的最新搜索结果，筛选出真正重要的变化，并输出结构化结果。

${context}${knownStateBlock}每个搜索结果格式：
- title: 标题
- url: 链接
- content: 摘要内容

搜索结果：
${results
    .map(
      (r, i) =>
        `${i + 1}. title: ${r.title}\nurl: ${r.url}\ncontent: ${r.content}`,
    )
    .join('\n\n')}

输出规则：
1. importance 为目标估值 1-10：重大(9-10)/重要(7-8)/一般(4-6)/无关(1-3)
2. source_url 和 source_name 必须从上方搜索结果中提取，不许编造
3. has_progress=true 表示相比目前已知状态有实质进展（新变化/新进展），false 表示只是已知信息的重复或无关内容
4. 忽略无关、过时、重复信息；若没有重要变化，返回 {"elements": []}

必须输出一个 JSON 对象，格式为 {"elements": [{"title": "标题", "summary": "1-3句摘要", "source_url": "https://...", "source_name": "来源名", "published_at": "2026-08-18", "importance": 8, "has_progress": true}]}，不要输出其它内容。`;

  const result = await generateText({
    model,
    output: Output.json({
      name: 'AnalyzedUpdates',
      description: '筛选出的重要变化列表（对象）',
    }),
    prompt,
  });

  const usage = {
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };

  const parsed = outputSchema.safeParse(result.output ?? {});
  return {
    updates: parsed.success
      ? parsed.data.elements.map(toAnalyzedUpdate)
      : [],
    usage,
  };
}
