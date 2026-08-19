<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/index.js';

const router = useRouter();

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
  frequency: 'day' | 'week';
  time: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
}

const interests = ref<Interest[]>([]);
const loading = ref(true);
const showModal = ref(false);
const showDeleteConfirm = ref(false);
const editingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);

const form = ref({
  name: '',
  category: 'tech' as string,
  frequency: 'day' as 'day' | 'week',
  time: '09:00',
  description: '',
  queryKeywords: '',
});

const categories: { key: string; label: string }[] = [
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

async function loadInterests() {
  loading.value = true;
  try {
    interests.value = await api.get<Interest[]>('/interests');
  } catch (e) {
    console.error('加载失败:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadInterests);

function openAdd() {
  editingId.value = null;
  form.value = { name: '', category: 'tech', frequency: 'day', time: '09:00', description: '', queryKeywords: '' };
  showModal.value = true;
}

function openEdit(item: Interest) {
  editingId.value = item.id;
  form.value = {
    name: item.name,
    category: item.category,
    frequency: item.frequency,
    time: item.time,
    description: item.description ?? '',
    queryKeywords: item.query_keywords ?? '',
  };
  showModal.value = true;
}

async function save() {
  if (!form.value.name.trim()) return;
  try {
    if (editingId.value !== null) {
      await api.put(`/interests/${editingId.value}`, {
        name: form.value.name,
        category: form.value.category,
        frequency: form.value.frequency,
        time: form.value.time,
        description: form.value.description || undefined,
        queryKeywords: form.value.queryKeywords || undefined,
      });
    } else {
      await api.post('/interests', {
        name: form.value.name,
        category: form.value.category,
        frequency: form.value.frequency,
        time: form.value.time,
        description: form.value.description || undefined,
        queryKeywords: form.value.queryKeywords || undefined,
      });
    }
    await loadInterests();
    showModal.value = false;
  } catch (e: any) {
    alert('保存失败: ' + e.message);
  }
}

function confirmDelete(id: number) {
  deletingId.value = id;
  showDeleteConfirm.value = true;
}

async function doDelete() {
  if (deletingId.value !== null) {
    try {
      await api.delete(`/interests/${deletingId.value}`);
      await loadInterests();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  }
  showDeleteConfirm.value = false;
  deletingId.value = null;
}

async function toggleEnabled(item: Interest) {
  try {
    await api.put(`/interests/${item.id}/toggle`);
    await loadInterests();
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
    <div class="mb-4 flex items-center justify-between border-b border-gray-200 pb-2">
      <h2 class="text-base font-bold">兴趣</h2>
      <button
        @click="openAdd"
        class="inline-flex items-center rounded-md bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
      >
        + 添加兴趣
      </button>
    </div>

    <div v-if="loading" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">加载中...</div>

    <div v-else-if="interests.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
      暂无兴趣点，点击上方按钮添加
    </div>

    <div v-else class="divide-y divide-gray-200 border border-gray-200 bg-white">
      <div
        v-for="item in interests"
        :key="item.id"
        class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
      >
        <div class="min-w-0 flex-1">
          <div class="cursor-pointer truncate font-medium text-gray-900 hover:text-blue-600" @click="router.push(`/interests/${item.id}`)">{{ item.name }}</div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
            <span>{{ formatSchedule(item) }}</span>
            <span class="rounded px-1.5 py-0.5 text-[11px]" :class="categoryColor[item.category]">
              {{ categoryLabel[item.category] ?? item.category }}
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            class="relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200"
            :class="item.enabled ? 'bg-green-500' : 'bg-gray-300'"
            :title="item.enabled ? '已启用' : '已禁用'"
            @click="toggleEnabled(item)"
          >
            <span
              class="absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200"
              :class="item.enabled ? 'translate-x-[14px]' : 'translate-x-0'"
            />
          </button>
          <button
            class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:text-gray-600"
            title="编辑"
            @click="openEdit(item)"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
            </svg>
          </button>
          <button
            class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:text-red-500"
            title="删除"
            @click="confirmDelete(item.id)"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑弹窗 -->
    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-white/30 backdrop-blur-sm" @click="showModal = false"></div>
        <div class="relative bg-white rounded-lg p-6 w-[420px] shadow-lg border border-gray-200">
          <h3 class="text-lg font-bold text-gray-900 mb-1">{{ editingId !== null ? '编辑兴趣' : '添加兴趣' }}</h3>
          <p class="text-xs text-gray-500 mb-4">配置兴趣的基本信息和检查频率</p>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">兴趣名称</label>
              <input
                v-model="form.name"
                placeholder="输入兴趣描述..."
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
              @click="showModal = false"
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
