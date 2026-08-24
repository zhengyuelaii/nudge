import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client.js';
import { app } from '../app.js';

// settings 表测试共享内存 DB；每个用例前重置回默认行（user_id=1）
beforeEach(() => {
  db.exec('DELETE FROM settings;');
  db.exec('INSERT INTO settings (user_id) VALUES (1);');
});

describe('GET /api/settings', () => {
  it('returns seeded defaults for the default user', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user_id).toBe(1);
    expect(body.data.search_provider).toBe('tavily');
    expect(body.data.timezone).toBe('Asia/Shanghai');
    expect(body.data.notify_threshold).toBe(7);
    expect(body.data.ai_api_key).toBeNull();
    expect(body.data.ai_base_url).toBeNull();
  });
});

describe('PUT /api/settings', () => {
  // 回归：前端 Settings.vue 的 save() 在字段留空时曾发 null，
  // 后端 zod `z.string().optional()` 不接受 null → 400 保存失败。
  // 修复后前端发空字符串；本用例锁定"空字符串 → 存 NULL"的契约。
  it('persists empty-string fields as NULL (前端留空场景)', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiBaseUrl: '',
        aiApiKey: '',
        aiModel: '',
        searchProvider: 'tavily',
        searchApiKey: '',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ai_base_url).toBeNull();
    expect(body.data.ai_api_key).toBeNull();
    expect(body.data.ai_model).toBeNull();
    expect(body.data.search_api_key).toBeNull();
    expect(body.data.search_provider).toBe('tavily');
  });

  // 双保险：即使前端（旧代码/缓存）发 null，后端 schema 也要接受并归一为 NULL。
  it('accepts null fields (浏览器缓存旧前端发 null 的场景)', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiBaseUrl: null,
        aiApiKey: null,
        aiModel: null,
        searchProvider: null,
        searchApiKey: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ai_api_key).toBeNull();
    expect(body.data.ai_model).toBeNull();
    expect(body.data.search_api_key).toBeNull();
    // service 层 searchProvider || 'tavily' 兜底
    expect(body.data.search_provider).toBe('tavily');
  });

  it('saves and reads back real values', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiBaseUrl: 'https://api.deepseek.com',
        aiApiKey: 'sk-xxx',
        aiModel: 'deepseek-chat',
        searchApiKey: 'tvly-xxx',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ai_base_url).toBe('https://api.deepseek.com');
    expect(body.data.ai_api_key).toBe('sk-xxx');
    expect(body.data.ai_model).toBe('deepseek-chat');

    // 读回验证持久化
    const get = await app.request('/api/settings');
    const getBody = await get.json();
    expect(getBody.data.ai_api_key).toBe('sk-xxx');
    expect(getBody.data.search_api_key).toBe('tvly-xxx');
  });

  // aiBaseUrl 不做 .url() 校验：autosave 下 URL 是流式输入的中间态（"http"、"https://..."），
  // 逐字符校验会持续 400。非空非 URL 字符串照常保存，URL 可用性在 AI 调用时验证。
  it('accepts a non-url base url string (autosave 中间态)', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiBaseUrl: 'http' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ai_base_url).toBe('http');
  });

  it('updates only the provided fields (partial update)', async () => {
    // 先写一个值
    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiApiKey: 'sk-keep' }),
    });

    // 再单独更新另一个字段
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiModel: 'deepseek-chat' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ai_model).toBe('deepseek-chat');
    // 未提供的字段保持不变
    expect(body.data.ai_api_key).toBe('sk-keep');
  });
});
