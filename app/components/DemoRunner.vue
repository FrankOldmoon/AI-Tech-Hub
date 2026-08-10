<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'

/**
 * 通用演示运行器外壳：标题/状态 + 输入/控件/结果插槽 + 可选侧栏
 */
interface RunnerDemo {
  title: string
  description?: string
  icon: string
  status: DemoStatus
}

defineProps<{
  demo: RunnerDemo
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
    <div :class="hasAside ? 'lg:col-span-2 space-y-6' : 'space-y-6'">
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

      <!-- 输入 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-keyboard" class="size-4" />
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
            <UIcon name="i-lucide-terminal" class="size-4" />
            {{ t('demo.result') }}
            <UIcon v-if="loading" name="i-lucide-loader-circle" class="size-4 animate-spin ms-1" />
          </div>
        </template>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          :title="error"
        />
        <UAlert
          v-else-if="notice"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          :title="notice"
        />
        <slot v-else name="result" />
      </UCard>
    </div>

    <!-- 侧栏：仅在有 aside 插槽时渲染 -->
    <aside v-if="hasAside" class="space-y-4">
      <slot name="aside" />
    </aside>
  </div>
</template>
