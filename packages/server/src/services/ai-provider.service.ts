import { db } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';
import { findKnownProvider } from '../ai/providers.js';
import type { CreateAiProviderInput, ProbeModelsInput, UpdateAiProviderInput } from '../lib/zod.js';

/**
 * AI 供应商：每用户可存多条，settings.ai_provider_id 指向当前生效的一条。
 * 模型清单不落库——各家的可用模型由 /models 接口实时拉取，避免硬编码清单过期。
 */

export interface AiProviderRow {
  id: number;
  user_id: number;
  kind: string;
  name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_ID = 1;
const MODELS_TIMEOUT_MS = 15_000;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export const aiProviderService = {
  list(userId = DEFAULT_USER_ID): AiProviderRow[] {
    return db
      .prepare('SELECT * FROM ai_provider WHERE user_id = ? ORDER BY id')
      .all(userId) as AiProviderRow[];
  },

  get(userId: number, id: number): AiProviderRow {
    const row = db
      .prepare('SELECT * FROM ai_provider WHERE user_id = ? AND id = ?')
      .get(userId, id) as AiProviderRow | undefined;
    if (!row) throw Errors.notFound('AI 供应商不存在');
    return row;
  },

  create(userId: number, input: CreateAiProviderInput): AiProviderRow {
    const known = findKnownProvider(input.kind);
    const baseUrl = normalizeBaseUrl(input.baseUrl || known?.baseUrl || '');
    if (!baseUrl) throw Errors.validation('自定义供应商必须填写请求地址');

    const name = (input.name || known?.name || 'AI 供应商').trim();
    const dup = db
      .prepare('SELECT id FROM ai_provider WHERE user_id = ? AND name = ?')
      .get(userId, name);
    if (dup) throw Errors.conflict(`供应商名称「${name}」已存在`);

    const result = db
      .prepare(
        `INSERT INTO ai_provider (user_id, kind, name, base_url, api_key, model)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, input.kind, name, baseUrl, input.apiKey || null, input.model || null);

    return aiProviderService.get(userId, Number(result.lastInsertRowid));
  },

  update(userId: number, id: number, input: UpdateAiProviderInput): AiProviderRow {
    aiProviderService.get(userId, id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw Errors.validation('供应商名称不能为空');
      const dup = db
        .prepare('SELECT id FROM ai_provider WHERE user_id = ? AND name = ? AND id <> ?')
        .get(userId, name, id);
      if (dup) throw Errors.conflict(`供应商名称「${name}」已存在`);
      fields.push('name = ?');
      values.push(name);
    }
    if (input.baseUrl !== undefined) {
      const baseUrl = normalizeBaseUrl(input.baseUrl ?? '');
      if (!baseUrl) throw Errors.validation('请求地址不能为空');
      fields.push('base_url = ?');
      values.push(baseUrl);
    }
    if (input.apiKey !== undefined) {
      fields.push('api_key = ?');
      values.push(input.apiKey || null);
    }
    if (input.model !== undefined) {
      fields.push('model = ?');
      values.push(input.model || null);
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(nowUtc(), userId, id);
      db.prepare(`UPDATE ai_provider SET ${fields.join(', ')} WHERE user_id = ? AND id = ?`).run(
        ...values,
      );
    }

    return aiProviderService.get(userId, id);
  },

  remove(userId: number, id: number): void {
    aiProviderService.get(userId, id);
    db.prepare('UPDATE settings SET ai_provider_id = NULL WHERE user_id = ? AND ai_provider_id = ?').run(
      userId,
      id,
    );
    db.prepare('DELETE FROM ai_provider WHERE user_id = ? AND id = ?').run(userId, id);

    // 删光供应商后连遗留列一起清掉，否则设置页显示「未配置」但巡检仍在用旧密钥
    const remaining = db
      .prepare('SELECT COUNT(*) AS c FROM ai_provider WHERE user_id = ?')
      .get(userId) as { c: number };
    if (remaining.c === 0) {
      db.prepare('UPDATE settings SET ai_base_url = NULL, ai_api_key = NULL WHERE user_id = ?').run(userId);
    }
  },

  /** 拉取该供应商的可用模型：OpenAI 兼容协议统一走 GET {base}/models */
  async listModels(
    userId: number,
    id: number,
    fetchImpl: typeof fetch = fetch,
  ): Promise<string[]> {
    const provider = aiProviderService.get(userId, id);
    return fetchModelIds(provider.base_url, provider.api_key, fetchImpl);
  },

  /** 弹窗里未保存的配置也要能试拉：地址/密钥由前端传入，缺项回落到已保存的记录 */
  async probeModels(
    userId: number,
    input: ProbeModelsInput,
    fetchImpl: typeof fetch = fetch,
  ): Promise<string[]> {
    let baseUrl = input.baseUrl?.trim() ?? '';
    let apiKey = input.apiKey?.trim() ?? '';
    if (input.id && (!baseUrl || !apiKey)) {
      const saved = aiProviderService.get(userId, input.id);
      baseUrl = baseUrl || saved.base_url || '';
      apiKey = apiKey || saved.api_key || '';
    }
    return fetchModelIds(baseUrl, apiKey, fetchImpl);
  },
};

/** 请求 {base}/models 并归一化成模型名数组；缺地址或密钥直接报错，不发出必然失败的请求 */
async function fetchModelIds(
  rawBaseUrl: string | null,
  rawApiKey: string | null,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  if (!rawBaseUrl) throw Errors.validation('请先填写请求地址');
  if (!rawApiKey) throw Errors.validation('请先填写 API Key');

  let res: Response;
  try {
    res = await fetchImpl(`${normalizeBaseUrl(rawBaseUrl)}/models`, {
      headers: { Authorization: `Bearer ${rawApiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw Errors.validation(`获取模型列表失败：${reason}`);
  }

  if (!res.ok) {
    throw Errors.validation(`获取模型列表失败：HTTP ${res.status}`);
  }

  const body = (await res.json().catch(() => null)) as unknown;
  return extractModelIds(body);
}

/**
 * 兼容两种常见返回：OpenAI 风格的 { data: [{ id }] } 与裸数组 [{ id }]。
 * 拿不到 id 的项直接丢弃，不让脏数据变成前端下拉里的空行。
 */
export function extractModelIds(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
      ? ((body as { data: unknown[] }).data)
      : [];

  const ids = list
    .map((item) => (typeof item === 'string' ? item : (item as { id?: unknown })?.id))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  return Array.from(new Set(ids)).sort();
}
