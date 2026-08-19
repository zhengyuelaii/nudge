<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { api } from '../api/index.js';

interface Interest {
  id: number;
  name: string;
}

interface Update {
  id: number;
  title: string;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  interest_category: string | null;
  importance: number;
  has_progress: number;
  published_at: string | null;
  created_at: string;
  is_read: number;
}

const interests = ref<Interest[]>([]);
const selectedInterestId = ref<number | null>(null);
const updates = ref<Update[]>([]);
const loadingInterests = ref(true);
const loadingUpdates = ref(false);

const categoryLabel: Record<string, string> = {
  finance: '财经',
  tech: '科技',
  policy: '政策',
  game: '游戏',
  company: '公司',
};

const categoryColor: Record<string, string> = {
  finance: 'bg-blue-100 text-blue-700',
  policy: 'bg-amber-100 text-amber-700',
  tech: 'bg-green-100 text-green-700',
  game: 'bg-purple-100 text-purple-700',
  company: 'bg-blue-100 text-blue-700',
};

const importanceBadge = (n: number) => {
  if (n >= 8) return 'bg-red-100 text-red-700';
  if (n >= 6) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}天前`;
  return `${Math.floor(diffD / 7)}周前`;
}

onMounted(async () => {
  try {
    interests.value = await api.get<Interest[]>('/interests');
  } catch (e) {
    console.error('加载兴趣失败:', e);
  } finally {
    loadingInterests.value = false;
  }
});

watch(selectedInterestId, async (id) => {
  if (!id) { updates.value = []; return; }
  loadingUpdates.value = true;
  try {
    updates.value = await api.get<Update[]>(`/updates?interest_id=${id}`);
  } catch (e) {
    console.error('加载更新失败:', e);
  } finally {
    loadingUpdates.value = false;
  }
});
</script>

<template>
  <div>
    <div class="mb-3 border-b border-gray-200 pb-2">
      <h2 class="mb-2 text-base font-bold">动态</h2>
      <select
        v-model="selectedInterestId"
        class="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-500"
      >
        <option :value="null" disabled>选择一个兴趣点...</option>
        <option v-for="item in interests" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
    </div>

    <div v-if="!selectedInterestId" class="border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
      请选择一个兴趣点查看动态
    </div>

    <div v-else-if="loadingUpdates" class="border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">加载中...</div>

    <div v-else-if="updates.length === 0" class="border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
      暂无更新记录
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
            <span v-if="item.has_progress" class="rounded bg-green-100 px-1.5 py-0.5 text-[11px] text-green-700">
              有进展
            </span>
          </div>
          <h3 class="text-sm font-medium leading-snug text-gray-900">{{ item.title }}</h3>
          <div v-if="item.summary" class="mt-1 text-xs leading-relaxed text-gray-500">{{ item.summary }}</div>
          <div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span>{{ item.source_name ?? '未知来源' }}</span>
            <span v-if="item.source_url" class="text-gray-300">|</span>
            <a v-if="item.source_url" :href="item.source_url" target="_blank" class="text-blue-500 hover:underline">原文</a>
            <span v-if="item.interest_category" class="text-gray-300">|</span>
            <span v-if="item.interest_category" class="rounded px-1.5 py-0.5 text-[11px]" :class="categoryColor[item.interest_category]">
              {{ categoryLabel[item.interest_category] ?? item.interest_category }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
