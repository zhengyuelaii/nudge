import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';

let feishuId = 0;

function seedChannel(type: string, config: Record<string, unknown>, enabled = 1): number {
  const result = db
    .prepare(
      `INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
       VALUES (1, ?, ?, ?, ?, 0)`,
    )
    .run(type, type, JSON.stringify(config), enabled);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM notification_channel;');
  feishuId = seedChannel('feishu', {
    webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
    secret: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFeishu(body: { code: number; msg: string }, status = 200): typeof fetch {
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('open.feishu.cn')) throw new Error(`Unexpected fetch to ${url}`);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('POST /api/notification-channels/:id/test', () => {
  it('sends a real Feishu message when the channel has a webhook_url', async () => {
    const fetchImpl = stubFeishu({ code: 0, msg: 'success' });
    const spy = vi.fn(fetchImpl);
    vi.stubGlobal('fetch', spy);

    const res = await app.request(`/api/notification-channels/${feishuId}/test`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('open.feishu.cn');
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.msg_type).toBe('text');
    expect(payload.content.text).toContain('测试通知');
  });

  it('returns 400 when the feishu webhook_url is not configured', async () => {
    db.prepare('UPDATE notification_channel SET config = ? WHERE id = ?').run(
      JSON.stringify({ webhook_url: '', secret: '' }),
      feishuId,
    );

    const res = await app.request(`/api/notification-channels/${feishuId}/test`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
  });

  it('surfaces an error when the Feishu API rejects the message', async () => {
    stubFeishu({ code: 19021, msg: 'sign error' });

    const res = await app.request(`/api/notification-channels/${feishuId}/test`, { method: 'POST' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toContain('19021');
  });

  it('rejects unsupported channel types honestly', async () => {
    const dingtalkId = seedChannel('dingtalk', { webhook_url: 'x', secret: '' });
    const res = await app.request(`/api/notification-channels/${dingtalkId}/test`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('不支持');
  });
});