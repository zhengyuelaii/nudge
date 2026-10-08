import type { SearchResult } from '../search/index.js';
import { MAX_ANALYZED_SOURCES, type InterestBrief } from './types.js';

/**
 * prompt 构造：把兴趣 + 检索结果 + 历史状态拼成一次性提示词。
 * 纯函数，不发请求、不解析输出，便于单独断言喂给模型的文本。
 */

/** 单条检索内容拼进 prompt 的最大字符数：Tavily 的 content 动辄上千字，10 条原样拼入单次输入轻松破万 token */
const MAX_CONTENT_CHARS = 1000;

function truncateContent(text: string): string {
  return text.length <= MAX_CONTENT_CHARS ? text : `${text.slice(0, MAX_CONTENT_CHARS)}…（已截断）`;
}

export interface BuildPromptInput {
  interest: InterestBrief;
  results: SearchResult[];
  /** 此前的更新记录，用于让模型判断"是否构成进展" */
  knownState?: string;
  /** 注入「现在」的时刻，便于测试；默认取当前时间 */
  now?: Date;
}

/**
 * 关注判据块：只有配置了主体或触发条件的兴趣才输出。
 * 两者都留空时整块不出现，prompt 与「无判据」的旧行为一致。
 */
function buildCriteriaBlock(interest: InterestBrief): string {
  const subject = interest.subject?.trim() ?? '';
  const criteria = interest.criteria?.trim() ?? '';
  if (!subject && !criteria) return '';

  const subjectLine = subject ? `- 监控主体：${subject}\n` : '';
  return `本兴趣的判定标准（只有命中的信息才算变化）：
${subjectLine}- 触发条件：${criteria || '未填写，请以监控主体的重要事实变化为准'}
未命中上述条件的信息一律视为无关，不得放进 source。

判定示例：
- 命中触发条件所述的具体事件（发布 / 通过 / 投产 / 突破 / 处罚 等）→ 算
- 只有观点、评论、背景回顾，没有新的事实 → 不算
- 话题相关但未构成触发条件所述的变化 → 不算

`;
}

export function buildAnalyzePrompt({
  interest,
  results,
  knownState,
  now = new Date(),
}: BuildPromptInput): string {
  const context = interest.description ? `背景说明：${interest.description}\n\n` : '';
  const criteriaBlock = buildCriteriaBlock(interest);
  const hasCriteria = criteriaBlock !== '';
  const knownStateBlock = knownState
    ? `目前已知状态（已推送过的进展 + 近期已判定无新增量的轮次，用于判断是否构成进展）：\n${knownState}\n\n`
    : '';

  // 让模型知道「现在」是几号：否则判断一条信息算不算新进展只能靠检索时间窗硬猜
  const nowText = now.toISOString().replace('T', ' ').slice(0, 16);

  const resultLines = results
    .map(
      (r, i) =>
        `${i + 1}. title: ${r.title}\nurl: ${r.url}\npublished_date: ${r.published_date ?? '未知'}\ncontent: ${truncateContent(r.content)}`,
    )
    .join('\n\n');

  return `你是「Nudge」兴趣追踪系统。请分析下面针对「${interest.name}」的最新搜索结果，筛选出真正重要的变化，并输出结构化结果。

当前时间：${nowText}（UTC），判断信息新旧以此为准。

${context}${criteriaBlock}${knownStateBlock}每个搜索结果格式：
- title: 标题
- url: 链接
- published_date: 该信息原始发布时间，「未知」表示搜索结果未提供
- content: 摘要内容

搜索结果：
${resultLines}

输出规则：
1. ${
    hasCriteria
      ? 'has_progress=true 当且仅当 source 中至少有一条命中上方「判定标准」的触发条件；仅仅"话题相关"不算命中。'
      : 'has_progress=true 表示相比目前已知状态有实质进展（新变化/新进展），false 表示只是已知信息的重复或无关内容'
  }
2. title 为本轮更新的事件标题；summary 为本轮执行情况的中文总结（1-3 句）：检索了什么、结论是什么，无论是否有进展都必须填写
3. source 数组列出构成本轮进展的来源，最多 ${MAX_ANALYZED_SOURCES} 条；每条都必须是「变化」本身，而不是对已知信息的复述；每条都要用 why 一句话说明它命中了触发条件的哪一点（未配置触发条件时说明为何值得关注）
4. source_url 必须逐字复制上方搜索结果里的 url 字段（不要改写、补全或添加参数）；无法与搜索结果对应的来源一律不要输出
5. source_name 只能取自搜索结果中出现的信息；published_at 只能取自对应结果的 published_date，为「未知」时输出空字符串，不得推测或编造日期
6. 忽略无关、过时、重复信息；出现在「近期已判定为无新增量的轮次」里的内容一律视为重复，即使换了一篇文章报道也不算新进展；若没有重要变化，返回 {"has_progress": false, "title": "", "summary": "本轮执行情况总结", "source": []}

必须输出一个 JSON 对象，格式为 {"has_progress": true, "title": "标题", "summary": "本轮执行情况总结，1-3句", "source": [{"title": "来源标题", "source_url": "https://...", "source_name": "来源名", "published_at": "2026-08-18", "why": "命中触发条件的哪一点"}]}，不要输出其它内容。`;
}
