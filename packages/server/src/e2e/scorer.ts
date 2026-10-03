import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { SearchResult } from '../search/types.js';

/**
 * E2E 评分器：把「这次推送水不水」从感觉变成可复现的数字。
 *
 * 两类分：
 * - **规则分（确定性、可复现）**：链路健康 / 证据可信 / 理由完整 / 推送可读 —— 只看结构化产物，
 *   同一份产物永远得同一个分，适合当回归基线。
 * - **LLM 判定分**：判定准确（噪音率、漏判率）/ 理由质量 —— 需要读懂语义，
 *   交给一次独立的模型调用当评审员，用**同一份检索原料**对照产品的取舍。
 *
 * 无推送（模型判定「本轮无重要变化」）时，与推送内容相关的维度按满分处理并标记 vacuous，
 * 由 judge 单独回答「这个不推送的决策是否正确」—— 不能把「正确地不打扰」误判成 0 分，
 * 那恰恰是产品想要的行为。
 */

// ── 输入 ────────────────────────────────────────────────

export interface E2EScoreInput {
  /** 兴趣定义：判据就是评分的标尺，judge 必须看到它 */
  interest: { name: string; subject: string; criteria: string };
  /** 本轮 Tavily 真实返回的全部结果 —— 评分参照系，用来判断来源是否真实、是否漏判 */
  searchResults: SearchResult[];
  run: {
    status: string;
    summary: string | null;
    error_type: string | null;
    error_message: string | null;
    search_result_count: number | null;
    llm_input_tokens: number | null;
    llm_output_tokens: number | null;
  };
  /** 落库的来源（无推送时为空数组） */
  sources: Array<{
    title: string;
    source_url: string | null;
    source_name: string | null;
    published_at: string | null;
  }>;
  /** 事件标题（无推送时为 null） */
  eventTitle: string | null;
  /** 推送正文（notify_log.content，无推送时为 null） */
  notifyText: string | null;
  /** 评审用的模型；调用方负责装配 */
  judgeModel: LanguageModel;
}

// ── 输出 ────────────────────────────────────────────────

export interface DimensionResult {
  label: string;
  score: number;
  max: number;
  notes: string[];
  /** 本轮无推送，该维度无内容可评，按满分计 */
  vacuous?: boolean;
  /** 该维度含 LLM 判定成分 */
  llm?: boolean;
}

export interface JudgeVerdict {
  /** 0-10：推送内容命中触发条件的比例 */
  noise: number;
  /** 0-10：未漏判的程度 */
  miss: number;
  /** 0-10：理由的具体性与准确性 */
  reasonQuality: number;
  verdict: string;
  noiseItems: string[];
  missedItems: string[];
}

export interface ScoreReport {
  dimensions: DimensionResult[];
  total: number;
  maxTotal: number;
  /** 百分制 */
  percent: number;
  grade: string;
  judge: JudgeVerdict;
  /** 可直接打印的报告正文 */
  lines: string[];
}

const MAX = {
  link: 20,
  evidence: 20,
  accuracy: 30,
  reason: 15,
  delivery: 15,
} as const;

// ── 工具 ────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;

const clamp10 = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(10, v));
};

/** 归一化 URL：忽略协议大小写、www. 前缀、末尾斜杠、fragment。strict 保留 query，loose 丢弃 */
function normalizeUrl(raw: string | null | undefined): { strict: string; loose: string } {
  const text = (raw ?? '').trim();
  if (!text) return { strict: '', loose: '' };
  try {
    const u = new URL(text);
    const host = u.host.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return { strict: `${host}${path}${u.search}`, loose: `${host}${path}` };
  } catch {
    const lower = text.toLowerCase().replace(/\/+$/, '');
    return { strict: lower, loose: lower };
  }
}

/**
 * source_url 是否确实来自本轮检索结果。
 * 先按严格（含 query）比对，不中再按宽松（忽略 query）比对 —— 模型补个 utm 参数不该算编造，
 * 但换了个域名/路径就是编造。
 */
function urlBelongsToRun(
  raw: string | null | undefined,
  index: { strict: Set<string>; loose: Set<string> },
): boolean {
  const n = normalizeUrl(raw);
  if (!n.strict) return false;
  return index.strict.has(n.strict) || index.loose.has(n.loose);
}

/**
 * 取日期部分（YYYY-MM-DD）用于比对。
 * 两种来源格式都要认：模型落库的 `2026-09-28`，以及 Tavily 原样返回的 RFC 2822（`Mon, 28 Sep 2026 08:39:22 GMT`）。
 * 只写正则的话会把后者全部漏掉，参照集为空 → 真实日期被误判成编造。
 */
function dateKey(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';

  // 字面就是 YYYY-MM-DD（或 ISO 开头）时直接取，避免本地时区把日期挪一天
  const literal = text.match(/\d{4}-\d{2}-\d{2}/);
  if (literal) return literal[0];

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 按比例给分，避免一条小错就清零 */
function proportional(passed: number, total: number, max: number): number {
  return total === 0 ? max : (passed / total) * max;
}

// ── 规则维度 ─────────────────────────────────────────────

/** 链路健康：run 跑通、模型真被调用、检索有料。这是 E2E 的底线 */
function scoreLinkHealth(input: E2EScoreInput): DimensionResult {
  const { run } = input;
  const notes: string[] = [];
  let score = 0;

  if (run.status === 'success') {
    score += 10;
    notes.push('✓ run 状态 success');
  } else {
    notes.push(`✗ run 状态 ${run.status}${run.error_type ? `（${run.error_type}）` : ''}: ${run.error_message ?? '-'}`);
  }

  const tokens = (run.llm_input_tokens ?? 0) + (run.llm_output_tokens ?? 0);
  if (tokens > 0) {
    score += 5;
    notes.push(`✓ 模型记账 token ${tokens}（in ${run.llm_input_tokens ?? 0} / out ${run.llm_output_tokens ?? 0}）`);
  } else {
    notes.push('✗ 未记录 token —— 模型可能根本没被调用');
  }

  const found = run.search_result_count ?? 0;
  if (found > 0) {
    score += 5;
    notes.push(`✓ 检索到 ${found} 条`);
  } else {
    notes.push('✗ 本轮检索 0 条');
  }

  return { label: '链路健康', score: Math.min(score, MAX.link), max: MAX.link, notes };
}

/** 证据可信：落库的来源能不能对回本轮检索结果（链接是否编造、日期是否编造、标题是否缺失） */
function scoreEvidence(input: E2EScoreInput): DimensionResult {
  const { sources, searchResults } = input;
  if (sources.length === 0) {
    return {
      label: '证据可信',
      score: MAX.evidence,
      max: MAX.evidence,
      vacuous: true,
      notes: ['— 本轮无推送，无来源可核'],
    };
  }

  const index = {
    strict: new Set(searchResults.map((r) => normalizeUrl(r.url).strict).filter(Boolean)),
    loose: new Set(searchResults.map((r) => normalizeUrl(r.url).loose).filter(Boolean)),
  };
  const dateSet = new Set(searchResults.map((r) => dateKey(r.published_date)).filter(Boolean));

  const urlOk = sources.filter((s) => urlBelongsToRun(s.source_url, index));
  // 日期留空是合法选择（模型不确定时不编）；填了就必须来自本轮检索结果
  const dateOk = sources.filter((s) => {
    const key = dateKey(s.published_at);
    return key === '' || dateSet.has(key);
  });
  const titleOk = sources.filter((s) => (s.title ?? '').trim().length > 0);

  const score =
    proportional(urlOk.length, sources.length, 10) +
    proportional(dateOk.length, sources.length, 5) +
    proportional(titleOk.length, sources.length, 5);

  const notes: string[] = [
    `链接可回溯 ${urlOk.length}/${sources.length}（其余不在本轮检索结果中 = 编造）`,
    `日期未编造 ${dateOk.length}/${sources.length}`,
    `标题非空 ${titleOk.length}/${sources.length}`,
  ];
  const bad = sources.filter((s) => !urlBelongsToRun(s.source_url, index));
  for (const s of bad) notes.push(`  ✗ 可疑链接：${s.title} → ${s.source_url ?? '(空)'}`);

  return { label: '证据可信', score: round1(score), max: MAX.evidence, notes };
}

/** 判定准确：噪音率 + 漏判率，两半各占 15 分，由 judge 打 */
function scoreAccuracy(judge: JudgeVerdict): DimensionResult {
  const noisePart = (judge.noise / 10) * (MAX.accuracy / 2);
  const missPart = (judge.miss / 10) * (MAX.accuracy / 2);
  const notes = [
    `噪音控制 ${judge.noise}/10 —— 推送内容命中触发条件的成色`,
    `漏判控制 ${judge.miss}/10 —— 检索结果里被漏掉的真变化程度`,
  ];
  if (judge.noiseItems.length > 0) notes.push(`  判为噪音：${judge.noiseItems.join('；')}`);
  if (judge.missedItems.length > 0) notes.push(`  漏判：${judge.missedItems.join('；')}`);
  return { label: '判定准确', score: round1(noisePart + missPart), max: MAX.accuracy, notes, llm: true };
}

/** 理由完整 + 理由质量：正文是否给每条来源交代了「为什么重要」，以及交代得具体不具体 */
function scoreReason(input: E2EScoreInput, judge: JudgeVerdict): DimensionResult {
  if (input.sources.length === 0 || !input.notifyText) {
    return {
      label: '理由质量',
      score: MAX.reason,
      max: MAX.reason,
      vacuous: true,
      llm: true,
      notes: [`— 本轮无推送；judge 的理由质量分 ${judge.reasonQuality}/10`],
    };
  }

  // 规则部分（5 分）：每条来源都应在正文里带「为什么重要」
  const whyCount = (input.notifyText.match(/（为什么重要：/g) ?? []).length;
  const rulePart = proportional(Math.min(whyCount, input.sources.length), input.sources.length, 5);
  // judge 部分（10 分）：理由写得具体不具体
  const judgePart = (judge.reasonQuality / 10) * 10;

  return {
    label: '理由质量',
    score: round1(rulePart + judgePart),
    max: MAX.reason,
    llm: true,
    notes: [
      `正文带「为什么重要」${whyCount}/${input.sources.length} 条`,
      `judge 理由具体性 ${judge.reasonQuality}/10`,
    ],
  };
}

/** 推送可读：正文结构完整（标题行 + 每条标题 + 链接） */
function scoreDelivery(input: E2EScoreInput): DimensionResult {
  const { sources, notifyText, interest } = input;
  if (sources.length === 0 || !notifyText) {
    return {
      label: '推送可读',
      score: MAX.delivery,
      max: MAX.delivery,
      vacuous: true,
      notes: ['— 本轮无推送'],
    };
  }

  const headOk = new RegExp(`🔔「${escapeRe(interest.name)}」有 ${sources.length} 条重要变化`).test(notifyText);
  const titleOk = sources.filter((s) => notifyText.includes(s.title));
  const linkOk = sources.filter((s) => !s.source_url || notifyText.includes(s.source_url));

  const score =
    (headOk ? 5 : 0) +
    proportional(titleOk.length, sources.length, 5) +
    proportional(linkOk.length, sources.length, 5);

  return {
    label: '推送可读',
    score: round1(score),
    max: MAX.delivery,
    notes: [
      headOk ? '✓ 标题行完整' : '✗ 标题行缺失或条数不符',
      `来源标题入正文 ${titleOk.length}/${sources.length}`,
      `来源链接入正文 ${linkOk.length}/${sources.length}`,
    ],
  };
}

// ── LLM 评审 ────────────────────────────────────────────

const JUDGE_MAX_OUTPUT_TOKENS = 2000;

/**
 * judge 的输出 schema。
 * 数组字段一律 optional：DeepSeek 走的是「schema 注入 system message」的兼容模式（非约束解码），
 * 字段一多模型就会省略数组，写死必填会让整次评审白跑。
 */
const judgeSchema = z.object({
  noise: z
    .number()
    .describe('0-10 整数。推送的内容中真正命中「触发条件」的成色：10=每条都确实构成条件所述的变化；0=全是无关噪音'),
  miss: z
    .number()
    .describe('0-10 整数。未漏判的程度：10=没有遗漏任何独立的重要变化；0=有独立事件明显命中触发条件却完全没被推送。同一事件被多个来源报道、只推了其中一个，不算漏判'),
  reasonQuality: z
    .number()
    .describe('0-10 整数。每条来源的「为什么重要」是否具体说明了命中触发条件的哪一点；空泛套话给低分'),
  verdict: z.string().describe('2-4 句中文总评，直接指出问题，不要客套'),
  noiseItems: z.array(z.string()).optional().describe('被判为噪音的推送条目标题，没有则空数组'),
  missedItems: z
    .array(z.string())
    .optional()
    .describe('被漏掉的独立事件标题，只能取自未被推送的原料，没有则空数组'),
});

const JUDGE_CONTENT_CHARS = 400;

function buildJudgePrompt(input: E2EScoreInput): string {
  const { interest, searchResults, sources, eventTitle, notifyText, run } = input;

  // 给原料打上「已推送」标记：judge 不必靠标题去猜哪些已被采纳，减少把已推送的条目误判成漏判
  const pushedTitles = sources.map((s) => s.title);
  const isPushed = (title: string): boolean =>
    pushedTitles.some((p) => p.includes(title) || title.includes(p));

  const material = searchResults
    .map((r, i) => {
      const content = r.content.length > JUDGE_CONTENT_CHARS
        ? `${r.content.slice(0, JUDGE_CONTENT_CHARS)}…`
        : r.content;
      const flag = isPushed(r.title) ? '【已推送】' : '';
      return `${i + 1}. ${flag}${r.title}\n   发布时间：${r.published_date ?? '未知'}\n   摘要：${content}\n   链接：${r.url}`;
    })
    .join('\n');

  const pushed = sources.length > 0
    ? sources.map((s, i) => `  ${i + 1}. ${s.title}（${s.source_url ?? '无链接'}）`).join('\n')
    : '  （本轮未推送任何内容）';

  return `你是「Nudge」兴趣追踪器的产品验收评审员。下面是它的一次真实运行记录，请对**判定质量**打分。

【产品定位】只在兴趣发生「重要变化」时打扰用户；日常波动、机构观点、行业综述、旧闻复述都不该推。

【本兴趣的判定标尺】
- 名称：${interest.name}
- 监控主体：${interest.subject || '（未填）'}
- 触发条件：${interest.criteria || '（未填，按主体重要事实变化判断）'}

【本轮检索到的全部原料】（共 ${searchResults.length} 条，这是系统能看到的全部信息）
${material || '（无）'}

【系统的判定结果】
- run 状态：${run.status}
- 检索条数：${run.search_result_count ?? 0}
- 是否推送：${sources.length > 0 ? '是' : '否'}
- 事件标题：${eventTitle ?? '（无）'}
- 推送的来源：
${pushed}

【推送正文原文】
${notifyText ?? '（本轮无推送）'}

请严格按上面的「触发条件」评价：
1. noise：推送的每一条，是**真的命中触发条件所述的变化**，还是只是话题相关/观点/综述/复述？据此给 0-10。
   若本轮未推送，给 10（不打扰本身就是正确行为），并在 verdict 里说明该决策是否成立。
2. miss：检索原料里有没有**明显命中触发条件、却完全没被推送的独立事件**？据此给 0-10。
   判定口径（重要，别搞错）：
   - 以「事件」为单位，不以「来源条数」为单位。同一事件被多个来源报道时，只要其中一个来源已被推送，
     就算该事件已覆盖，**不算漏判**；来源覆盖不全属于「不够全面」，写进 verdict 就好，不要扣 miss。
   - 只有当一个**独立的**事件（如另一天的另一次暴跌、另一次关口突破）命中触发条件却零覆盖时，才计入漏判。
   - 本轮未推送时，这一项尤其关键 —— 要判断「判定为无变化」这个决策是否正确。
3. reasonQuality：每条推送的「为什么重要」是否具体点出了命中触发条件的哪一点。空泛或与事实不符给低分。
   若本轮未推送，给 10。
4. verdict：2-4 句中文总评，直说做得好和做得不好的地方。
5. noiseItems / missedItems：
   - noiseItems：被判为噪音的**推送**条目标题；
   - missedItems：被漏掉的**独立事件**标题，**只能从上面未被推送的原料里选，已经推送过的条目一律不得列进来**；
   - 没有就给空数组。`;
}

async function judgeQuality(input: E2EScoreInput): Promise<JudgeVerdict> {
  const { output } = await generateText({
    model: input.judgeModel,
    output: Output.object({
      schema: judgeSchema,
      name: 'QualityReview',
      description: '对一次运行判定质量的评审结果',
    }),
    temperature: 0,
    maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000),
    prompt: buildJudgePrompt(input),
  });

  return {
    noise: clamp10(output.noise),
    miss: clamp10(output.miss),
    reasonQuality: clamp10(output.reasonQuality),
    verdict: output.verdict,
    noiseItems: output.noiseItems ?? [],
    missedItems: output.missedItems ?? [],
  };
}

// ── 报告 ────────────────────────────────────────────────

function gradeOf(percent: number): string {
  if (percent >= 90) return 'A（优秀）';
  if (percent >= 80) return 'B（良好）';
  if (percent >= 70) return 'C（及格）';
  if (percent >= 60) return 'D（勉强）';
  return 'F（不合格）';
}

function renderReport(
  input: E2EScoreInput,
  dimensions: DimensionResult[],
  total: number,
  maxTotal: number,
  percent: number,
  grade: string,
  judge: JudgeVerdict,
): string[] {
  const { interest, searchResults, sources, notifyText, run, eventTitle } = input;
  const lines: string[] = [];

  lines.push('');
  lines.push('════════════ Nudge E2E 评分报告 ════════════');
  lines.push(`兴趣：${interest.name}`);
  lines.push(`监控主体：${interest.subject || '（未填）'}`);
  lines.push(`触发条件：${interest.criteria || '（未填）'}`);
  lines.push('');
  lines.push('──── 本轮发生了什么 ────');
  lines.push(`run 状态：${run.status}${run.error_type ? `（${run.error_type}）` : ''}`);
  if (run.summary) lines.push(`模型总结：${run.summary}`);
  lines.push(`检索原料：${searchResults.length} 条`);
  for (const r of searchResults) lines.push(`  · ${r.title}（${r.published_date ?? '日期未知'}）`);
  lines.push('');
  lines.push(`判定结果：${sources.length > 0 ? `推送 ${sources.length} 条` : '未推送（判定为无重要变化）'}`);
  if (eventTitle) lines.push(`事件标题：${eventTitle}`);
  for (const s of sources) lines.push(`  · ${s.title}（${s.published_at ?? '日期空'}）`);
  lines.push('');
  lines.push('──── 推送正文 ────');
  lines.push(notifyText ?? '（本轮无推送）');
  lines.push('');
  lines.push('──── 评分明细 ────');
  for (const d of dimensions) {
    const flag = d.vacuous ? ' [无推送·按满分]' : d.llm ? ' [含模型评审]' : '';
    lines.push(`${d.label.padEnd(6, '　')} ${String(d.score).padStart(5)} / ${d.max}${flag}`);
    for (const n of d.notes) lines.push(`         ${n}`);
  }
  lines.push('');
  lines.push(`总分 ${total} / ${maxTotal}（百分制 ${percent}）→ 等级 ${grade}`);
  lines.push('');
  lines.push('──── 模型评审总评 ────');
  lines.push(judge.verdict);
  lines.push('═══════════════════════════════════════════');

  return lines;
}

// ── 入口 ────────────────────────────────────────────────

export async function scoreRun(input: E2EScoreInput): Promise<ScoreReport> {
  const judge = await judgeQuality(input);
  const dimensions: DimensionResult[] = [
    scoreLinkHealth(input),
    scoreEvidence(input),
    scoreAccuracy(judge),
    scoreReason(input, judge),
    scoreDelivery(input),
  ];

  // 最终百分比按满分之和归一化，避免维度权重调整后公式失真
  const maxTotal = dimensions.reduce((s, d) => s + d.max, 0);
  const total = round1(dimensions.reduce((s, d) => s + d.score, 0));
  const percent = round1((total / maxTotal) * 100);
  const grade = gradeOf(percent);

  return {
    dimensions,
    total,
    maxTotal,
    percent,
    grade,
    judge,
    lines: renderReport(input, dimensions, total, maxTotal, percent, grade, judge),
  };
}
