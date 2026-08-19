import { z } from 'zod';

export const createInterestSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(['company', 'policy', 'tech', 'game', 'finance']),
  description: z.string().optional(),
  queryKeywords: z.string().optional(),
  frequency: z.enum(['day', 'week']),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

export const updateInterestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.enum(['company', 'policy', 'tech', 'game', 'finance']).optional(),
  description: z.string().optional(),
  queryKeywords: z.string().optional(),
  frequency: z.enum(['day', 'week']).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const updateSettingsSchema = z.object({
  aiBaseUrl: z.string().url().optional(),
  aiApiKey: z.string().optional(),
  aiModel: z.string().optional(),
  searchProvider: z.string().optional(),
  searchApiKey: z.string().optional(),
  notifyThreshold: z.number().int().min(1).max(10).optional(),
  timezone: z.string().optional(),
});

export const createChannelSchema = z.object({
  type: z.enum(['feishu', 'dingtalk', 'email']),
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
