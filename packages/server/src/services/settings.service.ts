import { db } from '../db/client.js';
import type { UpdateSettingsInput } from '../lib/zod.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';

export interface SettingsRow {
  id: number;
  user_id: number;
  ai_provider_id: number | null;
  /** 生效值：由 ai_provider 联查得出，调用方（ai/model.ts、check.ts）无需关心供应商存储结构 */
  ai_base_url: string | null;
  ai_api_key: string | null;
  ai_provider_kind: string | null;
  ai_provider_name: string | null;
  ai_model: string | null;
  search_provider: string;
  search_api_key: string | null;
  timezone: string;
  locale: string;
  run_mode: string;
  extra: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderRef {
  kind: string;
  name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
}

const DEFAULT_USER_ID = 1;

/**
 * 把当前供应商的地址/密钥/模型摊平到 settings 行上，保持「一行配置喂给一次 AI 调用」的既有契约。
 * 未设置供应商时保留遗留列的值，老配置在迁移前仍可用。
 */
function withActiveProvider(row: SettingsRow, userId: number): SettingsRow {
  if (!row.ai_provider_id) {
    return { ...row, ai_provider_kind: null, ai_provider_name: null };
  }
  const p = db
    .prepare('SELECT kind, name, base_url, api_key, model FROM ai_provider WHERE user_id = ? AND id = ?')
    .get(userId, row.ai_provider_id) as ProviderRef | undefined;
  if (!p) return { ...row, ai_provider_kind: null, ai_provider_name: null };
  return {
    ...row,
    ai_base_url: p.base_url,
    ai_api_key: p.api_key,
    // 供应商自己配了模型就以它为准；老数据回落到 settings.ai_model
    ai_model: p.model || row.ai_model,
    ai_provider_kind: p.kind,
    ai_provider_name: p.name,
  };
}

export const settingsService = {
  get(userId = DEFAULT_USER_ID): SettingsRow {
    const row = db
      .prepare('SELECT * FROM settings WHERE user_id = ?')
      .get(userId) as SettingsRow | undefined;
    if (!row) throw Errors.notFound('用户配置不存在');
    return withActiveProvider(row, userId);
  },

  upsert(userId: number, input: UpdateSettingsInput): SettingsRow {
    const existing = db
      .prepare('SELECT id FROM settings WHERE user_id = ?')
      .get(userId) as { id: number } | undefined;

    if (existing) {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (input.aiBaseUrl !== undefined) { fields.push('ai_base_url = ?'); values.push(input.aiBaseUrl || null); }
      if (input.aiApiKey !== undefined) { fields.push('ai_api_key = ?'); values.push(input.aiApiKey || null); }
      if (input.aiModel !== undefined) { fields.push('ai_model = ?'); values.push(input.aiModel || null); }
      if (input.aiProviderId !== undefined) { fields.push('ai_provider_id = ?'); values.push(input.aiProviderId ?? null); }
      if (input.searchProvider !== undefined) { fields.push('search_provider = ?'); values.push(input.searchProvider || 'tavily'); }
      if (input.searchApiKey !== undefined) { fields.push('search_api_key = ?'); values.push(input.searchApiKey || null); }
      if (input.timezone !== undefined) { fields.push('timezone = ?'); values.push(input.timezone); }
      if (input.locale !== undefined) { fields.push('locale = ?'); values.push(input.locale); }
      if (input.runMode !== undefined) { fields.push('run_mode = ?'); values.push(input.runMode); }
      if (input.extra !== undefined) { fields.push('extra = ?'); values.push(input.extra ? JSON.stringify(input.extra) : null); }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(nowUtc());
        values.push(userId);
        db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
      }
    } else {
      db.prepare(
        `INSERT INTO settings (user_id, ai_base_url, ai_api_key, ai_model, ai_provider_id, search_provider, search_api_key, timezone, locale, run_mode, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        input.aiBaseUrl || null,
        input.aiApiKey || null,
        input.aiModel || null,
        input.aiProviderId ?? null,
        input.searchProvider || 'tavily',
        input.searchApiKey || null,
        input.timezone ?? 'Asia/Shanghai',
        input.locale ?? 'zh-CN',
        input.runMode ?? 'default',
        input.extra ? JSON.stringify(input.extra) : null,
      );
    }

    return settingsService.get(userId);
  },
};
