<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'

defineProps<{
  demo: {
    title: string
    description?: string
    icon: string
    status: DemoStatus
    /** 对应 python 下的模块路径，用于展示最简 Python 实现 */
    pythonModule?: string
  }
}>()
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12 space-y-6">
      <!-- 标题区 -->
      <div class="flex items-start gap-4">
        <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UIcon :name="demo.icon" class="size-6" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ demo.title }}
            </h1>
            <DemoStatusBadge :status="demo.status" />
          </div>
          <p v-if="demo.description" class="mt-1 text-muted">
            {{ demo.description }}
          </p>
        </div>
      </div>
      <slot />
      <!-- 对应的 Python 最简实现源码 -->
      <PythonSourceViewer v-if="demo.pythonModule" :feature="demo.pythonModule" />
    </div>
  </UContainer>
</template>
