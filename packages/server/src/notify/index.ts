import { createHmac } from 'node:crypto';
import { Errors } from '../lib/errors.js';

export interface FeishuConfig {
  webhook_url?: string;
  secret?: string;
}

export interface NotifyOptions {
  fetchImpl?: typeof fetch;
  timestamp?: string;
}

export function signFeishu(secret: string, timestamp: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac('sha256', stringToSign).digest('base64');
}

export async function sendFeishu(
  config: FeishuConfig,
  text: string,
  opts: NotifyOptions = {},
): Promise<void> {
  if (!config.webhook_url) {
    throw Errors.validation('飞书 Webhook URL 未配置');
  }

  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const body = {
    timestamp,
    ...(config.secret ? { sign: signFeishu(config.secret, timestamp) } : {}),
    msg_type: 'text',
    content: { text },
  };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(config.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw Errors.internal(`飞书发送失败: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { code?: number; msg?: string };
  if (data.code !== undefined && data.code !== 0) {
    throw Errors.internal(`飞书发送失败: ${data.code} ${data.msg ?? ''}`.trim());
  }
}

export interface NotifyChannel {
  type: string;
  config: string;
}

export async function notify(
  channel: NotifyChannel,
  text: string,
  opts: NotifyOptions = {},
): Promise<void> {
  // TODO: dingtalk, email —— MVP 阶段仅实现 feishu
  if (channel.type === 'feishu') {
    const config = JSON.parse(channel.config) as FeishuConfig;
    return sendFeishu(config, text, opts);
  }
  throw Errors.validation(`不支持的渠道类型: ${channel.type}`);
}
