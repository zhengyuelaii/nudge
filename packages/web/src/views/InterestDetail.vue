<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';

const route = useRoute();
const router = useRouter();
const interestId = Number(route.params.id);

interface Interest {
  id: number;
  name: string;
  category: string;
  description: string | null;
  query_keywords: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  task_id: number;
  frequency: string;
  time: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface Update {
  id: number;
  title: string;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  importance: number;
  has_progress: number;
  created_at: string;
  is_read: number;
}

interface TaskRun {
  id: number;
  status: string;
  started_at: string;
  duration_ms: number | null;
  search_query: string | null;
  search_result_count: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  error_type: string | null;
  error_message: string | null;
}

const interest = ref<Interest | null>(null);
const updates = ref<Update[]>([]);
const runs = ref<TaskRun[]>([]);
const loading = ref(true);
const checking = ref(false);
const checkResult = ref('');
const showEditModal = ref(false);
const showDeleteConfirm = ref(false);

const form = ref({
  name: '',
  category: 'tech',
  description: '',
  queryKeywords: '',
  frequency: 'day',
  time: '09:00',
});

const categories = [
  { key: 'company', label: '公司' },
  { key: 'policy', label: '政策' },
  { key: 'tech', label: '技术' },
  { key: 'game', label: '游戏' },
  { key: 'finance', label: '财经' },
];

const categoryColor: Record<string, string> = {
  company: 'bg-blue-100 text-blue-700',
  policy: 'bg-amber-100 text-amber-700',
  tech: 'bg-green-100 text-green-700',
  game: 'bg-purple-100 text-purple-700',
  finance: 'bg-blue-100 text-blue-700',
};

const categoryLabel: Record<string, string> = {
  company: '公司',
  policy: '政策',
  tech: '技术',
  game: '游戏',
  finance: '财经',
};

const importanceBadge = (n: number) => {
  if (n >= 8) return 'bg-red-100 text-red-700';
  if (n >= 6) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
};

const runStatusLabel: Record<string, { text: string; cls: string }> = {
  success: { text: '成功', cls: 'bg-green-100 text-green-700' },
  partial: { text: '部分成功', cls: 'bg-amber-100 text-amber-700' },
  failed: { text: '失败', cls: 'bg-red-100 text-red-700' },
  running: { text: '执行中', cls: 'bg-blue-100 text-blue-700' },
};

const runStatusBadge = (status: string) =>
  runStatusLabel[status] ?? { text: status, cls: 'bg-gray-100 text-gray-500' };

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}小时前`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}天前`;
}

function goBack() {
  router.back();
}

async function loadData() {
  loading.value = true;
  try {
    const [i, u, r] = await Promise.all([
      api.get<Interest>(`/interests/${interestId}`),
      api.get<Update[]>(`/updates?interest_id=${interestId}`),
      api.get<TaskRun[]>(`/task-runs?interest_id=${interestId}&limit=10`),
    ]);
    interest.value = i;
    updates.value = u;
    runs.value = r;
  } catch (e: any) {
    alert('加载失败: ' + e.message);
    router.push('/interests');
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

async function loadRuns() {
  try {
    runs.value = await api.get<TaskRun[]>(`/task-runs?interest_id=${interestId}&limit=10`);
  } catch (e) {
    console.error('加载执行历史失败:', e);
  }
}

async function triggerCheck() {
  if (checking.value) return;
  checking.value = true;
  checkResult.value = '';
  try {
    const r = await api.post<{ createdCount: number; notifiedCount: number }>(
      `/interests/${interestId}/check`,
      {},
    );
    checkResult.value = `检查完成：新增 ${r.createdCount} 条动态，已通知 ${r.notifiedCount} 条`;
    await Promise.all([loadData(), loadRuns()]);
  } catch (e: any) {
    alert('检查失败: ' + e.message);
  } finally {
    checking.value = false;
  }
}

function openEdit() {
  if (!interest.value) return;
  form.value = {
    name: interest.value.name,
    category: interest.value.category,
    description: interest.value.description ?? '',
    queryKeywords: interest.value.query_keywords ?? '',
    frequency: interest.value.frequency,
    time: interest.value.time,
  };
  showEditModal.value = true;
}

async function save() {
  if (!form.value.name.trim()) return;
  try {
    await api.put(`/interests/${interestId}`, {
      name: form.value.name,
      category: form.value.category,
      description: form.value.description || undefined,
      queryKeywords: form.value.queryKeywords || undefined,
      frequency: form.value.frequency,
      time: form.value.time,
    });
    await loadData();
    showEditModal.value = false;
  } catch (e: any) {
    alert('保存失败: ' + e.message);
  }
}

async function doDelete() {
  try {
    await api.delete(`/interests/${interestId}`);
    router.push('/interests');
  } catch (e: any) {
    alert('删除失败: ' + e.message);
  }
  showDeleteConfirm.value = false;
}

async function toggleEnabled() {
  if (!interest.value) return;
  try {
    await api.put(`/interests/${interestId}/toggle`);
    await loadData();
  } catch (e: any) {
    alert('切换失败: ' + e.message);
  }
}

function formatSchedule(item: Interest) {
  return `${item.frequency === 'day' ? '每天' : '每周'} ${item.time}`;
}
</script>

<template>
  <div>
    <button
      class="mb-3 inline-flex cursor-pointer items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-800"
      @click="goBack"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
      </svg>
      返回
    </button>

    <div v-if="loading" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">加载中...</div>

    <template v-else-if="interest">
      <div class="mb-4 border-b border-gray-200 pb-2">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-bold">{{ interest.name }}</h2>
            <div class="mt-1 flex items-center gap-2 text-xs text-gray-400">
              <span class="rounded px-1.5 py-0.5 text-[11px]" :class="categoryColor[interest.category]">
                {{ categoryLabel[interest.category] ?? interest.category }}
              </span>
              <span>{{ formatSchedule(interest) }}</span>
              <span v-if="interest.last_run_at">上次执行: {{ timeAgo(interest.last_run_at) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="inline-flex items-center gap-1 rounded bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
              :disabled="checking"
              @click="triggerCheck"
            >
              <span v-if="checking" class="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
              {{ checking ? '检查中...' : '立即检查' }}
            </button>
            <button
              class="relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200"
              :class="interest.enabled ? 'bg-green-500' : 'bg-gray-300'"
              :title="interest.enabled ? '已启用' : '已禁用'"
              @click="toggleEnabled"
            >
              <span
                class="absolute top-[2px] left-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200"
                :class="interest.enabled ? 'translate-x-[14px]' : 'translate-x-0'"
              />
            </button>
            <button
              class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:text-gray-600"
              title="编辑"
              @click="openEdit"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
              </svg>
            </button>
            <button
              class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:text-red-500"
              title="删除"
              @click="showDeleteConfirm = true"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="checkResult" class="mb-4 rounded border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700">
        {{ checkResult }}
      </div>

      <div class="mb-4 grid grid-cols-2 gap-3">
        <div class="rounded border border-gray-200 bg-white px-4 py-3">
          <div class="text-xs text-gray-400">搜索关键词</div>
          <div class="mt-1 text-sm text-gray-700">{{ interest.query_keywords ?? interest.name }}</div>
        </div>
        <div class="rounded border border-gray-200 bg-white px-4 py-3">
          <div class="text-xs text-gray-400">下次执行</div>
          <div class="mt-1 text-sm text-gray-700">{{ interest.next_run_at ?? '未调度' }}</div>
        </div>
      </div>

      <div v-if="interest.description" class="mb-4 rounded border border-gray-200 bg-white px-4 py-3">
        <div class="text-xs text-gray-400">备注</div>
        <div class="mt-1 text-sm text-gray-700">{{ interest.description }}</div>
      </div>

      <div class="mb-3 border-b border-gray-200 pb-2">
        <h3 class="text-sm font-bold text-gray-700">相关动态 ({{ updates.length }})</h3>
      </div>

      <div v-if="updates.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        暂无相关动态
      </div>

      <div v-else class="overflow-hidden rounded border border-gray-200 bg-white">
        <div
          v-for="(item, idx) in updates"
          :key="item.id"
          class="flex gap-5 px-5 py-4"
          :class="idx > 0 ? 'border-t border-gray-100' : ''"
        >
          <div class="relative flex shrink-0 flex-col items-center pt-1">
            <span
              class="z-10 h-3 w-3 rounded-full ring-4 ring-white"
              :class="item.importance >= 7 ? 'bg-green-500' : 'bg-gray-300'"
            />
            <div v-if="idx < updates.length - 1" class="mt-1 w-px flex-1 bg-gray-200" />
          </div>
          <div class="min-w-0 flex-1 pb-1">
            <div class="mb-1 flex items-center gap-2">
              <span class="text-xs text-gray-400">{{ timeAgo(item.created_at) }}</span>
              <span class="rounded px-1.5 py-0.5 text-[11px]" :class="importanceBadge(item.importance)">
                {{ item.importance }}分
              </span>
              <span
                v-if="item.has_progress"
                class="rounded bg-green-100 px-1.5 py-0.5 text-[11px] text-green-700"
              >
                有进展
              </span>
            </div>
            <h3 class="text-sm font-medium leading-snug text-gray-900">{{ item.title }}</h3>
            <div v-if="item.summary" class="mt-1 text-xs leading-relaxed text-gray-500">{{ item.summary }}</div>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
              <span>{{ item.source_name ?? '未知来源' }}</span>
              <a v-if="item.source_url" :href="item.source_url" target="_blank" class="text-blue-500 hover:underline">原文</a>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-3 mt-8 border-b border-gray-200 pb-2">
        <h3 class="text-sm font-bold text-gray-700">执行历史 ({{ runs.length }})</h3>
      </div>

      <div v-if="runs.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        暂无执行记录
      </div>

      <div v-else class="overflow-hidden rounded border border-gray-200 bg-white">
        <div
          v-for="(run, idx) in runs"
          :key="run.id"
          class="flex items-center gap-4 px-5 py-3"
          :class="idx > 0 ? 'border-t border-gray-100' : ''"
        >
          <span class="w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px]" :class="runStatusBadge(run.status).cls">
            {{ runStatusBadge(run.status).text }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs text-gray-600">{{ run.search_query ?? '—' }}</div>
            <div class="text-[11px] text-gray-400">
              {{ timeAgo(run.started_at) }} · {{ run.duration_ms != null ? (run.duration_ms / 1000).toFixed(1) + 's' : '—' }}
              · 搜索结果 {{ run.search_result_count ?? 0 }} 条
              <template v-if="run.llm_input_tokens != null">
                · 输入 {{ run.llm_input_tokens }} / 输出 {{ run.llm_output_tokens ?? 0 }} tok
              </template>
            </div>
            <div v-if="run.error_message" class="truncate text-[11px] text-red-500">{{ run.error_message }}</div>
          </div>
          <span class="text-[11px] text-gray-400">#{{ run.id }}</span>
        </div>
      </div>
    </template>

    <!-- 编辑弹窗 -->
    <Teleport to="body">
      <div v-if="showEditModal" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-white/30 backdrop-blur-sm" @click="showEditModal = false"></div>
        <div class="relative bg-white rounded-lg p-6 w-[420px] shadow-lg border border-gray-200">
          <h3 class="text-lg font-bold text-gray-900 mb-1">编辑兴趣</h3>
          <p class="text-xs text-gray-500 mb-4">修改兴趣的基本信息和检查频率</p>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">兴趣名称</label>
              <input
                v-model="form.name"
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <div class="flex gap-2 mt-1">
                <span
                  v-for="cat in categories"
                  :key="cat.key"
                  :class="[
                    'inline-flex items-center rounded-md px-2.5 py-0.5 text-sm border cursor-pointer transition-colors',
                    form.category === cat.key
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  ]"
                  @click="form.category = cat.key"
                >
                  {{ cat.label }}
                </span>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">搜索关键词（可选）</label>
              <input
                v-model="form.queryKeywords"
                placeholder="留空则使用名称"
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">检查频率</label>
                <select
                  v-model="form.frequency"
                  class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="day">每天</option>
                  <option value="week">每周</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">执行时间</label>
                <input
                  v-model="form.time"
                  type="time"
                  class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-3 mt-5">
            <button
              @click="showEditModal = false"
              class="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              @click="save"
              :disabled="form.name.trim() === ''"
              class="inline-flex items-center rounded-md bg-blue-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-white/30 backdrop-blur-sm" @click="showDeleteConfirm = false"></div>
        <div class="relative bg-white rounded-lg p-6 w-[340px] shadow-lg border border-gray-200">
          <h3 class="text-lg font-bold text-gray-900 mb-1">确认删除</h3>
          <p class="text-sm text-gray-500 mb-5">确定要删除这个兴趣吗？删除后无法恢复。</p>
          <div class="flex justify-end gap-3">
            <button
              @click="showDeleteConfirm = false"
              class="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              @click="doDelete"
              class="inline-flex items-center rounded-md bg-red-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-600"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
