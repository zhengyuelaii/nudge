<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/index.js';
import CategoryInput from '../components/CategoryInput.vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const router = useRouter();

interface Interest {
  id: number;
  name: string;
  tags: string[];
  description: string | null;
  query_keywords: string | null;
  subject: string;
  criteria: string;
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

interface Channel {
  id: number;
  type: string;
  name: string;
  enabled: number;
  is_default: number;
}

const interests = ref<Interest[]>([]);
const loading = ref(true);
const showModal = ref(false);
const existingCategories = ref<string[]>([]);
const channels = ref<Channel[]>([]);
const saving = ref(false);
const submitAttempted = ref(false);

const form = ref({
  name: '',
  tags: [] as string[],
  frequency: 'day' as 'day' | 'week',
  time: '09:00',
  description: '',
  queryKeywords: '',
  subject: '',
  criteria: '',
  channelIds: [] as number[],
});

const formErrors = computed<{ name?: string; tags?: string; time?: string }>(() => {
  const e: { name?: string; tags?: string; time?: string } = {};
  if (!form.value.name.trim()) e.name = '请输入兴趣名称';
  if (form.value.tags.length === 0) e.tags = '请至少添加一个分类';
  if (!form.value.time || !/^\d{2}:\d{2}$/.test(form.value.time)) e.time = '请选择有效的执行时间';
  return e;
});
const hasErrors = computed(() => Object.keys(formErrors.value).length > 0);

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

async function loadCategories() {
  try {
    existingCategories.value = await api.get<string[]>('/interests/tags');
  } catch { /* ignore */ }
}

async function loadChannels() {
  try {
    channels.value = await api.get<Channel[]>('/notification-channels');
  } catch { /* ignore */ }
}

function openAdd() {
  form.value = { name: '', tags: [], frequency: 'day', time: '09:00', description: '', queryKeywords: '', subject: '', criteria: '', channelIds: [] };
  submitAttempted.value = false;
  showModal.value = true;
  void loadCategories();
  void loadChannels();
}

async function save() {
  submitAttempted.value = true;
  if (hasErrors.value) return;
  saving.value = true;
  try {
    await api.post('/interests', {
      name: form.value.name,
      tags: form.value.tags,
      frequency: form.value.frequency,
      time: form.value.time,
      description: form.value.description || undefined,
      queryKeywords: form.value.queryKeywords || undefined,
      subject: form.value.subject || undefined,
      criteria: form.value.criteria || undefined,
      channelIds: form.value.channelIds,
    });
    await loadInterests();
    showModal.value = false;
  } catch (e: any) {
    toast.error('保存失败: ' + e.message);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(item: Interest) {
  try {
    await api.put(`/interests/${item.id}/toggle`);
    await loadInterests();
  } catch (e: any) {
    toast.error('切换失败: ' + e.message);
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
      <Button @click="openAdd">+ 添加兴趣</Button>
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
            <template v-if="item.tags.length > 0">
              <span class="text-gray-300">|</span>
              <Badge v-for="tag in item.tags" :key="tag" variant="outline">{{ tag }}</Badge>
            </template>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Switch
            :model-value="!!item.enabled"
            @update:model-value="toggleEnabled(item)"
          />
        </div>
      </div>
    </div>

    <Dialog :open="showModal" @update:open="showModal = $event">
      <DialogContent class="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>添加兴趣</DialogTitle>
          <DialogDescription>配置兴趣的基本信息和检查频率</DialogDescription>
        </DialogHeader>

        <!-- 两列排布：长字段跨两列，短字段两两成对，整体高度压到一屏内 -->
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 py-2">
          <div class="col-span-2 space-y-2">
            <Label>兴趣名称</Label>
            <Input v-model="form.name" placeholder="输入兴趣描述..." :aria-invalid="submitAttempted && !!formErrors.name" />
            <p v-if="submitAttempted && formErrors.name" class="text-xs text-red-500">{{ formErrors.name }}</p>
          </div>

          <div class="space-y-2">
            <Label>分类</Label>
            <CategoryInput
              v-model="form.tags"
              :suggestions="existingCategories"
              placeholder="选择或新建分类"
            />
            <p v-if="submitAttempted && formErrors.tags" class="text-xs text-red-500">{{ formErrors.tags }}</p>
          </div>
          <div class="space-y-2">
            <Label>搜索关键词（可选）</Label>
            <Input v-model="form.queryKeywords" placeholder="留空则使用名称" />
          </div>

          <div class="col-span-2 space-y-2">
            <Label>监控主体（可选）</Label>
            <Input v-model="form.subject" placeholder="如：美国生物安全法案 / 国际金价 / 华友钴业" />
          </div>

          <div class="col-span-2 space-y-2">
            <Label>触发条件（可选）</Label>
            <Textarea
              v-model="form.criteria"
              rows="2"
              placeholder="一句话，看到单篇新闻就能判断是/否。例：出现修订、新增条款或进入投票环节"
            />
            <p class="text-xs text-gray-400">
              填写后只推送命中该条件的变化。请写具体事件（如「新产能投产」「净利同比变动超 30%」），避免「关注动态」「有变化」这类任何新闻都算命中的描述。
            </p>
          </div>

          <div class="space-y-2">
            <Label>检查频率</Label>
            <Select v-model="form.frequency">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">每天</SelectItem>
                <SelectItem value="week">每周</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2">
            <Label>执行时间</Label>
            <Input v-model="form.time" type="time" :aria-invalid="submitAttempted && !!formErrors.time" />
            <p v-if="submitAttempted && formErrors.time" class="text-xs text-red-500">{{ formErrors.time }}</p>
          </div>

          <div class="space-y-2">
            <Label>备注</Label>
            <Textarea v-model="form.description" rows="2" />
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
                <input type="checkbox" :value="ch.id" v-model="form.channelIds" class="h-4 w-4" />
                <span>{{ ch.name }}</span>
                <span v-if="!ch.enabled" class="text-xs text-gray-400">（未启用）</span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showModal = false">取消</Button>
          <Button :disabled="saving" @click="save">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
