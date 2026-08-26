<script setup lang="ts">
import { CircleDotIcon, BotIcon, ExternalLinkIcon } from "@lucide/vue";
import { Timeline } from "@/components/timeline";
import { mockInterestEvents } from "./mock/mock-timeline";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "Z");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}

function openUrl(url: string | null) {
  if (url) window.open(url, "_blank", "noopener");
}

let lastDay = "";
</script>

<template>
  <div class="p-4">
    <h2 class="mb-4 text-base font-bold">动态</h2>

    <Timeline.Root class="w-full list-none p-0">
      <Timeline.Item
        v-for="(event, index) in mockInterestEvents"
        :key="event.id"
        class="animate-in fade-in slide-in-from-left-4 fill-mode-both duration-500"
        :style="{ animationDelay: `${index * 60}ms` }"
      >
        <Timeline.Media variant="icon">
          <BotIcon v-if="event.run_mode === 'agent'" class="size-4 text-blue-500" />
          <CircleDotIcon v-else class="size-4 text-emerald-500" />
        </Timeline.Media>

        <Timeline.Content>
          <div v-if="event.created_at.slice(0, 10) !== lastDay && (lastDay = event.created_at.slice(0, 10))" class="mb-2 flex h-8 items-center text-xs font-medium text-muted-foreground">
            {{ event.created_at.slice(0, 10) }}
          </div>
          <div class="overflow-hidden rounded-md border border-border bg-card">
            <div class="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-sm">
              <span class="font-semibold text-foreground">{{ event.title }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ formatDate(event.created_at) }}</span>
            </div>
            <div class="px-3 py-2">
              <p v-if="event.description" class="text-sm leading-relaxed text-muted-foreground">{{ event.description }}</p>
              <div v-if="event.sources.length > 0" class="mt-2 space-y-1">
                <div
                  v-for="src in event.sources"
                  :key="src.id"
                  class="flex items-center gap-1.5 text-xs"
                >
                  <span class="text-muted-foreground">›</span>
                  <span class="font-medium text-foreground">{{ src.name }}</span>
                  <span class="text-muted-foreground">-</span>
                  <span
                    class="min-w-0 truncate text-muted-foreground"
                    :class="src.url ? 'cursor-pointer hover:text-foreground' : ''"
                    @click="openUrl(src.url)"
                  >{{ src.title }}</span>
                  <ExternalLinkIcon v-if="src.url" class="size-3 shrink-0 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
        </Timeline.Content>
      </Timeline.Item>
    </Timeline.Root>
  </div>
</template>
