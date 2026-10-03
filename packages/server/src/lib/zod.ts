import { z } from 'zod';
import { SEARCH_PROVIDERS } from '../search/index.js';

export const createInterestSchema = z.object({
  name: z.string().min(1).max(200),
  tags: z.array(z.string().min(1).max(50)).min(1).max(10),
  description: z.string().optional(),
  queryKeywords: z.string().optional(),
  // 关注判据：均为可选，留空表示未配置（退化为无判据的旧行为）
  subject: z.string().max(200).optional(),
  criteria: z.string().max(500).optional(),
  frequency: z.enum(['day', 'week']),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  channelIds: z.array(z.number().int().positive()).optional(),
});

export const updateInterestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(50)).min(1).max(10).optional(),
  description: z.string().optional(),
  queryKeywords: z.string().optional(),
  subject: z.string().max(200).optional(),
  criteria: z.string().max(500).optional(),
  frequency: z.enum(['day', 'week']).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  channelIds: z.array(z.number().int().positive()).optional(),
});

export const updateSettingsSchema = z.object({
  // .nullable() 兼容前端用 null 表示"留空/清空"的语义（service 层 `|| null` 统一转 NULL 存库）。
  // 字符串字段同时接受 string | null | undefined，避免前端发 null 被 zod 拒绝 → 400。
  // aiBaseUrl 不做 .url() 校验：autosave 下用户输入是流式的，URL 中间态（"http"、"https://..."）
  // 必然非合法 URL，逐字符 400 会持续报错；URL 最终可不可用在 AI 调用时验证，后端不替用户卡语法。
  aiBaseUrl: z.string().nullable().optional(),
  aiApiKey: z.string().nullable().optional(),
  aiModel: z.string().nullable().optional(),
  searchProvider: z.enum(SEARCH_PROVIDERS).nullable().optional(),
  searchApiKey: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  locale: z.string().optional(),
  runMode: z.enum(['default', 'agent']).optional(),
  extra: z.record(z.unknown()).nullable().optional(),
});

export const createChannelSchema = z.object({
  // 钉钉推送暂时停用
  // type: z.enum(['feishu', 'dingtalk', 'email']),
  type: z.enum(['feishu', 'email']),
  name: z.string().min(1).max(100),
  config: z.record(z.unknown()),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export type CreateInterestInput = z.infer<typeof createInterestSchema>;
export type UpdateInterestInput = z.infer<typeof updateInterestSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
