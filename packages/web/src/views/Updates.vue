<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { CircleDotIcon, ExternalLinkIcon } from "@lucide/vue";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Timeline } from "@/components/timeline";
import { api } from '@/api/index.js';
import { formatDateTime, formatDate } from '@/lib/time';

interface Source {
  id: number;
  title: string;
  summary: string | null;
  source_url: string | null;
  source_name: string | null;
  published_at: string | null;
  created_at: string;
}

interface InterestEvent {
  id: number;
  interest_id: number;
  task_run_id: number | null;
  title: string;
  run_at: string;
  source_count: number;
  summary: string | null;
  created_at: string;
  interest_name: string | null;
  sources: Source[];
}

interface Interest {
  id: number;
  name: string;
}

function openUrl(url: string | null) {
  if (url) window.open(url, "_blank", "noopener");
}

let lastDay = "";

const interests = ref<Interest[]>([]);
const selectedInterestId = ref<number>(0);
const events = ref<InterestEvent[]>([]);
const loading = ref(true);

async function loadInterests() {
  try {
    const data = await api.get<Interest[]>("/interests");
    interests.value = data;
    if (data.length > 0 && selectedInterestId.value === 0) {
      selectedInterestId.value = data[0].id;
    }
  } catch (e) {
    console.error("加载兴趣列表失败:", e);
  }
}

async function loadEvents() {
  if (selectedInterestId.value === 0) return;
  loading.value = true;
  try {
    const data = await api.get<InterestEvent[]>(`/events?interest_id=${selectedInterestId.value}`);
    events.value = data;
  } catch (e) {
    console.error("加载动态失败:", e);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadInterests();
  await loadEvents();
});

watch(selectedInterestId, () => {
  lastDay = "";
  loadEvents();
});
</script>

<template>
  <div class="p-4">
    <h2 class="mb-3 text-base font-bold">动态</h2>
    <div class="mb-6">
      <Select v-model="selectedInterestId">
        <SelectTrigger class="w-full">
          <SelectValue placeholder="选择一个兴趣点..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="item in interests" :key="item.id" :value="item.id">
            {{ item.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="loading" class="space-y-4">
      <div v-for="i in 3" :key="i" class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div class="mb-2 h-4 w-3/4 animate-pulse rounded bg-gray-200"></div>
        <div class="h-3 w-1/2 animate-pulse rounded bg-gray-100"></div>
      </div>
    </div>

    <Timeline.Root v-else class="w-full list-none p-0">
      <Timeline.Item
        v-for="(event, index) in events"
        :key="event.id"
        class="animate-in fade-in slide-in-from-left-4 fill-mode-both duration-500"
        :style="{ animationDelay: `${index * 60}ms` }"
      >
        <Timeline.Media variant="icon">
          <CircleDotIcon class="size-4 text-emerald-500" />
        </Timeline.Media>

        <Timeline.Content>
          <div v-if="formatDate(event.run_at) !== lastDay && (lastDay = formatDate(event.run_at))" class="mb-2 flex h-8 items-center text-xs font-medium text-muted-foreground">
            {{ formatDate(event.run_at) }}
          </div>
          <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 class="text-sm font-semibold text-gray-900">{{ event.title }}</h3>
            <p v-if="event.summary" class="mt-1 text-xs leading-relaxed text-gray-500">{{ event.summary }}</p>
            <div class="mt-2 text-[11px] text-gray-400">{{ formatDateTime(event.run_at) }}</div>
            <div v-if="event.sources.length > 0" class="mt-3 space-y-1 border-t border-gray-100 pt-3">
              <div
                v-for="src in event.sources"
                :key="src.id"
                class="flex items-center gap-1.5 text-xs"
              >
                <span class="text-gray-400">›</span>
                <span class="font-medium text-gray-700">{{ src.source_name ?? '未知来源' }}</span>
                <span class="text-gray-400">-</span>
                <span
                  class="min-w-0 truncate text-gray-500"
                  :class="src.source_url ? 'cursor-pointer hover:text-gray-900' : ''"
                  @click="openUrl(src.source_url)"
                >{{ src.title }}</span>
                <ExternalLinkIcon v-if="src.source_url" class="size-3 shrink-0 text-gray-300" />
              </div>
            </div>
          </div>
        </Timeline.Content>
      </Timeline.Item>
    </Timeline.Root>

    <div v-if="!loading && events.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
      暂无动态
    </div>
  </div>
</template>
