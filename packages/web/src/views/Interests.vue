<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/index.js';
import { useTags } from '../composables/useTags.js';

const { tags, label, color } = useTags();

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

const form = ref({
  name: '',
  category: 'tech' as string,
  frequency: 'day' as 'day' | 'week',
  time: '09:00',
  description: '',
  queryKeywords: '',
});

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
  form.value = { name: '', category: 'tech', frequency: 'day', time: '09:00', description: '', queryKeywords: '' };
  showModal.value = true;
}

async function save() {
  if (!form.value.name.trim()) return;
  try {
    await api.post('/interests', {
      name: form.value.name,
      category: form.value.category,
      frequency: form.value.frequency,
      time: form.value.time,
      description: form.value.description || undefined,
      queryKeywords: form.value.queryKeywords || undefined,
    });
    await loadInterests();
    showModal.value = false;
  } catch (e: any) {
    alert('保存失败: ' + e.message);
  }
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
            <span class="rounded px-1.5 py-0.5 text-[11px]" :class="color(item.category)">
              {{ label(item.category) }}
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
        </div>
      </div>
    </div>

    <!-- 添加弹窗 -->
    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-white/30 backdrop-blur-sm" @click="showModal = false"></div>
        <div class="relative bg-white rounded-lg p-6 w-[420px] shadow-lg border border-gray-200">
          <h3 class="text-lg font-bold text-gray-900 mb-1">添加兴趣</h3>
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
                  v-for="cat in tags"
                  :key="cat.code"
                  :class="[
                    'inline-flex items-center rounded-md px-2.5 py-0.5 text-sm border cursor-pointer transition-colors',
                    form.category === cat.code
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  ]"
                  @click="form.category = cat.code"
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
  </div>
</template>
