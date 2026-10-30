<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { api } from '../api/index.js';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { CheckIcon, PencilIcon, PlayIcon, Trash2Icon } from '@lucide/vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Tab = 'general' | 'ai' | 'push' | 'search';

const activeTab = ref<Tab>('general');
const loading = ref(true);
// loaded = 数据已从后端填充完成，之后才允许 autosave，避免初始赋值触发空保存
const loaded = ref(false);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const saveState = ref<SaveState>('idle');

const tabs: { key: Tab; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'ai', label: 'AI 配置' },
  { key: 'push', label: '推送配置' },
  { key: 'search', label: '搜索配置' },
];

const showKey: Record<string, boolean> = reactive({});
function toggleKey(key: string) {
  showKey[key] = !showKey[key];
}

interface Settings {
  ai_provider_id: number | null;
  ai_provider_kind: string | null;
  ai_provider_name: string | null;
  ai_model: string | null;
  search_provider: string;
  search_api_key: string | null;
  locale: string;
  run_mode: string;
  extra: string | null;
}

interface AiProvider {
  id: number;
  kind: string;
  name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
}

interface KnownProvider {
  kind: string;
  name: string;
  baseUrl: string;
}

interface Channel {
  id: number;
  type: string;
  name: string;
  config: string;
  enabled: number;
  is_default: number;
}

// —— AI 供应商：每用户可存多条，settings.ai_provider_id 指向当前生效的一条 ——
// 模型随供应商保存（ai_provider.model），启用哪家就用哪家的模型。
const providers = ref<AiProvider[]>([]);
const catalog = ref<KnownProvider[]>([]);
const providerId = ref('');

const currentProvider = computed(
  () => providers.value.find((p) => String(p.id) === providerId.value) ?? null,
);

/** 供应商图标块的识别字，仅用文字区分，配色跟随页面中性色 */
function providerInitial(kind: string): string {
  switch (kind) {
    case 'openai':
      return 'AI';
    case 'deepseek':
      return 'D';
    case 'moonshot':
      return 'M';
    case 'zhipu':
      return 'GLM';
    case 'qwen':
      return 'Q';
    default:
      return '自';
  }
}

async function loadProviders() {
  const [list, known] = await Promise.all([
    api.get<AiProvider[]>('/ai-providers'),
    api.get<KnownProvider[]>('/ai-providers/catalog'),
  ]);
  providers.value = list;
  catalog.value = known;
}

/** 启用某家供应商：只改 settings.ai_provider_id，模型跟着那家的 model 走 */
async function activateProvider(target: AiProvider) {
  if (!loaded.value) return;
  if (!target.model) {
    toast.error('请先在「编辑」里为该供应商选择模型');
    return;
  }
  const prev = providerId.value;
  providerId.value = String(target.id);
  try {
    await api.put('/settings', { aiProviderId: target.id });
  } catch (e: any) {
    providerId.value = prev;
    toast.error('启用失败: ' + e.message);
  }
}

async function removeProvider(target: AiProvider) {
  if (!window.confirm(`删除供应商「${target.name}」？`)) return;
  const wasActive = target.id === currentProvider.value?.id;
  try {
    await api.delete(`/ai-providers/${target.id}`);
    providers.value = providers.value.filter((p) => p.id !== target.id);
    if (!wasActive) return;
    const next = providers.value[0];
    providerId.value = next ? String(next.id) : '';
    await api.put('/settings', { aiProviderId: next ? next.id : null });
  } catch (e: any) {
    toast.error('删除失败: ' + e.message);
  }
}

// —— 新增 / 编辑弹窗 ——
const showDialog = ref(false);
const savingProvider = ref(false);
const editingId = ref<number | null>(null);
const form = reactive({ kind: 'openai', name: '', baseUrl: '', apiKey: '', model: '' });
const modelList = ref<string[]>([]);
const modelLoading = ref(false);
const modelError = ref('');

const isEditing = computed(() => editingId.value !== null);
const dialogTitle = computed(() => (isEditing.value ? '编辑供应商' : '添加供应商'));

function resetModelState() {
  modelList.value = [];
  modelError.value = '';
}

function openCreate() {
  const known = catalog.value.find((k) => k.kind === 'openai') ?? catalog.value[0];
  editingId.value = null;
  Object.assign(form, {
    kind: known?.kind ?? 'openai',
    name: '',
    baseUrl: known?.baseUrl ?? '',
    apiKey: '',
    model: '',
  });
  resetModelState();
  showDialog.value = true;
}

function openEdit(p: AiProvider) {
  editingId.value = p.id;
  Object.assign(form, {
    kind: p.kind,
    name: p.name,
    baseUrl: p.base_url ?? '',
    // 列表接口带回真实 Key，编辑框留空表示"不修改"
    apiKey: '',
    model: p.model ?? '',
  });
  resetModelState();
  showDialog.value = true;
}

/** 切类型时带出名称与预设地址，只有自定义供应商需要手填 */
function onKindChange() {
  const known = catalog.value.find((k) => k.kind === form.kind);
  form.baseUrl = known?.baseUrl ?? '';
}

/** 拉模型列表：编辑时用已保存的 Key 兜底，新增时用刚填的 */
async function fetchModels() {
  modelLoading.value = true;
  modelError.value = '';
  try {
    const r = await api.post<{ models: string[] }>('/ai-providers/models', {
      id: editingId.value ?? undefined,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
    });
    modelList.value = r.models;
    if (!r.models.length) modelError.value = '该供应商未返回模型，请手动输入';
  } catch (e: any) {
    modelList.value = [];
    modelError.value = e.message ?? '获取模型列表失败';
  } finally {
    modelLoading.value = false;
  }
}

async function submitProvider() {
  if (savingProvider.value) return;
  const known = catalog.value.find((k) => k.kind === form.kind);
  const baseUrl = form.baseUrl.trim() || known?.baseUrl || '';
  if (!baseUrl) {
    toast.error('请填写请求地址');
    return;
  }
  savingProvider.value = true;
  try {
    if (editingId.value !== null) {
      const updated = await api.put<AiProvider>(`/ai-providers/${editingId.value}`, {
        name: form.name.trim() || known?.name || 'AI 供应商',
        baseUrl,
        // 留空即保持原 Key 不变
        apiKey: form.apiKey.trim() || undefined,
        model: form.model.trim(),
      });
      const idx = providers.value.findIndex((p) => p.id === updated.id);
      if (idx >= 0) providers.value[idx] = updated;
    } else {
      const created = await api.post<AiProvider>('/ai-providers', {
        kind: form.kind,
        name: form.name.trim() || known?.name || 'AI 供应商',
        baseUrl,
        apiKey: form.apiKey.trim(),
        model: form.model.trim(),
      });
      providers.value.push(created);
    }
    showDialog.value = false;
  } catch (e: any) {
    toast.error((isEditing.value ? '保存失败: ' : '添加失败: ') + e.message);
  } finally {
    savingProvider.value = false;
  }
}

const search = reactive({ provider: 'tavily', apiKey: '' });
const feishu = reactive({ webhookUrl: '', secret: '' });
const email = reactive({ smtpHost: '', smtpPort: '465', from: '', password: '', to: '' });
const general = reactive({ runMode: 'default' as 'default' | 'agent', agentTraceEnabled: false, locale: 'zh-CN' });
const agentMode = computed({
  get: () => general.runMode === 'agent',
  set: (v: boolean) => { general.runMode = v ? 'agent' : 'default'; },
});


// 已存在渠道 id：有则 PUT 更新，无则 POST 创建并记下 id，避免重复创建
const channelId: Record<string, number> = {};

const testing = ref('');
const testResult: Record<string, string> = reactive({});

const channelLabel: Record<string, string> = {
  feishu: '飞书',
  email: '邮件',
};

const saveStateText = computed(() => {
  switch (saveState.value) {
    case 'saving':
      return '保存中…';
    case 'saved':
      return '已保存';
    case 'error':
      return '保存失败';
    default:
      return '';
  }
});

const saveStateClass = computed(() => {
  switch (saveState.value) {
    case 'saving':
      return 'text-gray-400';
    case 'saved':
      return 'text-green-500';
    case 'error':
      return 'text-red-500';
    default:
      return '';
  }
});

function loadChannelConfig(c: Channel) {
  const cfg = JSON.parse(c.config);
  if (c.type === 'feishu') {
    feishu.webhookUrl = cfg.webhook_url ?? '';
    feishu.secret = cfg.secret ?? '';
  } else if (c.type === 'email') {
    email.smtpHost = cfg.smtp_host ?? '';
    email.smtpPort = String(cfg.smtp_port ?? '465');
    email.from = cfg.from ?? '';
    email.password = cfg.password ?? '';
    email.to = cfg.to ?? '';
  }
}

onMounted(async () => {
  try {
    const [s, chs] = await Promise.all([
      api.get<Settings>('/settings'),
      api.get<Channel[]>('/notification-channels'),
    ]);
    await loadProviders();
    providerId.value = s.ai_provider_id
      ? String(s.ai_provider_id)
      : providers.value[0]
        ? String(providers.value[0].id)
        : '';
    search.provider = s.search_provider;
    search.apiKey = s.search_api_key ?? '';
    general.runMode = s.run_mode === 'agent' ? 'agent' : 'default';
    let extra: Record<string, unknown> = {};
    try { extra = s.extra ? JSON.parse(s.extra) : {}; } catch {}
    general.agentTraceEnabled = !!extra.agent_trace_enabled;
    general.locale = s.locale ?? 'zh-CN';
    chs.forEach((c) => {
      channelId[c.type] = c.id;
      loadChannelConfig(c);
    });
  } catch (e) {
    console.error('加载设置失败:', e);
    toast.error('加载设置失败');
  } finally {
    loading.value = false;
    loaded.value = true;
  }
});

async function persistSettings() {
  await api.put('/settings', {
    aiProviderId: providerId.value ? Number(providerId.value) : null,
    searchProvider: search.provider || 'tavily',
    searchApiKey: search.apiKey || '',
    runMode: general.runMode,
    extra: { agent_trace_enabled: general.agentTraceEnabled },
    locale: general.locale,
  });
}

async function persistChannel(type: string, config: Record<string, unknown>) {
  const id = channelId[type];
  if (id) {
    await api.put(`/notification-channels/${id}`, { config, enabled: true });
  } else {
    const created = await api.post<Channel>('/notification-channels', {
      type,
      name: type === 'feishu' ? '飞书' : '邮件',
      config,
      enabled: true,
    });
    channelId[type] = created.id;
  }
}

// 保存全部：settings + 两个渠道。autosave 与「发送测试」共用，保证测试前数据已落库。
// 成功静默（不显示"已保存"），仅在失败时提示；autosave 持续失败不重复弹 toast。
async function saveAll() {
  if (!loaded.value) return;
  const wasError = saveState.value === 'error';
  try {
    await persistSettings();
    await Promise.all([
      persistChannel('feishu', { webhook_url: feishu.webhookUrl, secret: feishu.secret }),
      persistChannel('email', {
        smtp_host: email.smtpHost,
        smtp_port: Number(email.smtpPort),
        from: email.from,
        password: email.password,
        to: email.to,
        use_tls: true,
      }),
    ]);
    saveState.value = 'idle';
  } catch (e: any) {
    saveState.value = 'error';
    // 仅在状态从正常变失败时弹一次 toast，避免 autosave 持续失败反复打扰
    if (!wasError) toast.error('保存失败: ' + e.message);
  }
}

// 内容变化自动保存：debounce 600ms，避免连续输入时频繁请求
watchDebounced(() => ({ search, feishu, email, general }), () => saveAll(), {
  debounce: 600,
  deep: true,
});

// 模型选择单独存：它属于全局 AI 配置，与推送/搜索无关，不必连带整份配置一起写

async function sendTest(type: string) {
  if (testing.value) return;
  // 测试前先 flush 最新值，确保后端测试用的是当前输入
  await saveAll();
  const id = channelId[type];
  if (!id) {
    testResult[type] = `尚未保存${channelLabel[type] ?? type}配置`;
    return;
  }
  testing.value = type;
  testResult[type] = '';
  try {
    const r = await api.post<{ message: string }>(`/notification-channels/${id}/test`, {});
    testResult[type] = r.message ?? '发送成功';
  } catch (e: any) {
    testResult[type] = '发送失败: ' + e.message;
  } finally {
    testing.value = '';
  }
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between border-b border-gray-200 pb-2">
      <h2 class="text-base font-bold">设置</h2>
      <span v-if="saveStateText" class="text-xs" :class="saveStateClass">{{ saveStateText }}</span>
    </div>

    <div v-if="loading" class="p-8 text-center text-sm text-gray-400">加载中...</div>

    <div v-else class="flex gap-6">
      <nav class="w-32 shrink-0">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="mb-1 block w-full rounded px-3 py-1.5 text-left text-sm transition-colors"
          :class="activeTab === tab.key ? 'bg-gray-800 font-medium text-white' : 'text-gray-500 hover:bg-gray-200'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div class="min-w-0 flex-1">
        <template v-if="activeTab === 'general'">
          <Card>
            <CardHeader>
              <CardTitle>通用配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-6">
                <div class="space-y-2">
                  <Label>界面语言</Label>
                  <Select v-model="general.locale">
                    <SelectTrigger class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh-CN">简体中文</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                  <p class="text-xs text-muted-foreground">切换界面显示语言（需刷新生效）</p>
                </div>

                <div class="border-t border-gray-100 pt-4">
                  <h3 class="mb-3 text-sm font-medium text-gray-700">巡检模式</h3>
                  <div class="space-y-4">
                    <div class="flex items-center justify-between">
                      <div>
                        <Label>Agent 模式</Label>
                        <p class="text-xs text-muted-foreground">开启后使用 AI Agent 循环巡检，关闭则使用固定流水线</p>
                      </div>
                      <Switch v-model="agentMode" />
                    </div>
                    <div class="flex items-center justify-between">
                      <div>
                        <Label>执行轨迹</Label>
                        <p class="text-xs text-muted-foreground">记录 Agent 每步执行轨迹，便于排查</p>
                      </div>
                      <Switch v-model:checked="general.agentTraceEnabled" />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </template>

        <template v-if="activeTab === 'ai'">
          <div>
            <div class="mb-3 flex items-center justify-between">
              <span class="text-xs font-medium uppercase tracking-wider text-gray-400">供应商</span>
              <button
                class="cursor-pointer text-xs text-gray-400 transition-colors hover:text-gray-700"
                @click="openCreate"
              >
                ＋ 新增
              </button>
            </div>

            <div
              v-if="!providers.length"
              class="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-400"
            >
              还没有配置 AI 供应商
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="p in providers"
                :key="p.id"
                class="group flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
                :class="
                  p.id === currentProvider?.id
                    ? 'border-gray-300 bg-gray-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                "
              >
                <div
                  class="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-gray-100 text-[13px] font-semibold text-gray-500"
                >
                  {{ providerInitial(p.kind) }}
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium text-gray-900">{{ p.name }}</span>
                    <span
                      v-if="p.kind === 'custom'"
                      class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tracking-wide text-gray-500"
                    >
                      CUSTOM
                    </span>
                  </div>
                  <div class="mt-0.5 flex items-center gap-1.5 text-xs">
                    <span class="truncate text-gray-500">{{ p.base_url || '未配置请求地址' }}</span>
                    <span class="shrink-0 text-gray-300">·</span>
                    <span
                      class="shrink-0 font-mono"
                      :class="p.model ? 'text-gray-500' : 'text-gray-400'"
                    >
                      {{ p.model || '未选模型' }}
                    </span>
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <span
                    v-if="p.id === currentProvider?.id"
                    class="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs text-gray-500 ring-1 ring-gray-200"
                  >
                    <CheckIcon class="size-3" :stroke-width="3" />
                    使用中
                  </span>
                  <button
                    v-else
                    class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800"
                    @click="activateProvider(p)"
                  >
                    <PlayIcon class="size-3" />
                    启用
                  </button>

                  <button
                    class="cursor-pointer rounded-lg p-2 text-gray-300 transition hover:bg-gray-100 hover:text-gray-700"
                    title="编辑"
                    @click="openEdit(p)"
                  >
                    <PencilIcon class="size-4" />
                  </button>
                  <button
                    class="cursor-pointer rounded-lg p-2 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                    title="删除"
                    @click="removeProvider(p)"
                  >
                    <Trash2Icon class="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <Dialog :open="showDialog" @update:open="showDialog = $event">
            <DialogContent class="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>{{ dialogTitle }}</DialogTitle>
                <DialogDescription>选择已知供应商，或接入任意 OpenAI 兼容服务</DialogDescription>
              </DialogHeader>

              <div class="space-y-3 py-1">
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1.5">
                    <Label class="text-xs text-gray-600">提供商</Label>
                    <Select
                      :model-value="form.kind"
                      @update:model-value="
                        (v) => {
                          form.kind = String(v);
                          onKindChange();
                        }
                      "
                    >
                      <SelectTrigger class="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="k in catalog" :key="k.kind" :value="k.kind">
                          {{ k.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="space-y-1.5">
                    <Label class="text-xs text-gray-600">名称</Label>
                    <Input
                      v-model="form.name"
                      type="text"
                      :placeholder="`默认：${catalog.find((k) => k.kind === form.kind)?.name ?? 'AI 供应商'}`"
                    />
                  </div>
                  <div class="col-span-2 space-y-1.5">
                    <Label class="text-xs text-gray-600">请求地址</Label>
                    <Input v-model="form.baseUrl" type="text" placeholder="https://api.example.com/v1" />
                  </div>
                  <div class="col-span-2 space-y-1.5">
                    <Label class="text-xs text-gray-600">API Key</Label>
                    <Input
                      v-model="form.apiKey"
                      type="password"
                      :placeholder="isEditing ? '留空则不修改' : 'sk-...'"
                    />
                  </div>
                </div>

                <div class="border-t border-gray-200 pt-3">
                  <div class="mb-2 flex items-center justify-between">
                    <Label class="text-xs text-gray-600">模型</Label>
                    <button
                      class="cursor-pointer text-xs text-gray-400 transition-colors hover:text-gray-700 disabled:cursor-not-allowed"
                      :disabled="modelLoading"
                      @click="fetchModels"
                    >
                      {{ modelLoading ? '获取中…' : '获取模型列表' }}
                    </button>
                  </div>
                  <Input v-model="form.model" type="text" placeholder="选择或手动输入模型名" />

                  <div
                    v-if="modelList.length"
                    class="mt-2 max-h-40 overflow-y-auto rounded-md border border-gray-200"
                  >
                    <button
                      v-for="m in modelList"
                      :key="m"
                      class="flex w-full cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-left last:border-0"
                      :class="m === form.model ? 'bg-gray-100' : 'hover:bg-gray-50'"
                      @click="form.model = m"
                    >
                      <CheckIcon
                        class="size-3 shrink-0"
                        :class="m === form.model ? 'text-gray-900' : 'text-transparent'"
                        :stroke-width="3"
                      />
                      <span class="min-w-0 truncate font-mono text-xs text-gray-700">{{ m }}</span>
                    </button>
                  </div>
                  <p v-if="modelError" class="mt-2 text-xs text-red-500">{{ modelError }}</p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" @click="showDialog = false">取消</Button>
                <Button :disabled="savingProvider" @click="submitProvider">
                  {{ savingProvider ? '保存中…' : isEditing ? '保存' : '添加' }}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </template>

        <template v-if="activeTab === 'push'">
          <div class="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>飞书</CardTitle>
                <CardAction>
                  <Button variant="outline" size="sm" :disabled="testing !== ''" @click="sendTest('feishu')">
                    {{ testing === 'feishu' ? '发送中...' : '发送测试' }}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div v-if="testResult.feishu" class="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                  {{ testResult.feishu }}
                </div>
                <div class="space-y-4">
                  <div class="space-y-2">
                    <Label>Webhook URL</Label>
                    <Input v-model="feishu.webhookUrl" type="text" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                  </div>
                  <div class="space-y-2">
                    <Label>签名密钥（可选）</Label>
                    <div class="relative">
                      <Input v-model="feishu.secret" :type="showKey.feishu ? 'text' : 'password'" placeholder="留空则不验签" class="pr-16" />
                      <button class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('feishu')">
                        {{ showKey.feishu ? '隐藏' : '显示' }}
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>邮件</CardTitle>
                <CardAction>
                  <Button variant="outline" size="sm" :disabled="testing !== ''" @click="sendTest('email')">
                    {{ testing === 'email' ? '发送中...' : '发送测试' }}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div v-if="testResult.email" class="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                  {{ testResult.email }}
                </div>
                <div class="space-y-4">
                  <div class="flex gap-3">
                    <div class="flex-1 space-y-2">
                      <Label>SMTP 服务器</Label>
                      <Input v-model="email.smtpHost" type="text" placeholder="smtp.qq.com" />
                    </div>
                    <div class="w-24 space-y-2">
                      <Label>端口</Label>
                      <Input v-model="email.smtpPort" type="text" />
                    </div>
                  </div>
                  <div class="space-y-2">
                    <Label>发件人邮箱</Label>
                    <Input v-model="email.from" type="email" placeholder="your@email.com" />
                  </div>
                  <div class="space-y-2">
                    <Label>授权码</Label>
                    <div class="relative">
                      <Input v-model="email.password" :type="showKey.email ? 'text' : 'password'" placeholder="邮箱授权码（非登录密码）" class="pr-16" />
                      <button class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('email')">
                        {{ showKey.email ? '隐藏' : '显示' }}
                      </button>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <Label>收件人邮箱</Label>
                    <Input v-model="email.to" type="email" placeholder="receiver@email.com" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </template>

        <template v-if="activeTab === 'search'">
          <Card>
            <CardHeader>
              <CardTitle>搜索配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div class="space-y-2">
                  <Label>搜索提供商</Label>
                  <Select v-model="search.provider">
                    <SelectTrigger class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tavily">Tavily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-2">
                  <Label>API Key</Label>
                  <div class="relative">
                    <Input v-model="search.apiKey" :type="showKey.search ? 'text' : 'password'" placeholder="tvly-..." class="pr-16" />
                    <button class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('search')">
                      {{ showKey.search ? '隐藏' : '显示' }}
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </template>
      </div>
    </div>
  </div>
</template>
