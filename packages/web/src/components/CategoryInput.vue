<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
  modelValue: string[];
  suggestions?: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const inputText = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const showDropdown = ref(false);
const highlightIndex = ref(-1);
const container = ref<HTMLElement | null>(null);

const filtered = computed(() => {
  const q = inputText.value.toLowerCase();
  return (props.suggestions ?? []).filter(
    (s) => !props.modelValue.includes(s) && s.toLowerCase().includes(q),
  );
});

function focusInput() {
  inputEl.value?.focus();
}

function add(tag: string) {
  const v = tag.trim();
  if (v && !props.modelValue.includes(v)) {
    emit('update:modelValue', [...props.modelValue, v]);
  }
  inputText.value = '';
  highlightIndex.value = -1;
}

function remove(tag: string) {
  emit('update:modelValue', props.modelValue.filter((t) => t !== tag));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && showDropdown.value && filtered.value.length > 0) {
    e.preventDefault();
    const idx = highlightIndex.value >= 0 ? highlightIndex.value : 0;
    add(filtered.value[idx]);
  } else if (e.key === 'Enter' && inputText.value.trim()) {
    e.preventDefault();
    add(inputText.value);
  } else if (e.key === 'Backspace' && !inputText.value && props.modelValue.length > 0) {
    remove(props.modelValue[props.modelValue.length - 1]);
  } else if (e.key === 'ArrowDown' && showDropdown.value) {
    e.preventDefault();
    highlightIndex.value = Math.min(highlightIndex.value + 1, filtered.value.length - 1);
  } else if (e.key === 'ArrowUp' && showDropdown.value) {
    e.preventDefault();
    highlightIndex.value = Math.max(highlightIndex.value - 1, -1);
  } else if (e.key === 'Escape') {
    showDropdown.value = false;
  }
}

function onBlur() {
  setTimeout(() => {
    showDropdown.value = false;
    if (inputText.value.trim()) add(inputText.value);
  }, 150);
}

watch(inputText, () => {
  highlightIndex.value = -1;
  showDropdown.value = true;
});

function onClickOutside(e: MouseEvent) {
  const t = e.target as Node;
  if (
    container.value && !container.value.contains(t)
    && !((t as Element).closest && (t as Element).closest('[data-category-dropdown]'))
  ) {
    showDropdown.value = false;
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));
</script>

<template>
  <div ref="container" class="relative">
    <div
      class="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3 md:text-sm dark:bg-input/30"
      @click="focusInput"
    >
      <span
        v-for="tag in modelValue"
        :key="tag"
        class="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
      >
        {{ tag }}
        <button
          type="button"
          class="ml-0.5 cursor-pointer text-gray-400 hover:text-gray-600"
          @click.stop="remove(tag)"
        >×</button>
      </span>
      <input
        ref="inputEl"
        v-model="inputText"
        :placeholder="modelValue.length === 0 ? (placeholder ?? '选择或新建分类') : ''"
        class="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        @focus="showDropdown = true"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>
    <div
      v-if="showDropdown && filtered.length > 0"
      data-category-dropdown
      class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-input bg-white shadow-lg dark:bg-input/30"
    >
      <div
        v-for="(s, i) in filtered"
        :key="s"
        class="cursor-pointer px-3 py-1.5 text-sm transition-colors"
        :class="i === highlightIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/60'"
        @mousedown.prevent="add(s)"
      >
        {{ s }}
      </div>
    </div>
  </div>
</template>
