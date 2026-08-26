// 新动态页面结构 mock 数据
// 基于新表结构：interest_event (1) → source (N)

export interface MockSource {
  id: number;
  interest_event_id: number;
  name: string;       // 来源名称（凤凰新闻、新浪新闻）
  title: string;      // 单条变化标题
  url: string | null;  // 原文链接
  created_at: string;
}

export interface MockInterestEvent {
  id: number;
  interest_id: number;
  title: string;       // 事件标题（LLM 生成）
  description: string | null; // 事件描述（LLM 生成）
  run_mode: string;
  created_at: string;
  sources: MockSource[];
}

// ─── Dashboard / Updates 通用 mock ───

export const mockInterestEvents: MockInterestEvent[] = [
  {
    id: 101,
    interest_id: 1,
    title: '黄金价格突破4600美元大关',
    description: '国际金价创历史新高，主要受美联储降息预期推动，市场避险情绪升温。',
    run_mode: 'default',
    created_at: '2026-08-25T09:00:00',
    sources: [
      { id: 1001, interest_event_id: 101, name: '凤凰新闻', title: '黄金答复增长，分析师看高至4800', url: 'https://example.com/1', created_at: '2026-08-25T09:00:00' },
      { id: 1002, interest_event_id: 101, name: '新浪新闻', title: '黄金突破4600，创历史新高', url: 'https://example.com/2', created_at: '2026-08-25T09:00:00' },
      { id: 1003, interest_event_id: 101, name: '华尔街见闻', title: '美联储降息预期推动金价飙升', url: null, created_at: '2026-08-25T09:00:00' },
    ],
  },
  {
    id: 102,
    interest_id: 1,
    title: '黄金延续涨势，站稳4550上方',
    description: '市场避险情绪升温，全球央行持续增持黄金储备。',
    run_mode: 'default',
    created_at: '2026-08-24T09:00:00',
    sources: [
      { id: 1004, interest_event_id: 102, name: '腾讯新闻', title: '黄金续涨，国内金饰价格跟涨', url: 'https://example.com/3', created_at: '2026-08-24T09:00:00' },
      { id: 1005, interest_event_id: 102, name: '路透社', title: '全球央行Q2增持黄金吨数创新高', url: 'https://example.com/4', created_at: '2026-08-24T09:00:00' },
    ],
  },
  {
    id: 103,
    interest_id: 1,
    title: '黄金回调至4500附近震荡',
    description: '获利回吐压力显现，短期技术面偏空，但中期看涨逻辑未变。',
    run_mode: 'default',
    created_at: '2026-08-23T09:00:00',
    sources: [
      { id: 1006, interest_event_id: 103, name: '东方财富', title: '黄金技术面回调，关注4500支撑', url: 'https://example.com/5', created_at: '2026-08-23T09:00:00' },
    ],
  },
  {
    id: 104,
    interest_id: 2,
    title: 'Claude 4.5 发布，编程能力大幅提升',
    description: 'Anthropic 发布新版 Claude，在 SWE-bench 上得分突破 70%，代码生成和调试能力显著增强。',
    run_mode: 'agent',
    created_at: '2026-08-25T09:00:00',
    sources: [
      { id: 1007, interest_event_id: 104, name: 'Anthropic Blog', title: 'Introducing Claude 4.5', url: 'https://example.com/6', created_at: '2026-08-25T09:00:00' },
      { id: 1008, interest_event_id: 104, name: '机器之心', title: 'Claude 4.5 编程能力登顶 SWE-bench', url: 'https://example.com/7', created_at: '2026-08-25T09:00:00' },
      { id: 1009, interest_event_id: 104, name: 'Hacker News', title: 'Claude 4.5 release discussion', url: 'https://example.com/8', created_at: '2026-08-25T09:00:00' },
    ],
  },
  {
    id: 105,
    interest_id: 2,
    title: 'OpenAI 发布 GPT-5 Turbo',
    description: 'GPT-5 Turbo 上线，上下文窗口扩展至 200K，价格下调 30%。',
    run_mode: 'default',
    created_at: '2026-08-24T09:00:00',
    sources: [
      { id: 1010, interest_event_id: 105, name: 'OpenAI Blog', title: 'GPT-5 Turbo now available', url: 'https://example.com/9', created_at: '2026-08-24T09:00:00' },
    ],
  },
];

// ─── InterestDetail mock（单兴趣的时间线） ───

export const mockDetailEvents = mockInterestEvents.filter((e) => e.interest_id === 1);

// ─── Dashboard mock（跨兴趣的混合流） ───

export const mockDashboardEvents = mockInterestEvents;

// ─── 辅助函数 ───

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}天前`;
  return `${Math.floor(diffD / 7)}周前`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'Z');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}
