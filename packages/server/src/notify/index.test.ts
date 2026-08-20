import { describe, it, expect } from 'vitest';
import { signFeishu, sendFeishu, sendEmail, notify } from './index.js';

const WEBHOOK =
  process.env.FEISHU_TEST_WEBHOOK ??
  'https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook';
const SECRET = process.env.FEISHU_TEST_SECRET ?? 'test-secret';

const EMAIL_CONFIG = {
  smtp_host: 'smtp.163.com',
  smtp_port: 465,
  from: 'qq951380562@163.com',
  password: 'test-auth-code',
  to: 'zhengyuelaii@foxmail.com',
};

function mockMailer() {
  const mails: Array<Record<string, unknown>> = [];
  const mailer = {
    sendMail: async (mail: Record<string, unknown>) => {
      mails.push(mail);
    },
  };
  return { mailer, mails };
}

function mockFetch(json: unknown, status = 200): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('signFeishu', () => {
  it('computes the Feishu HMAC-SHA256 signature', () => {
    expect(signFeishu('test-secret', '1539585323')).toBe('itZmtOsip6OMbHVhw6RDB3CqYTvRwRngJgNGGorZp/0=');
  });
});

describe('sendFeishu', () => {
  it('POSTs a signed text message to the webhook', async () => {
    const { impl, calls } = mockFetch({ code: 0, msg: 'success' });

    await sendFeishu(
      { webhook_url: WEBHOOK, secret: SECRET },
      '测试消息',
      { fetchImpl: impl, timestamp: '1539585323' },
    );

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(WEBHOOK);
    expect(call.init.method).toBe('POST');

    const body = JSON.parse(String(call.init.body));
    expect(body.timestamp).toBe('1539585323');
    expect(body.sign).toBe('nk38hJViCUe2UVjBkramBdVXg0PhzrGUNXzzc1rDarg=');
    expect(body.msg_type).toBe('text');
    expect(body.content).toEqual({ text: '测试消息' });
  });

  it('omits sign when no secret is configured', async () => {
    const { impl, calls } = mockFetch({ code: 0, msg: 'success' });

    await sendFeishu({ webhook_url: WEBHOOK }, '测试消息', {
      fetchImpl: impl,
      timestamp: '1539585323',
    });

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sign).toBeUndefined();
    expect(body.timestamp).toBe('1539585323');
  });

  it('throws when the webhook URL is missing', async () => {
    await expect(
      sendFeishu({ webhook_url: '', secret: SECRET }, '测试消息'),
    ).rejects.toThrow('飞书 Webhook URL 未配置');
  });

  it('throws on non-2xx response', async () => {
    const { impl } = mockFetch({}, 500);

    await expect(
      sendFeishu({ webhook_url: WEBHOOK }, '测试消息', { fetchImpl: impl }),
    ).rejects.toThrow('飞书发送失败: HTTP 500');
  });

  it('throws when Feishu returns a non-zero code', async () => {
    const { impl } = mockFetch({ code: 19021, msg: 'sign match fail' });

    await expect(
      sendFeishu({ webhook_url: WEBHOOK }, '测试消息', { fetchImpl: impl }),
    ).rejects.toThrow('飞书发送失败: 19021 sign match fail');
  });
});

describe('sendEmail', () => {
  it('sends the text through the injected mailer', async () => {
    const { mailer, mails } = mockMailer();

    await sendEmail(EMAIL_CONFIG, '测试邮件正文', { mailer });

    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      from: 'qq951380562@163.com',
      to: 'zhengyuelaii@foxmail.com',
      subject: expect.any(String),
      text: '测试邮件正文',
    });
  });

  it('throws when the recipient is not configured', async () => {
    const { mailer } = mockMailer();
    const config = { ...EMAIL_CONFIG };
    delete config.to;

    await expect(sendEmail(config, 'x', { mailer })).rejects.toThrow('收件人');
  });

  it('throws when the sender is not configured', async () => {
    const { mailer } = mockMailer();
    const config = { ...EMAIL_CONFIG };
    delete config.from;

    await expect(sendEmail(config, 'x', { mailer })).rejects.toThrow('发件人');
  });

  it('throws when the SMTP host is not configured', async () => {
    const { mailer } = mockMailer();
    const config = { ...EMAIL_CONFIG };
    delete config.smtp_host;

    await expect(sendEmail(config, 'x', { mailer })).rejects.toThrow('SMTP');
  });
});

describe('notify', () => {
  it('routes feishu channels to sendFeishu', async () => {
    const { impl, calls } = mockFetch({ code: 0, msg: 'success' });

    await notify(
      {
        type: 'feishu',
        config: JSON.stringify({ webhook_url: WEBHOOK, secret: SECRET }),
      },
      'hello',
      { fetchImpl: impl, timestamp: '1539585323' },
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.content).toEqual({ text: 'hello' });
  });

  it('routes email channels to sendEmail', async () => {
    const { mailer, mails } = mockMailer();

    await notify(
      { type: 'email', config: JSON.stringify(EMAIL_CONFIG) },
      'hello',
      { mailer },
    );

    expect(mails).toHaveLength(1);
    expect(mails[0].text).toBe('hello');
  });

  it('throws for unsupported channel types', async () => {
    await expect(
      notify(
        { type: 'dingtalk', config: JSON.stringify({}) },
        'hello',
      ),
    ).rejects.toThrow('不支持的渠道类型: dingtalk');
  });
});
