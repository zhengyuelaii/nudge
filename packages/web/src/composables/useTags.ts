import { computed, ref } from 'vue';
import { api } from '../api/index.js';

export interface Tag {
  code: string;
  label: string;
  color: string;
  sort_order: number;
}

const tags = ref<Tag[]>([]);
let loaded = false;

export function useTags() {
  if (!loaded) {
    loaded = true;
    void loadTags();
  }
  return {
    tags,
    codes: computed(() => tags.value.map((t) => t.code)),
    label: (code: string) => tags.value.find((t) => t.code === code)?.label ?? code,
    color: (code: string) =>
      tags.value.find((t) => t.code === code)?.color ?? 'bg-gray-100 text-gray-500',
  };
}

async function loadTags(): Promise<void> {
  try {
    tags.value = await api.get<Tag[]>('/tags');
  } catch (e) {
    console.error('加载分类失败:', e);
  }
}
