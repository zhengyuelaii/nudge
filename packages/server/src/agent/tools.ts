import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { search } from '../search/index.js';
import { sourceService } from '../services/source.service.js';
import { stateService } from '../services/state.service.js';
import { interestService } from '../services/interest.service.js';
import { notify } from '../notify/index.js';
import { nowUtc } from '../lib/time.js';
import type { Trace } from './trace.js';

export interface ToolContext {
  userId: number;
  interest: { id: number; name: string; tags: string[]; query_keywords?: string | null; description?: string | null };
  settings: Record<string, unknown> & { ai_api_key?: string | null; ai_base_url?: string | null; ai_model?: string | null; search_api_key?: string | null; search_provider?: string | null };
  runId: number;
  trace: Trace;
  runStats?: { notifiedCount: number; searchResultCount: number };
  fetchImpl?: typeof fetch;
  mailer?: { sendMail: (mail: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };
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

export function buildTools(ctx: ToolContext): Record<string, Tool> {
  return {
    web_search: tool({
      description: `搜索「${ctx.interest.name}」相关最新动态。query 由你组织，可结合上轮 query_hints 调整角度。`,
      inputSchema: z.object({
        query: z.string(),
        timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
        maxResults: z.number().int().min(3).max(20).optional(),
      }),
      execute: async (input: { query: string; timeRange?: 'day' | 'week' | 'month' | 'year'; maxResults?: number }) => {
        ctx.trace.push({ kind: 'tool_call', tool: 'web_search', input, at: nowUtc() });
        const results = await search(ctx.interest, ctx.settings, {
          fetchImpl: ctx.fetchImpl,
          timeRange: input.timeRange,
          maxResults: input.maxResults,
        });
        if (ctx.runStats) ctx.runStats.searchResultCount += results.length;
        const summary = `查询结果 ${results.length} 条`;
        ctx.trace.push({ kind: 'tool_result', tool: 'web_search', summary, at: nowUtc() });
        return results;
      },
    }),

    get_recent_sources: tool({
      description: '回顾该兴趣最近保存的来源，判断本轮发现是否构成新进展。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: (input: { limit?: number }) => {
        const rows = sourceService.list(ctx.userId, {
          interestId: ctx.interest.id,
          limit: input.limit ?? 10,
        });
        return rows.map((s) => ({
          title: s.title,
          summary: s.summary,
          source_url: s.source_url,
          source_name: s.source_name,
          published_at: s.published_at,
          created_at: s.created_at,
        }));
      },
    }),

    get_last_state: tool({
      description: '读取历史事件派生的上轮巡检状态，据此判断本轮是否构成新进展。',
      inputSchema: z.object({}),
      execute: () => {
        const state = stateService.get(ctx.userId, ctx.interest.id);
        return state ?? {
          summary: '(首次巡检，无历史)',
          key_points: [],
          query_hints: [],
          last_checked_at: null,
        };
      },
    }),

    save_source: tool({
      description: '保存一条本轮发现的重要变化。source_url 必须来自 web_search 结果。',
      inputSchema: z.object({
        title: z.string(),
        summary: z.string().optional(),
        source_url: z.string().url(),
        source_name: z.string().optional(),
        published_at: z.string().optional(),
      }),
      execute: async (input: { title: string; summary?: string; source_url: string; source_name?: string; published_at?: string }) => {
        const state = stateService.get(ctx.userId, ctx.interest.id);
        const eventTitle = input.title.slice(0, 100);

        const { eventService } = await import('../services/event.service.js');
        const event = eventService.create(ctx.userId, {
          interestId: ctx.interest.id,
          taskRunId: ctx.runId,
          title: eventTitle,
          runAt: nowUtc(),
          summary: state?.summary ?? null,
        });

        const [row] = sourceService.createMany(ctx.userId, ctx.interest.id, event.id, [input]);
        eventService.updateSourceCount(ctx.userId, event.id, 1);

        const summary = row ? `保存1条新来源: ${row.title}` : '重复内容，已跳过';
        ctx.trace.push({ kind: 'tool_result', tool: 'save_source', summary, at: nowUtc() });
        return row ? { saved: true, id: row.id } : { saved: false, duplicate: true };
      },
    }),

    notify_user: tool({
      description: '当你判断本轮有值得用户立即知晓的重要变化时调用。无重要变化不要调用。',
      inputSchema: z.object({
        message: z.string().optional().describe('通知正文，省略则系统按本轮保存的来源组装'),
      }),
      execute: async (input: { message?: string }) => {
        const recentSources = sourceService.list(ctx.userId, {
          interestId: ctx.interest.id,
        });

        const sourcesToNotify = recentSources.slice(0, 10);

        if (sourcesToNotify.length === 0) {
          ctx.trace.push({ kind: 'tool_result', tool: 'notify_user', summary: '本轮无来源，拒绝通知', at: nowUtc() });
          return { notified: 0, reason: '本轮无来源，拒绝通知' };
        }

        const channels = interestService.getNotifyChannels(ctx.userId, ctx.interest.id);

        const text: string = input.message ?? buildNotifyText(ctx.interest, sourcesToNotify);

        let notifiedCount = 0;
        const notifyErrors: string[] = [];
        for (const ch of channels) {
          try {
            await notify(ch, text, {
              fetchImpl: ctx.fetchImpl,
              mailer: ctx.mailer,
              meta: {
                userId: ctx.userId,
                interestId: ctx.interest.id,
                eventId: sourcesToNotify[0]?.event_id,
                title: ctx.interest.name,
              },
            });
            notifiedCount++;
          } catch {
            notifyErrors.push(ch.name);
          }
        }

        const summary = notifiedCount > 0
          ? `已通知${notifiedCount}渠道`
          : `通知失败: ${notifyErrors.join(', ')}`;
        ctx.trace.push({ kind: 'tool_result', tool: 'notify_user', summary, at: nowUtc() });

        if (ctx.runStats) ctx.runStats.notifiedCount += notifiedCount;

        return { notified: notifiedCount, channels: channels.map((c) => c.name) };
      },
    }),

    report_progress: tool({
      description: '每步执行后汇报进展：当前阶段、思考、发现。便于追踪与排查。',
      inputSchema: z.object({
        stage: z.enum(['thinking', 'searching', 'analyzing', 'saving', 'notifying', 'summarizing', 'done'])
          .describe('当前阶段'),
        message: z.string().describe('一句话汇报'),
      }),
      execute: (input: { stage: string; message: string }) => {
        ctx.trace.push({ kind: 'progress', stage: input.stage, text: input.message, at: nowUtc() });
        return { ok: true };
      },
    }),
  };
}
