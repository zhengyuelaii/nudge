import type { LanguageModel } from 'ai';
import { search, type SearchResult } from '../search/index.js';
import { callAnalyzeModel, createAnalyzeModel } from './model.js';
import { buildAnalyzePrompt } from './prompt.js';
import {
  MAX_ANALYZED_SOURCES,
  toAnalyzedSource,
  type AnalyzeResult,
  type AnalyzeSettings,
  type InterestBrief,
} from './types.js';

/**
 * analyze 的编排层：串起「检索 → 装配模型 → 构造 prompt → 调用模型 → 收敛输出」。
 * 搜索关键词由兴趣自身推导（`query_keywords || name`），调用方只需给一个兴趣，
 * 不必自己先跑一遍搜索再把结果递进来。
 */

/**
 * 检索这一步失败（网络 / 额度 / 供应商报错）。
 * 与模型失败分开成两种错误类型，调用方才能分别记 search_failed / llm_failed，
 * 否则线上只会看到一团「跑失败了」。
 */
export class AnalyzeSearchError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'AnalyzeSearchError';
  }
}

/** 检索零结果时的固定说明：模型没被调用过，token 记 0 */
const EMPTY_SEARCH_SUMMARY = '搜索未返回结果，已跳过 LLM 分析';

export interface AnalyzeOptions {
  model?: LanguageModel;
  fetchImpl?: typeof fetch;
}

export async function analyze(
  interest: InterestBrief,
  settings: AnalyzeSettings,
  opts: AnalyzeOptions = {},
  knownState?: string,
): Promise<AnalyzeResult> {
  // 先校验 key：缺 key 是必失败的情况，没必要为了发现它先花掉一次搜索调用
  const model = createAnalyzeModel(settings, opts.model);

  let results: SearchResult[];
  try {
    results = await search(interest, settings, { fetchImpl: opts.fetchImpl });
  } catch (e) {
    throw new AnalyzeSearchError(e);
  }

  // 零结果直接短路：没有任何检索结果时模型只能返回空，省掉一次纯浪费的调用
  if (results.length === 0) {
    return {
      has_progress: false,
      title: '',
      summary: EMPTY_SEARCH_SUMMARY,
      source: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      searchResultCount: 0,
    };
  }

  const prompt = buildAnalyzePrompt({ interest, results, knownState });
  const { output, usage } = await callAnalyzeModel(model, prompt);

  // 模型偶尔会超量返回，按 prompt 里约定的上限截断
  const source = output.source.slice(0, MAX_ANALYZED_SOURCES).map(toAnalyzedSource);

  return {
    has_progress: output.has_progress,
    title: output.title,
    summary: output.summary,
    source,
    usage,
    searchResultCount: results.length,
  };
}

// —— 公共入口：调用方（scheduler/check.ts 等）继续从本模块导入，内部实现已按职责下沉 ——
export { AnalyzeOutputError } from './model.js';
export { analyzedSourceSchema } from './types.js';
export type {
  AnalyzedSource,
  AnalyzeResult,
  AnalyzeSettings,
  InterestBrief,
  LlmUsage,
} from './types.js';
