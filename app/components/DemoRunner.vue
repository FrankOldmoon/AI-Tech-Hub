<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'

/**
 * 通用局部布局组件：输入/控件/结果卡片 + 可选侧栏。
 * 仅负责「卡片排布」；页面外壳（标题区/HowItWorks/面包屑/SEO/上下篇）
 * 统一由外层 MediaDemoShell 提供。
 */
interface RunnerDemo {
  title: string
  description?: string
  icon: string
  status: DemoStatus
  /** 工作原理（教学向，折叠渲染） */
  howItWorks?: string
}

defineProps<{
  demo?: RunnerDemo
  loading?: boolean
  error?: string | null
  notice?: string | null
}>()

const { t } = useI18n()
const slots = useSlots()
const hasAside = computed(() => Boolean(slots.aside))
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-6">
    <div :class="hasAside ? 'lg:col-span-2 space-y-6' : 'lg:col-span-3 space-y-6'">
      <!-- 输入 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon
              name="i-lucide-keyboard"
              class="size-4"
            />
            {{ t('demo.input') }}
          </div>
        </template>
        <slot name="input" />
        <template #footer>
          <div class="flex flex-wrap items-center gap-2">
            <slot name="controls" />
          </div>
        </template>
      </UCard>

      <!-- 结果 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon
              name="i-lucide-terminal"
              class="size-4"
            />
            {{ t('demo.result') }}
            <UIcon
              v-if="loading"
              name="i-lucide-loader-circle"
              class="size-4 animate-spin ms-1"
            />
          </div>
        </template>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="error"
        />
        <UAlert
          v-else-if="notice"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          :title="notice"
        />
        <slot
          v-else
          name="result"
        />
      </UCard>
    </div>

    <!-- 侧栏：仅在有 aside 插槽时渲染 -->
    <aside
      v-if="hasAside"
      class="space-y-4"
    >
      <slot name="aside" />
    </aside>
  </div>
</template>
