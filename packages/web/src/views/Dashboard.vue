<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api/index.js';
import { Badge } from '@/components/ui/badge';

interface Update {
  id: number;
  title: string;
  source_name: string | null;
  source_url: string | null;
  interest_tags: string[];
  interest_name: string | null;
  importance: number;
  has_progress: number;
  created_at: string;
  is_read: number;
}

const activeTag = ref('all');
const updates = ref<Update[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const finished = ref(false);
const sentinel = ref<HTMLElement | null>(null);
const PAGE_SIZE = 20;
let pageOffset = 0;
let observer: IntersectionObserver | null = null;

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

async function loadMore() {
  if (loadingMore.value || finished.value) return;
  loadingMore.value = true;
  try {
    const suffix = pageOffset > 0 ? `&offset=${pageOffset}` : '';
    const data = await api.get<Update[]>(`/updates?limit=${PAGE_SIZE}${suffix}`);
    updates.value.push(...data);
    if (data.length < PAGE_SIZE) {
      finished.value = true;
    } else {
      pageOffset += data.length;
    }
  } catch (e) {
    console.error('加载失败:', e);
  } finally {
    loadingMore.value = false;
    loading.value = false;
  }
}

onMounted(async () => {
  await loadMore();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) void loadMore();
    },
    { rootMargin: '200px 0px' },
  );
  if (sentinel.value) observer.observe(sentinel.value);
});

onBeforeUnmount(() => observer?.disconnect());

const filteredCategories = computed(() => {
  const tags = new Set<string>();
  for (const u of updates.value) {
    for (const t of u.interest_tags) tags.add(t);
  }
  return [...tags];
});

const filteredUpdates = computed(() => {
  if (activeTag.value === 'all') return updates.value;
  return updates.value.filter((u) => u.interest_tags.includes(activeTag.value));
});

function openOriginal(item: Update) {
  if (!item.source_url) return;
  window.open(item.source_url, '_blank', 'noopener');
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center gap-0.5 border-b border-gray-200 pb-2">
      <button
        class="cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors"
        :class="activeTag === 'all' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-200'"
        @click="activeTag = 'all'"
      >
        全部
      </button>
      <button
        v-for="tag in filteredCategories"
        :key="tag"
        class="cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors"
        :class="activeTag === tag ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-200'"
        @click="activeTag = tag"
      >
        {{ tag }}
      </button>
    </div>

    <div v-if="loading" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">加载中...</div>

    <div v-else-if="filteredUpdates.length === 0 && finished" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
      暂无动态
    </div>

    <div v-else class="divide-y divide-gray-200 border border-gray-200 bg-white">
      <div
        v-for="item in filteredUpdates"
        :key="item.id"
        class="flex cursor-pointer flex-col gap-1 px-4 py-3 transition-colors hover:bg-gray-50"
        :class="item.source_url ? '' : 'cursor-default'"
        @click="openOriginal(item)"
      >
        <div class="flex items-start gap-1 leading-snug">
          <span class="font-medium text-gray-900">{{ item.title }}</span>
          <span v-if="item.source_url" class="shrink-0 select-none text-xs text-gray-300">↗</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-400">
          <span>{{ item.source_name ?? '未知来源' }}</span>
          <Badge v-if="item.importance >= 7" variant="destructive">
            {{ item.importance }}分
          </Badge>
          <Badge v-if="item.has_progress" variant="secondary" class="text-green-700">
            有进展
          </Badge>
          <span class="ml-auto">{{ timeAgo(item.created_at) }}</span>
        </div>
      </div>
    </div>

    <div ref="sentinel" class="py-3"></div>
    <div v-if="loadingMore" class="pb-4 text-center text-xs text-gray-400">加载中...</div>
    <div v-else-if="finished && updates.length > 0" class="pb-4 text-center text-xs text-gray-400">
      已经到底啦，没有更多了
    </div>
  </div>
</template>
