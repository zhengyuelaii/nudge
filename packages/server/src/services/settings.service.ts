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
  agent_max_steps: number;
  agent_trace_enabled: number;
  notify_guard: number;
  use_agent_loop: number;
  locale: string;
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

      if (input.aiBaseUrl !== undefined) { fields.push('ai_base_url = ?'); values.push(input.aiBaseUrl || null); }
      if (input.aiApiKey !== undefined) { fields.push('ai_api_key = ?'); values.push(input.aiApiKey || null); }
      if (input.aiModel !== undefined) { fields.push('ai_model = ?'); values.push(input.aiModel || null); }
      if (input.searchProvider !== undefined) { fields.push('search_provider = ?'); values.push(input.searchProvider || 'tavily'); }
      if (input.searchApiKey !== undefined) { fields.push('search_api_key = ?'); values.push(input.searchApiKey || null); }
      if (input.notifyThreshold !== undefined) { fields.push('notify_threshold = ?'); values.push(input.notifyThreshold); }
      if (input.timezone !== undefined) { fields.push('timezone = ?'); values.push(input.timezone); }
      if (input.useAgentLoop !== undefined) { fields.push('use_agent_loop = ?'); values.push(input.useAgentLoop); }
      if (input.agentMaxSteps !== undefined) { fields.push('agent_max_steps = ?'); values.push(input.agentMaxSteps); }
      if (input.agentTraceEnabled !== undefined) { fields.push('agent_trace_enabled = ?'); values.push(input.agentTraceEnabled); }
      if (input.notifyGuard !== undefined) { fields.push('notify_guard = ?'); values.push(input.notifyGuard); }
      if (input.locale !== undefined) { fields.push('locale = ?'); values.push(input.locale); }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(nowUtc());
        values.push(userId);
        db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
      }
    } else {
      db.prepare(
        `INSERT INTO settings (user_id, ai_base_url, ai_api_key, ai_model, search_provider, search_api_key, timezone, notify_threshold, use_agent_loop, agent_max_steps, agent_trace_enabled, notify_guard, locale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        input.aiBaseUrl || null,
        input.aiApiKey || null,
        input.aiModel || null,
        input.searchProvider || 'tavily',
        input.searchApiKey || null,
        input.timezone ?? 'Asia/Shanghai',
        input.notifyThreshold ?? 7,
        input.useAgentLoop ?? 0,
        input.agentMaxSteps ?? 8,
        input.agentTraceEnabled ?? 0,
        input.notifyGuard ?? 0,
        input.locale ?? 'zh-CN',
      );
    }

    return settingsService.get(userId);
  },
};
