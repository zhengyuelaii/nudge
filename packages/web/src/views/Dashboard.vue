<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/index.js';

interface Update {
  id: number;
  title: string;
  source_name: string | null;
  interest_category: string | null;
  interest_name: string | null;
  importance: number;
  has_progress: number;
  created_at: string;
  is_read: number;
}

const categories = ['finance', 'tech', 'policy', 'game', 'company'];
const activeCategory = ref('all');
const updates = ref<Update[]>([]);
const loading = ref(true);

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
    updates.value = await api.get<Update[]>('/updates?limit=50');
  } catch (e) {
    console.error('加载失败:', e);
  } finally {
    loading.value = false;
  }
});

const filteredUpdates = computed(() => {
  if (activeCategory.value === 'all') return updates.value;
  return updates.value.filter((u) => u.interest_category === activeCategory.value);
});
</script>

<template>
  <div>
    <div class="mb-3 flex items-center gap-0.5 border-b border-gray-200 pb-2">
      <button
        class="rounded px-2.5 py-0.5 text-xs transition-colors"
        :class="activeCategory === 'all' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-200'"
        @click="activeCategory = 'all'"
      >
        全部
      </button>
      <button
        v-for="cat in categories"
        :key="cat"
        class="rounded px-2.5 py-0.5 text-xs transition-colors"
        :class="activeCategory === cat ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-200'"
        @click="activeCategory = cat"
      >
        {{ categoryLabel[cat] }}
      </button>
    </div>

    <div v-if="loading" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">加载中...</div>

    <div v-else-if="filteredUpdates.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
      暂无动态
    </div>

    <div v-else class="divide-y divide-gray-200 border border-gray-200 bg-white">
      <div
        v-for="item in filteredUpdates"
        :key="item.id"
        class="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-gray-50"
      >
        <div class="leading-snug">
          <span class="font-medium text-gray-900">{{ item.title }}</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-400">
          <span>{{ item.source_name ?? '未知来源' }}</span>
          <span v-if="item.interest_category" class="rounded px-1.5 py-0.5 text-[11px]" :class="categoryColor[item.interest_category]">
            {{ categoryLabel[item.interest_category] ?? item.interest_category }}
          </span>
          <span v-if="item.importance >= 7" class="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">
            {{ item.importance }}分
          </span>
          <span v-if="item.has_progress" class="rounded bg-green-100 px-1.5 py-0.5 text-[11px] text-green-700">
            有进展
          </span>
          <span class="ml-auto">{{ timeAgo(item.created_at) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
