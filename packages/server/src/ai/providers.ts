/**
 * 已知 AI 供应商目录：只放「地址 + 展示名」，不含密钥，也不含模型清单
 * （模型一律由各家的 /models 接口实时拉取，避免硬编码清单随供应商升级而过期）。
 *
 * 除 deepseek 外全部按 OpenAI 兼容协议访问，装配差异见 model.ts。
 */

export const AI_PROVIDER_KINDS = [
  'openai',
  'deepseek',
  'moonshot',
  'zhipu',
  'qwen',
  'custom',
] as const;

export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export interface KnownProvider {
  kind: AiProviderKind;
  name: string;
  /** OpenAI 兼容根地址；custom 由用户自行填写，故为空 */
  baseUrl: string;
}

export const KNOWN_PROVIDERS: KnownProvider[] = [
  { kind: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { kind: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { kind: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { kind: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { kind: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { kind: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '' },
];

export function findKnownProvider(kind: string): KnownProvider | undefined {
  return KNOWN_PROVIDERS.find((p) => p.kind === kind);
}

/**
 * 该供应商是否需要 DeepSeek 专有参数（关闭思考），装配时用。
 * 既没配供应商类型也没配地址时按 DeepSeek 处理：这是未迁移的老配置与测试库的默认语义，
 * 也让「默认地址」和「DeepSeek 装配分支」不会各走一边。
 */
export function isDeepSeek(kind: string | null | undefined, baseUrl?: string | null): boolean {
  if (kind) return kind === 'deepseek';
  if (baseUrl) return baseUrl.includes('deepseek');
  return true;
}
