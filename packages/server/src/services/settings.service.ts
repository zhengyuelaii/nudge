import { db } from '../db/client.js';
import type { UpdateSettingsInput } from '../lib/zod.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';

export interface SettingsRow {
  id: number;
  user_id: number;
  ai_base_url: string | null;
  ai_api_key: string | null;
  ai_model: string | null;
  search_provider: string;
  search_api_key: string | null;
  timezone: string;
  notify_threshold: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_ID = 1;

export const settingsService = {
  get(userId = DEFAULT_USER_ID): SettingsRow {
    const row = db
      .prepare('SELECT * FROM settings WHERE user_id = ?')
      .get(userId) as SettingsRow | undefined;
    if (!row) throw Errors.notFound('用户配置不存在');
    return row;
  },

  upsert(userId: number, input: UpdateSettingsInput): SettingsRow {
    const existing = db
      .prepare('SELECT id FROM settings WHERE user_id = ?')
      .get(userId) as { id: number } | undefined;

    if (existing) {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (input.aiBaseUrl !== undefined) { fields.push('ai_base_url = ?'); values.push(input.aiBaseUrl); }
      if (input.aiApiKey !== undefined) { fields.push('ai_api_key = ?'); values.push(input.aiApiKey); }
      if (input.aiModel !== undefined) { fields.push('ai_model = ?'); values.push(input.aiModel); }
      if (input.searchProvider !== undefined) { fields.push('search_provider = ?'); values.push(input.searchProvider); }
      if (input.searchApiKey !== undefined) { fields.push('search_api_key = ?'); values.push(input.searchApiKey); }
      if (input.notifyThreshold !== undefined) { fields.push('notify_threshold = ?'); values.push(input.notifyThreshold); }
      if (input.timezone !== undefined) { fields.push('timezone = ?'); values.push(input.timezone); }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(nowUtc());
        values.push(userId);
        db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
      }
    } else {
      db.prepare(
        `INSERT INTO settings (user_id, ai_base_url, ai_api_key, ai_model, search_provider, search_api_key, timezone, notify_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        input.aiBaseUrl ?? 'https://api.openai.com/v1',
        input.aiApiKey ?? null,
        input.aiModel ?? 'gpt-4o',
        input.searchProvider ?? 'tavily',
        input.searchApiKey ?? null,
        input.timezone ?? 'Asia/Shanghai',
        input.notifyThreshold ?? 7,
      );
    }

    return settingsService.get(userId);
  },
};
