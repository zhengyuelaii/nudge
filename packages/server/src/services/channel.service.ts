import { db } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import { nowUtc } from '../lib/time.js';
import type { CreateChannelInput, UpdateChannelInput } from '../lib/zod.js';

export interface ChannelRow {
  id: number;
  user_id: number;
  type: string;
  name: string;
  config: string;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_ID = 1;

export const channelService = {
  list(userId = DEFAULT_USER_ID): ChannelRow[] {
    return db
      .prepare('SELECT * FROM notification_channel WHERE user_id = ? ORDER BY id')
      .all(userId) as ChannelRow[];
  },

  get(userId: number, id: number): ChannelRow {
    const row = db
      .prepare('SELECT * FROM notification_channel WHERE id = ? AND user_id = ?')
      .get(id, userId) as ChannelRow | undefined;
    if (!row) throw Errors.notFound('通知渠道不存在');
    return row;
  },

  create(userId: number, input: CreateChannelInput): ChannelRow {
    if (input.isDefault) {
      channelService.clearOtherDefaults(userId, -1);
    }

    const result = db.prepare(
      `INSERT INTO notification_channel (user_id, type, name, config, enabled, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      input.type,
      input.name,
      JSON.stringify(input.config),
      input.enabled === false ? 0 : 1,
      input.isDefault ? 1 : 0,
    );

    return channelService.get(userId, Number(result.lastInsertRowid));
  },

  update(userId: number, id: number, input: UpdateChannelInput): ChannelRow {
    channelService.get(userId, id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(input.config)); }
    if (input.enabled !== undefined) { fields.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }
    if (input.isDefault !== undefined) { fields.push('is_default = ?'); values.push(input.isDefault ? 1 : 0); }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(nowUtc());
      values.push(id);
      db.prepare(`UPDATE notification_channel SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    if (input.isDefault) {
      channelService.clearOtherDefaults(userId, id);
    }

    return channelService.get(userId, id);
  },

  remove(userId: number, id: number): void {
    channelService.get(userId, id);
    db.prepare('DELETE FROM notification_channel WHERE id = ? AND user_id = ?').run(id, userId);
  },

  getDefault(userId = DEFAULT_USER_ID): ChannelRow | undefined {
    return db
      .prepare('SELECT * FROM notification_channel WHERE user_id = ? AND is_default = 1 AND enabled = 1')
      .get(userId) as ChannelRow | undefined;
  },

  clearOtherDefaults(userId: number, keepId: number): void {
    db.prepare(
      'UPDATE notification_channel SET is_default = 0 WHERE user_id = ? AND id != ?',
    ).run(userId, keepId);
  },
};
