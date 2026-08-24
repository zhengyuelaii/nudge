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

type Tab = 'ai' | 'push' | 'search';

const activeTab = ref<Tab>('ai');
const loading = ref(true);
// loaded = 数据已从后端填充完成，之后才允许 autosave，避免初始赋值触发空保存
const loaded = ref(false);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const saveState = ref<SaveState>('idle');

const tabs: { key: Tab; label: string }[] = [
  { key: 'ai', label: 'AI 配置' },
  { key: 'push', label: '推送配置' },
  { key: 'search', label: '搜索配置' },
];

const showKey: Record<string, boolean> = reactive({});
function toggleKey(key: string) {
  showKey[key] = !showKey[key];
}

interface Settings {
  ai_base_url: string | null;
  ai_api_key: string | null;
  ai_model: string | null;
  search_provider: string;
  search_api_key: string | null;
}

interface Channel {
  id: number;
  type: string;
  name: string;
  config: string;
  enabled: number;
  is_default: number;
}

const ai = reactive({ baseUrl: '', apiKey: '', model: '' });
const search = reactive({ provider: 'tavily', apiKey: '' });
const feishu = reactive({ webhookUrl: '', secret: '' });
const email = reactive({ smtpHost: '', smtpPort: '465', from: '', password: '', to: '' });

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
    ai.baseUrl = s.ai_base_url ?? '';
    ai.apiKey = s.ai_api_key ?? '';
    ai.model = s.ai_model ?? '';
    search.provider = s.search_provider;
    search.apiKey = s.search_api_key ?? '';
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
    aiBaseUrl: ai.baseUrl || '',
    aiApiKey: ai.apiKey || '',
    aiModel: ai.model || '',
    searchProvider: search.provider || 'tavily',
    searchApiKey: search.apiKey || '',
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
watchDebounced(() => ({ ai, search, feishu, email }), () => saveAll(), {
  debounce: 600,
  deep: true,
});

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
        <template v-if="activeTab === 'ai'">
          <Card>
            <CardHeader>
              <CardTitle>AI 配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div class="space-y-2">
                  <Label>请求地址</Label>
                  <Input v-model="ai.baseUrl" type="text" placeholder="https://api.deepseek.com" />
                </div>
                <div class="space-y-2">
                  <Label>API Key</Label>
                  <div class="relative">
                    <Input v-model="ai.apiKey" :type="showKey.ai ? 'text' : 'password'" placeholder="sk-..." class="pr-16" />
                    <button class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('ai')">
                      {{ showKey.ai ? '隐藏' : '显示' }}
                    </button>
                  </div>
                </div>
                <div class="space-y-2">
                  <Label>模型</Label>
                  <Input v-model="ai.model" type="text" placeholder="deepseek-chat" />
                </div>
              </div>
            </CardContent>
          </Card>
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
