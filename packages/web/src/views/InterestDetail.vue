<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';
import CategoryInput from '../components/CategoryInput.vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const route = useRoute();
const router = useRouter();
const interestId = Number(route.params.id);

interface Interest {
  id: number;
  name: string;
  tags: string[];
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
  channelIds: number[];
}

interface Channel {
  id: number;
  type: string;
  name: string;
  enabled: number;
  is_default: number;
}

interface Source {
  id: number;
  title: string;
  summary: string | null;
  source_url: string | null;
  source_name: string | null;
  published_at: string | null;
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

interface TaskRun {
  id: number;
  status: string;
  started_at: string;
  duration_ms: number | null;
  search_result_count: number | null;
  sources_created_count: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  error_type: string | null;
  error_message: string | null;
}

type RunStatusFilter = '' | 'success' | 'failed' | 'running';

const interest = ref<Interest | null>(null);
const events = ref<InterestEvent[]>([]);
const latestEvents = computed(() => events.value.slice(0, 3));

const formErrors = computed<{ name?: string; tags?: string; time?: string }>(() => {
  const e: { name?: string; tags?: string; time?: string } = {};
  if (!form.value.name.trim()) e.name = '请输入兴趣名称';
  if (form.value.tags.length === 0) e.tags = '请至少添加一个分类';
  if (!form.value.time || !/^\d{2}:\d{2}$/.test(form.value.time)) e.time = '请选择有效的执行时间';
  return e;
});
const hasErrors = computed(() => Object.keys(formErrors.value).length > 0);
const runs = ref<TaskRun[]>([]);
const runsTotal = ref(0);
const statusFilter = ref<RunStatusFilter>('');
const runsOffset = ref(0);
const loadingMore = ref(false);
const PAGE_SIZE = 10;
const loading = ref(true);
const checking = ref(false);
const saving = ref(false);
const submitAttempted = ref(false);
const checkResult = ref('');
const showDeleteConfirm = ref(false);
const existingTags = ref<string[]>([]);
const channels = ref<Channel[]>([]);

const form = ref({
  name: '',
  tags: [] as string[],
  description: '',
  queryKeywords: '',
  frequency: 'day',
  time: '09:00',
  channelIds: [] as number[],
});

const runStatusLabel: Record<string, { text: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  success: { text: '成功', variant: 'secondary' },
  failed: { text: '失败', variant: 'destructive' },
  running: { text: '执行中', variant: 'outline' },
};

const runStatusBadge = (status: string) =>
  runStatusLabel[status] ?? { text: status, variant: 'secondary' as const };

const statusTabs: { key: RunStatusFilter; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'success', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'running', label: '执行中' },
];

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
  submitAttempted.value = false;
  try {
    const [i, u, tags, chs] = await Promise.all([
      api.get<Interest>(`/interests/${interestId}`),
      api.get<InterestEvent[]>(`/events?interest_id=${interestId}`),
      api.get<string[]>('/interests/tags'),
      api.get<Channel[]>('/notification-channels'),
    ]);
    interest.value = i;
    events.value = u;
    existingTags.value = tags;
    channels.value = chs;
    form.value = {
      name: i.name,
      tags: i.tags,
      description: i.description ?? '',
      queryKeywords: i.query_keywords ?? '',
      frequency: i.frequency,
      time: i.time,
      channelIds: Array.isArray(i.channelIds) ? i.channelIds : [],
    };
    await loadRuns(true);
  } catch (e: any) {
    toast.error('加载失败: ' + e.message);
    router.push('/interests');
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

async function loadRuns(reset = false) {
  if (reset) {
    runsOffset.value = 0;
    runs.value = [];
  } else {
    loadingMore.value = true;
  }
  const params = new URLSearchParams({
    interest_id: String(interestId),
    limit: String(PAGE_SIZE),
    offset: String(runsOffset.value),
  });
  if (statusFilter.value) params.set('status', statusFilter.value);
  try {
    const body = await api.get<{ list: TaskRun[]; total: number }>(`/task-runs?${params}`);
    runs.value = reset ? body.list : [...runs.value, ...body.list];
    runsOffset.value += body.list.length;
    runsTotal.value = body.total;
  } catch (e: any) {
    if (reset) {
      console.error('加载执行历史失败:', e);
    } else {
      toast.error('加载更多失败: ' + e.message);
    }
  } finally {
    loadingMore.value = false;
  }
}

async function onStatusChange() {
  await loadRuns(true);
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
    const [i, u] = await Promise.all([
      api.get<Interest>(`/interests/${interestId}`),
      api.get<InterestEvent[]>(`/events?interest_id=${interestId}`),
    ]);
    interest.value = i;
    events.value = u;
    await loadRuns(true);
  } catch (e: any) {
    toast.error('检查失败: ' + e.message);
  } finally {
    checking.value = false;
  }
}

async function save() {
  submitAttempted.value = true;
  if (hasErrors.value) return;
  saving.value = true;
  try {
    await api.put(`/interests/${interestId}`, {
      name: form.value.name,
      tags: form.value.tags,
      description: form.value.description || undefined,
      queryKeywords: form.value.queryKeywords || undefined,
      frequency: form.value.frequency,
      time: form.value.time,
      channelIds: form.value.channelIds,
    });
    await loadData();
  } catch (e: any) {
    toast.error('保存失败: ' + e.message);
  } finally {
    saving.value = false;
  }
}

async function doDelete() {
  try {
    await api.delete(`/interests/${interestId}`);
    router.push('/interests');
  } catch (e: any) {
    toast.error('删除失败: ' + e.message);
  }
  showDeleteConfirm.value = false;
}

async function toggleEnabled() {
  if (!interest.value) return;
  try {
    await api.put(`/interests/${interestId}/toggle`);
    await loadData();
  } catch (e: any) {
    toast.error('切换失败: ' + e.message);
  }
}

function formatSchedule(item: Interest) {
  return `${item.frequency === 'day' ? '每天' : '每周'} ${item.time}`;
}

function setChannel(id: number, checked: boolean) {
  if (checked) {
    if (!form.value.channelIds.includes(id)) form.value.channelIds.push(id);
  } else {
    form.value.channelIds = form.value.channelIds.filter((x) => x !== id);
  }
}
</script>

<template>
  <div>
    <Button variant="ghost" size="sm" class="-ml-2.5 mb-3 gap-1" @click="goBack">
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
      </svg>
      返回
    </Button>

    <div v-if="loading" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">加载中...</div>

    <div v-else-if="interest">
      <div class="mb-4 border-b border-gray-200 pb-2">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-bold">{{ interest.name }}</h2>
            <div class="mt-1 flex items-center gap-2 text-xs text-gray-400">
              <Badge v-for="tag in interest.tags" :key="tag" variant="outline">{{ tag }}</Badge>
              <span>{{ formatSchedule(interest) }}</span>
              <span v-if="interest.last_run_at">上次执行: {{ timeAgo(interest.last_run_at) }}</span>
              <span v-if="interest.next_run_at">下次执行: {{ interest.next_run_at }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Switch
              :model-value="!!interest.enabled"
              @update:model-value="toggleEnabled"
            />
            <Button
              variant="ghost"
              size="sm"
              class="gap-1 text-red-500 hover:bg-red-50 hover:text-red-600"
              @click="showDeleteConfirm = true"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
              删除
            </Button>
          </div>
        </div>
      </div>

            <Card class="mb-4">
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
          <div class="space-y-2">
            <Label>兴趣名称</Label>
            <Input v-model="form.name" type="text" :aria-invalid="submitAttempted && !!formErrors.name" />
            <p v-if="submitAttempted && formErrors.name" class="text-xs text-red-500">{{ formErrors.name }}</p>
          </div>
          <div class="space-y-2">
            <Label>分类</Label>
            <CategoryInput
              v-model="form.tags"
              :suggestions="existingTags"
              placeholder="选择或新建分类"
            />
            <p v-if="submitAttempted && formErrors.tags" class="text-xs text-red-500">{{ formErrors.tags }}</p>
          </div>
          <div class="space-y-2">
            <Label>搜索关键词（留空则使用名称）</Label>
            <Input v-model="form.queryKeywords" type="text" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
              <Label>检查频率</Label>
              <select
                v-model="form.frequency"
                class="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="day">每天</option>
                <option value="week">每周</option>
              </select>
            </div>
            <div class="space-y-2">
              <Label>执行时间</Label>
              <Input v-model="form.time" type="time" :aria-invalid="submitAttempted && !!formErrors.time" />
              <p v-if="submitAttempted && formErrors.time" class="text-xs text-red-500">{{ formErrors.time }}</p>
            </div>
          </div>
          <div class="space-y-2">
            <Label>备注</Label>
            <Textarea
              v-model="form.description"
              rows="2"
            />
          </div>
          <div class="space-y-2">
            <Label>推送渠道</Label>
            <div v-if="channels.length === 0" class="text-xs text-gray-400">暂无可用渠道，请先在设置页配置通知渠道</div>
            <div v-else class="flex flex-row flex-wrap gap-x-5 gap-y-2">
              <label
                v-for="ch in channels"
                :key="ch.id"
                class="flex items-center gap-2 text-sm"
                :class="ch.enabled ? '' : 'opacity-50'"
              >
                <Checkbox
                  :model-value="form.channelIds.includes(ch.id)"
                  :disabled="!ch.enabled"
                  class="cursor-pointer"
                  @update:model-value="(v: boolean | 'indeterminate') => setChannel(ch.id, v === true)"
                />
                <span>{{ ch.name }}</span>
                <span v-if="!ch.enabled" class="text-xs text-gray-400">（未启用）</span>
              </label>
            </div>
          </div>
        </div>
        <div class="mt-4 flex items-center justify-end gap-3">
          <div
            v-if="checkResult"
            class="flex-1 rounded border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700"
          >
            {{ checkResult }}
          </div>
          <Button :disabled="saving" @click="save">
            {{ saving ? '保存中...' : '保存' }}
          </Button>
          <Button variant="secondary" :disabled="checking" @click="triggerCheck">
            <span v-if="checking" class="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
            {{ checking ? '执行中...' : '立即执行' }}
          </Button>
        </div>
        </CardContent>
      </Card>

      <div class="mb-3 flex items-center justify-between border-b border-gray-200 pb-2">
        <h3 class="text-sm font-bold text-gray-700">相关动态 ({{ events.length }})</h3>
        <Button
          v-if="events.length > 3"
          variant="ghost"
          size="sm"
          class="gap-0.5"
          @click="router.push({ path: '/updates', query: { interest_id: interestId } })"
        >
          更多
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </Button>
      </div>

      <div v-if="events.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        暂无相关动态
      </div>

      <div v-else class="overflow-hidden rounded border border-gray-200 bg-white">
        <div
          v-for="(event, idx) in latestEvents"
          :key="event.id"
          class="px-5 py-4"
          :class="idx > 0 ? 'border-t border-gray-100' : ''"
        >
          <div class="mb-1 text-xs text-gray-400">{{ timeAgo(event.run_at) }}</div>
          <h3 class="text-sm font-medium leading-snug text-gray-900">{{ event.title }}</h3>
          <div v-if="event.summary" class="mt-1 text-xs leading-relaxed text-gray-500">{{ event.summary }}</div>
          <div v-if="event.sources.length > 0" class="mt-2 space-y-1">
            <div
              v-for="source in event.sources"
              :key="source.id"
              class="flex items-center gap-2 text-xs text-gray-400"
            >
              <span>{{ source.source_name ?? '未知来源' }}</span>
              <a v-if="source.source_url" :href="source.source_url" target="_blank" class="text-blue-500 hover:underline">原文</a>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-3 mt-8 border-b border-gray-200 pb-2">
        <h3 class="text-sm font-bold text-gray-700">执行历史 ({{ runsTotal }})</h3>
      </div>

      <Tabs v-model="statusFilter" class="mb-3" @update:modelValue="onStatusChange">
        <TabsList variant="line">
          <TabsTrigger v-for="t in statusTabs" :key="t.key" :value="t.key">
            {{ t.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div v-if="runs == undefined || runs.length === 0" class="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        暂无执行记录
      </div>

      <div v-else class="overflow-hidden rounded border border-gray-200 bg-white">
        <div
          v-for="(run, idx) in runs"
          :key="run.id"
          class="flex items-center gap-4 px-5 py-3"
          :class="idx > 0 ? 'border-t border-gray-100' : ''"
        >
          <Badge :variant="runStatusBadge(run.status).variant" class="w-14 justify-center">
            {{ runStatusBadge(run.status).text }}
          </Badge>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] text-gray-400">
              {{ timeAgo(run.started_at) }} · {{ run.duration_ms != null ? (run.duration_ms / 1000).toFixed(1) + 's' : '—' }}
              · 搜索结果 {{ run.search_result_count ?? 0 }} 条
              <template v-if="run.sources_created_count != null">
                · 新增 {{ run.sources_created_count }} 条来源
              </template>
              <template v-if="run.llm_input_tokens != null">
                · 输入 {{ run.llm_input_tokens }} / 输出 {{ run.llm_output_tokens ?? 0 }} tok
              </template>
            </div>
            <div v-if="run.error_message" class="truncate text-[11px] text-red-500">{{ run.error_message }}</div>
          </div>
          <span class="text-[11px] text-gray-400">#{{ run.id }}</span>
        </div>
      </div>

      <Button
        v-if="runs == undefined || runs.length < runsTotal"
        variant="outline"
        class="mt-2 w-full"
        :disabled="loadingMore"
        @click="loadRuns(false)"
      >
        {{ loadingMore ? '加载中...' : `加载更多` }}
      </Button>
    </div>

    <Dialog :open="showDeleteConfirm" @update:open="showDeleteConfirm = $event">
      <DialogContent class="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>确定要删除这个兴趣吗？删除后无法恢复。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteConfirm = false">取消</Button>
          <Button variant="destructive" @click="doDelete">删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
