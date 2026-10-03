import { interestService } from '../services/interest.service.js';
import { notify, type Mailer } from './index.js';

/** 通知正文里的来源条目 */
export interface NotifySource {
  title: string;
  sourceUrl?: string | null;
  /** 为什么构成变化（命中触发条件的哪一点）：让用户看懂凭什么打扰他 */
  why?: string | null;
}

export interface NotifyEventInput {
  userId: number;
  /** 兴趣：决定发给哪些渠道，并作为正文标题 */
  interest: { id: number; name: string };
  /** 事件：写入 notify_log 用于追溯 */
  event: { id: number; title: string };
  sources: NotifySource[];
}

export interface NotifyEventOptions {
  fetchImpl?: typeof fetch;
  mailer?: Mailer;
}

export interface NotifyEventFailure {
  channelName: string;
  error: Error;
}

export interface NotifyEventResult {
  /** 成功投递的「渠道 × 来源」条数（沿用既有口径：每个渠道都收到完整一条消息） */
  notifiedCount: number;
  /** 发送失败的渠道；任一渠道失败即由调用方判定本轮通知失败 */
  failures: NotifyEventFailure[];
}

/** 通知正文：🔔「兴趣名」有 N 条重要变化 + 标题（含判定理由）/链接列表 */
export function buildNotifyText(interestName: string, sources: NotifySource[]): string {
  const lines = sources.map((s) => {
    const head = s.why ? `${s.title}\n（为什么重要：${s.why}）` : s.title;
    return s.sourceUrl ? `${head}\n${s.sourceUrl}` : head;
  });
  return `🔔「${interestName}」有 ${sources.length} 条重要变化\n\n${lines.join('\n\n')}`;
}

/**
 * 把一个事件分发给该兴趣配置的多个渠道。
 *
 * - 无来源时直接返回空结果，不发送（调用方仍可按「无通知」正常记账）
 * - 逐渠道尽力发送：单个渠道失败只记入 failures，不影响其余渠道
 * - 不做记账、不判定 run 成败——那是调用方的职责
 */
export async function notifyEvent(
  input: NotifyEventInput,
  opts: NotifyEventOptions = {},
): Promise<NotifyEventResult> {
  if (input.sources.length === 0) {
    return { notifiedCount: 0, failures: [] };
  }

  const channels = interestService.getNotifyChannels(input.userId, input.interest.id);
  const text = buildNotifyText(input.interest.name, input.sources);
  const meta = {
    userId: input.userId,
    interestId: input.interest.id,
    eventId: input.event.id,
    title: input.event.title,
  };

  let notifiedCount = 0;
  const failures: NotifyEventFailure[] = [];

  for (const channel of channels) {
    try {
      await notify(channel, text, { fetchImpl: opts.fetchImpl, mailer: opts.mailer, meta });
      notifiedCount += input.sources.length;
    } catch (e) {
      failures.push({
        channelName: channel.name,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  return { notifiedCount, failures };
}
