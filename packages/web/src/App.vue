<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div class="min-h-screen bg-[#f5f5f5] text-gray-800" style="font-size: 13px; line-height: 1.6">
    <header class="sticky top-0 z-50 border-b border-gray-200/50 bg-white/70 backdrop-blur-xl">
      <div class="mx-auto grid h-12 max-w-[900px] items-center px-4" style="grid-template-columns: 1fr auto 1fr">
        <RouterLink to="/" class="flex items-center justify-start">
          <img src="/logo.svg" alt="Nudge" class="h-6 w-auto" />
        </RouterLink>

        <nav class="flex items-center justify-center gap-5">
          <RouterLink
            to="/"
            class="transition-colors hover:text-black"
            :class="route.path === '/' ? 'font-bold text-black' : 'text-gray-500'"
          >
            首页
          </RouterLink>
          <RouterLink
            to="/interests"
            class="transition-colors hover:text-black"
            :class="route.path.startsWith('/interests') ? 'font-bold text-black' : 'text-gray-500'"
          >
            兴趣
          </RouterLink>
          <RouterLink
            to="/updates"
            class="transition-colors hover:text-black"
            :class="route.path === '/updates' ? 'font-bold text-black' : 'text-gray-500'"
          >
            动态
          </RouterLink>
        </nav>

        <div class="flex items-center justify-end gap-3">
          <RouterLink
            to="/settings"
            class="text-gray-400 transition-colors hover:text-gray-700"
            active-class="!text-gray-700"
            title="设置"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </RouterLink>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-[900px] px-4 py-6">
      <RouterView />
    </main>
  </div>
</template>
