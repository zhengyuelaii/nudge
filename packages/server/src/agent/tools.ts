import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { search } from '../ai/search.js';
import { updateService } from '../services/update.service.js';
import { stateService } from '../services/state.service.js';
import { interestService } from '../services/interest.service.js';
import { notify } from '../notify/index.js';
import { nowUtc } from '../lib/time.js';
import type { Trace } from './trace.js';

export interface ToolContext {
  userId: number;
  interest: { id: number; name: string; tags: string[]; query_keywords?: string | null; description?: string | null };
  settings: {
    search_api_key?: string | null;
    notify_threshold: number;
    notify_guard: number;
  };
  runId: number;
  trace: Trace;
  fetchImpl?: typeof fetch;
  mailer?: { sendMail: (mail: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };
}

function buildNotifyText(interest: { name: string }, updates: Array<{ title: string; importance: number; source_url?: string | null }>): string {
  const lines = updates.map(
    (u) =>
      `【${u.importance}/10】${u.title}${
        u.source_url ? `\n${u.source_url}` : ''
      }`,
  );
  return `🔔「${interest.name}」有 ${updates.length} 条重要变化\n\n${lines.join('\n\n')}`;
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
        const summary = `查询结果 ${results.length} 条`;
        ctx.trace.push({ kind: 'tool_result', tool: 'web_search', summary, at: nowUtc() });
        return results;
      },
    }),

    get_recent_updates: tool({
      description: '回顾该兴趣最近保存的动态，判断本轮发现是否构成新进展。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: (input: { limit?: number }) => {
        const rows = updateService.list(ctx.userId, {
          interestId: ctx.interest.id,
          limit: input.limit ?? 10,
        });
        return rows.map((u) => ({
          title: u.title,
          summary: u.summary,
          importance: u.importance,
          has_progress: !!u.has_progress,
          published_at: u.published_at,
        }));
      },
    }),

    get_last_state: tool({
      description: '读取上轮巡检固化的状态，据此判断本轮是否构成新进展。',
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

    save_update: tool({
      description: '保存一条本轮发现的重要变化。source_url 必须来自 web_search 结果。',
      inputSchema: z.object({
        title: z.string(),
        summary: z.string().optional(),
        source_url: z.string().url(),
        source_name: z.string().optional(),
        published_at: z.string().optional(),
        importance: z.number().int().min(1).max(10),
        has_progress: z.boolean().optional(),
      }),
      execute: (input: { title: string; summary?: string; source_url: string; source_name?: string; published_at?: string; importance: number; has_progress?: boolean }) => {
        const [row] = updateService.writeMany(ctx.userId, ctx.interest.id, ctx.runId, [input]);
        const summary = row ? `保存1条新动态: ${row.title}` : '重复内容，已跳过';
        ctx.trace.push({ kind: 'tool_result', tool: 'save_update', summary, at: nowUtc() });
        return row ? { saved: true, id: row.id } : { saved: false, duplicate: true };
      },
    }),

    save_state: tool({
      description: '本轮巡检结束前调用，固化状态总结供下轮判断是否有新进展。',
      inputSchema: z.object({
        summary: z.string().describe('本轮后该兴趣整体状态一句话'),
        key_points: z.array(z.string()).describe('当前已知关键点（含历史）'),
        query_hints_next: z.array(z.string()).describe('下次查询建议词/角度'),
        has_new_progress: z.boolean().describe('本轮是否有新进展'),
      }),
      execute: (input: { summary: string; key_points: string[]; query_hints_next: string[]; has_new_progress: boolean }) => {
        stateService.upsert(ctx.userId, ctx.interest.id, {
          ...input,
          last_checked_at: nowUtc(),
        });
        ctx.trace.push({ kind: 'tool_result', tool: 'save_state', summary: '状态已固化', at: nowUtc() });
        return { saved: true };
      },
    }),

    notify_user: tool({
      description: '当你判断本轮有值得用户立即知晓的重要变化时调用。无重要变化不要调用。',
      inputSchema: z.object({
        message: z.string().optional().describe('通知正文，省略则系统按本轮保存的动态组装'),
        update_ids: z.array(z.number()).optional().describe('指定通知哪些 update，省略取本轮 importance≥阈值'),
      }),
      execute: async (input: { message?: string; update_ids?: number[] }) => {
        const runStartedAt = nowUtc();

        if (ctx.settings.notify_guard) {
          const hit = updateService.list(ctx.userId, {
            interestId: ctx.interest.id,
            since: runStartedAt,
            importance: ctx.settings.notify_threshold,
          });
          if (hit.length === 0) {
            ctx.trace.push({ kind: 'tool_result', tool: 'notify_user', summary: '本轮无 importance≥阈值 的动态，拒绝通知', at: nowUtc() });
            return { notified: 0, reason: '本轮无 importance≥阈值 的动态，拒绝通知' };
          }
        }

        const channels = interestService.getNotifyChannels(ctx.userId, ctx.interest.id);

        let updates: Array<{ id: number; title: string; importance: number; source_url: string | null }>;
        if (input.update_ids && input.update_ids.length > 0) {
          updates = input.update_ids.map((id) => {
            const row = updateService.get(ctx.userId, id);
            return { id: row.id, title: row.title, importance: row.importance, source_url: row.source_url };
          });
        } else {
          const recent = updateService.listByRun(ctx.userId, ctx.runId, {
            importance: ctx.settings.notify_threshold,
          });
          updates = recent.map((u) => ({ id: u.id, title: u.title, importance: u.importance, source_url: u.source_url }));
        }

        const text: string = input.message ?? buildNotifyText(ctx.interest, updates);

        let notifiedCount = 0;
        const notifyErrors: string[] = [];
        for (const ch of channels) {
          try {
            await notify(ch, text, { fetchImpl: ctx.fetchImpl, mailer: ctx.mailer });
            notifiedCount++;
          } catch {
            notifyErrors.push(ch.name);
          }
        }

        if (notifiedCount > 0) {
          updateService.markNotified(ctx.userId, updates.map((u) => u.id));
        }

        const summary = notifiedCount > 0
          ? `已通知${notifiedCount}渠道`
          : `通知失败: ${notifyErrors.join(', ')}`;
        ctx.trace.push({ kind: 'tool_result', tool: 'notify_user', summary, at: nowUtc() });

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
