import { z } from 'zod';

/**
 * analyze 链路的共享契约：入参/出参形状、模型输出的 zod schema、schema → 领域对象的映射。
 * 这里只放类型与 schema，不碰 provider、prompt、网络调用。
 */

/** analyze() 需要的兴趣信息：只取提示词用得到的字段，避免耦合 interest.service 的完整行类型 */
export interface InterestBrief {
  name: string;
  query_keywords?: string | null;
  description?: string | null;
  /** 关注判据：监控主体。与 criteria 同时为空 → 按旧行为分析（无判据） */
  subject?: string | null;
  /** 关注判据：触发条件。命中才算「变化」 */
  criteria?: string | null;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** analyze() 的接入配置：模型 + 搜索各自的 settings 子集 */
export interface AnalyzeSettings {
  ai_base_url?: string | null;
  ai_api_key?: string | null;
  ai_model?: string | null;
  search_provider?: string | null;
  search_api_key?: string | null;
}

export interface AnalyzedSource {
  title: string;
  source_url: string;
  source_name: string;
  published_at: string;
  /** 为什么构成变化（对应触发条件的哪一点），用于通知正文 */
  why: string;
}

export interface AnalyzeResult {
  has_progress: boolean;
  title: string;
  summary: string;
  source: AnalyzedSource[];
  usage: LlmUsage;
  /** 本轮检索到的结果条数（搜索已内聚在 analyze 内，调用方不必自己再跑一遍） */
  searchResultCount: number;
}

/**
 * prompt 里「最多 N 条来源」的约定与调用后实际截断的上限共用同一个值，
 * 避免两边各写一个 8 之后悄悄漂移。
 */
export const MAX_ANALYZED_SOURCES = 8;

export const analyzedSourceSchema = z.object({
  title: z.string().describe('来源标题'),
  // 不校验 URL 格式：链接仅供展示，模型少写个协议头之类的格式小错不值得让整轮 run 失败。
  source_url: z.string().optional().describe('来源链接，取自本轮搜索结果'),
  source_name: z.string().optional().describe('来源名称，如「东方财富」'),
  published_at: z
    .string()
    .optional()
    .describe('信息原始发布时间，只能取自搜索结果的 published_date，未知时留空'),
  why: z
    .string()
    .optional()
    .describe('这条为什么构成变化：对应触发条件的哪一点，一句话；未配置触发条件时说明为何值得关注'),
});

/** 模型给出的原始来源：字段多为可选，且未经规整（不信任其链接与日期） */
export type RawAnalyzedSource = z.infer<typeof analyzedSourceSchema>;

export const analyzedOutputSchema = z.object({
  has_progress: z.boolean().describe('相比目前已知状态是否有实质进展（新变化/进展/重要动态），否则为 false'),
  title: z.string().describe('本轮更新的事件标题，简明扼要'),
  summary: z.string().describe('本轮执行情况的中文总结（检索内容与结论），1-3 句话，无进展时也必须填写'),
  source: z.array(analyzedSourceSchema).describe(`构成本轮进展的来源列表，最多 ${MAX_ANALYZED_SOURCES} 条`),
});

export type AnalyzedOutput = z.infer<typeof analyzedOutputSchema>;

/** 补齐模型省略的可选字段，产出可直接落库的形态 */
export function toAnalyzedSource(raw: RawAnalyzedSource): AnalyzedSource {
  return {
    title: raw.title,
    source_url: raw.source_url ?? '',
    source_name: raw.source_name ?? '',
    published_at: raw.published_at ?? '',
    why: raw.why ?? '',
  };
}
