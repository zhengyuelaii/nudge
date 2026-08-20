import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { Errors } from '../lib/errors.js';

export interface FeishuConfig {
  webhook_url?: string;
  secret?: string;
}

export interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  from?: string;
  password?: string;
  to?: string;
}

export interface Mailer {
  sendMail: (mail: { from: string; to: string; subject: string; text: string }) => Promise<unknown>;
}

export interface NotifyOptions {
  fetchImpl?: typeof fetch;
  timestamp?: string;
  mailer?: Mailer;
}

const EMAIL_SUBJECT = '🔔 Nudge 兴趣动态提醒';

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

function createMailer(config: EmailConfig): Mailer {
  const port = config.smtp_port ?? 465;
  const transporter = nodemailer.createTransport({
    host: config.smtp_host,
    port,
    secure: port === 465,
    ...(config.password
      ? { auth: { user: config.from ?? '', pass: config.password } }
      : {}),
  });
  return { sendMail: (mail) => transporter.sendMail(mail) };
}

export async function sendEmail(
  config: EmailConfig,
  text: string,
  opts: NotifyOptions = {},
): Promise<void> {
  const from = config.from?.trim();
  const to = config.to?.trim();
  const host = config.smtp_host?.trim();

  if (!from) throw Errors.validation('邮件发件人邮箱未配置');
  if (!to) throw Errors.validation('邮件收件人邮箱未配置');
  if (!host) throw Errors.validation('邮件 SMTP 服务器未配置');

  const mailer = opts.mailer ?? createMailer(config);
  try {
    await mailer.sendMail({ from, to, subject: EMAIL_SUBJECT, text });
  } catch (e) {
    throw Errors.internal(`邮件发送失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function notify(
  channel: NotifyChannel,
  text: string,
  opts: NotifyOptions = {},
): Promise<void> {
  if (channel.type === 'feishu') {
    const config = JSON.parse(channel.config) as FeishuConfig;
    return sendFeishu(config, text, opts);
  }
  if (channel.type === 'email') {
    const config = JSON.parse(channel.config) as EmailConfig;
    return sendEmail(config, text, opts);
  }
  // TODO: dingtalk —— 暂时停用
  throw Errors.validation(`不支持的渠道类型: ${channel.type}`);
}
