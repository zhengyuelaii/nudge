<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { api } from '../api/index.js';

type Tab = 'ai' | 'push' | 'search';

const activeTab = ref<Tab>('ai');
const loading = ref(true);
const saving = ref(false);

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
  timezone: string;
  notify_threshold: number;
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
const channels = ref<Channel[]>([]);

const feishu = reactive({ webhookUrl: '', secret: '' });
// 钉钉推送暂时停用
// const dingtalk = reactive({ webhookUrl: '', secret: '' });
const email = reactive({ smtpHost: '', smtpPort: '465', from: '', password: '', to: '' });

const testing = ref('');
const testResult: Record<string, string> = reactive({});

const channelLabel: Record<string, string> = {
  feishu: '飞书',
  email: '邮件',
};

async function sendTest(type: string) {
  if (testing.value) return;
  const ch = channels.value.find((c) => c.type === type);
  if (!ch) {
    testResult[type] = `尚未保存${channelLabel[type] ?? type}配置`;
    return;
  }
  testing.value = type;
  testResult[type] = '';
  try {
    const r = await api.post<{ message: string }>(`/notification-channels/${ch.id}/test`, {});
    testResult[type] = r.message ?? '发送成功';
  } catch (e: any) {
    testResult[type] = '发送失败: ' + e.message;
  } finally {
    testing.value = '';
  }
}

function loadChannelConfig(type: string) {
  const ch = channels.value.find((c) => c.type === type);
  if (!ch) return;
  const cfg = JSON.parse(ch.config);
  if (type === 'feishu') {
    feishu.webhookUrl = cfg.webhook_url ?? '';
    feishu.secret = cfg.secret ?? '';
    // 钉钉推送暂时停用
    // } else if (type === 'dingtalk') {
    //   dingtalk.webhookUrl = cfg.webhook_url ?? '';
    //   dingtalk.secret = cfg.secret ?? '';
  } else if (type === 'email') {
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
    ai.baseUrl = s.ai_base_url ?? 'https://api.openai.com/v1';
    ai.apiKey = s.ai_api_key ?? '';
    ai.model = s.ai_model ?? 'gpt-4o';
    search.provider = s.search_provider;
    search.apiKey = s.search_api_key ?? '';
    channels.value = chs;
    loadChannelConfig('feishu');
    // loadChannelConfig('dingtalk');
    loadChannelConfig('email');
  } catch (e) {
    console.error('加载设置失败:', e);
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  try {
    await api.put('/settings', {
      aiBaseUrl: ai.baseUrl || undefined,
      aiApiKey: ai.apiKey || undefined,
      aiModel: ai.model || undefined,
      searchProvider: search.provider,
      searchApiKey: search.apiKey || undefined,
    });

    const saveChannel = async (type: string, config: Record<string, unknown>) => {
      const existing = channels.value.find((c) => c.type === type);
      const body = { type, name: `${type === 'feishu' ? '飞书' : '邮件'}`, config, enabled: true };
      if (existing) {
        await api.put(`/notification-channels/${existing.id}`, { config, enabled: true });
      } else {
        await api.post('/notification-channels', body);
      }
    };

    await Promise.all([
      saveChannel('feishu', { webhook_url: feishu.webhookUrl, secret: feishu.secret }),
      // saveChannel('dingtalk', { webhook_url: dingtalk.webhookUrl, secret: dingtalk.secret }),
      saveChannel('email', {
        smtp_host: email.smtpHost,
        smtp_port: Number(email.smtpPort),
        from: email.from,
        password: email.password,
        to: email.to,
        use_tls: true,
      }),
    ]);

    const chs = await api.get<Channel[]>('/notification-channels');
    channels.value = chs;
  } catch (e: any) {
    alert('保存失败: ' + e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mb-3 border-b border-gray-200 pb-2">
      <h2 class="text-base font-bold">设置</h2>
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
          <div class="rounded border border-gray-200 bg-white p-5">
            <h3 class="mb-4 text-sm font-bold">AI 配置</h3>
            <div class="space-y-4">
              <div>
                <label class="mb-1 block text-xs text-gray-500">请求地址</label>
                <input v-model="ai.baseUrl" type="text" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
              </div>
              <div>
                <label class="mb-1 block text-xs text-gray-500">API Key</label>
                <div class="relative">
                  <input v-model="ai.apiKey" :type="showKey.ai ? 'text' : 'password'" placeholder="sk-..." class="w-full rounded border border-gray-300 px-3 py-1.5 pr-16 text-sm outline-none focus:border-gray-500" />
                  <button class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('ai')">
                    {{ showKey.ai ? '隐藏' : '显示' }}
                  </button>
                </div>
              </div>
              <div>
                <label class="mb-1 block text-xs text-gray-500">模型</label>
                <input v-model="ai.model" type="text" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
              </div>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'push'">
          <div class="space-y-4">
            <div class="rounded border border-gray-200 bg-white p-5">
              <div class="mb-4 flex items-center justify-between">
                <h3 class="text-sm font-bold">飞书</h3>
                <button
                  class="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  :disabled="testing !== ''"
                  @click="sendTest('feishu')"
                >
                  {{ testing === 'feishu' ? '发送中...' : '发送测试' }}
                </button>
              </div>
              <div v-if="testResult.feishu" class="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                {{ testResult.feishu }}
              </div>
              <div class="space-y-4">
                <div>
                  <label class="mb-1 block text-xs text-gray-500">Webhook URL</label>
                  <input v-model="feishu.webhookUrl" type="text" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-gray-500">签名密钥（可选）</label>
                  <div class="relative">
                    <input v-model="feishu.secret" :type="showKey.feishu ? 'text' : 'password'" placeholder="留空则不验签" class="w-full rounded border border-gray-300 px-3 py-1.5 pr-16 text-sm outline-none focus:border-gray-500" />
                    <button class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('feishu')">
                      {{ showKey.feishu ? '隐藏' : '显示' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 钉钉推送暂时停用 -->
            <!-- <div class="rounded border border-gray-200 bg-white p-5">
              <h3 class="mb-4 text-sm font-bold">钉钉</h3>
              <div class="space-y-4">
                <div>
                  <label class="mb-1 block text-xs text-gray-500">Webhook URL</label>
                  <input v-model="dingtalk.webhookUrl" type="text" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-gray-500">签名密钥（可选）</label>
                  <div class="relative">
                    <input v-model="dingtalk.secret" :type="showKey.dingtalk ? 'text' : 'password'" placeholder="SEC..." class="w-full rounded border border-gray-300 px-3 py-1.5 pr-16 text-sm outline-none focus:border-gray-500" />
                    <button class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('dingtalk')">
                      {{ showKey.dingtalk ? '隐藏' : '显示' }}
                    </button>
                  </div>
                </div>
              </div>
            </div> -->

            <div class="rounded border border-gray-200 bg-white p-5">
              <div class="mb-4 flex items-center justify-between">
                <h3 class="text-sm font-bold">邮件</h3>
                <button
                  class="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  :disabled="testing !== ''"
                  @click="sendTest('email')"
                >
                  {{ testing === 'email' ? '发送中...' : '发送测试' }}
                </button>
              </div>
              <div v-if="testResult.email" class="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                {{ testResult.email }}
              </div>
              <div class="space-y-4">
                <div class="flex gap-3">
                  <div class="flex-1">
                    <label class="mb-1 block text-xs text-gray-500">SMTP 服务器</label>
                    <input v-model="email.smtpHost" type="text" placeholder="smtp.qq.com" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
                  </div>
                  <div class="w-24">
                    <label class="mb-1 block text-xs text-gray-500">端口</label>
                    <input v-model="email.smtpPort" type="text" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-xs text-gray-500">发件人邮箱</label>
                  <input v-model="email.from" type="email" placeholder="your@email.com" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-gray-500">授权码</label>
                  <div class="relative">
                    <input v-model="email.password" :type="showKey.email ? 'text' : 'password'" placeholder="邮箱授权码（非登录密码）" class="w-full rounded border border-gray-300 px-3 py-1.5 pr-16 text-sm outline-none focus:border-gray-500" />
                    <button class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('email')">
                      {{ showKey.email ? '隐藏' : '显示' }}
                    </button>
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-xs text-gray-500">收件人邮箱</label>
                  <input v-model="email.to" type="email" placeholder="receiver@email.com" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500" />
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'search'">
          <div class="rounded border border-gray-200 bg-white p-5">
            <h3 class="mb-4 text-sm font-bold">搜索配置</h3>
            <div class="space-y-4">
              <div>
                <label class="mb-1 block text-xs text-gray-500">搜索提供商</label>
                <select v-model="search.provider" class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500">
                  <option value="tavily">Tavily</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block text-xs text-gray-500">API Key</label>
                <div class="relative">
                  <input v-model="search.apiKey" :type="showKey.search ? 'text' : 'password'" placeholder="tvly-..." class="w-full rounded border border-gray-300 px-3 py-1.5 pr-16 text-sm outline-none focus:border-gray-500" />
                  <button class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600" @click="toggleKey('search')">
                    {{ showKey.search ? '隐藏' : '显示' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div class="mt-4 flex justify-end">
          <button
            class="rounded bg-gray-800 px-4 py-1.5 text-xs text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
