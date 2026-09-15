<script lang="ts">
/** 工具栏条目：左侧「工具/任务/章节」列表的一项 */
export interface ToolSidebarItem {
  /** 稳定键，与 modelValue 同类型比较 */
  id: string | number
  /** 第一行主标题 */
  label: string
  /** 第二行副标题（工具类型 / 任务类型 / 序号），大写小字展示 */
  kind?: string
  /** 可选前置图标（展示在第一行） */
  icon?: string
  /** 可选徽章（如「规划中」），展示在第二行 */
  badge?: string
  /** 可选禁用态 */
  disabled?: boolean
}
</script>

<script setup lang="ts">
/**
 * 功能页通用左侧工具栏：栅格 + 吸顶卡片 + 标题 + 两行式按钮列表。
 * 全站所有带左侧工具/章节导航的功能页共用此组件，样式只需改这一处。
 * - 右侧内容通过默认插槽传入
 * - 选中项用 v-model / :model-value + @update:model-value 受控（支持字符串或数字 id）
 */
withDefaults(defineProps<{
  /** 列表数据 */
  items: ToolSidebarItem[]
  /** 当前选中项 id */
  modelValue: string | number
  /** 卡片标题文案 */
  title: string
  /** 标题图标，默认工具箱图标 */
  titleIcon?: string
}>(), {
  titleIcon: 'i-lucide-wrench'
})

const emit = defineEmits<{ 'update:modelValue': [id: string | number] }>()

function select(id: string | number) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-6 items-start">
    <UCard class="lg:sticky lg:top-20">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon
            :name="titleIcon"
            class="size-4 text-primary"
          />
          <span>{{ title }}</span>
        </div>
      </template>
      <nav class="space-y-1">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="w-full flex flex-col items-start gap-0.5 px-2 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :class="item.id === modelValue
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted hover:bg-elevated/60 hover:text-highlighted'"
          :disabled="item.disabled"
          @click="select(item.id)"
        >
          <span class="leading-snug w-full break-words flex items-center gap-1.5">
            <UIcon
              v-if="item.icon"
              :name="item.icon"
              class="size-3.5 shrink-0"
            />
            <span>{{ item.label }}</span>
          </span>
          <span
            v-if="item.kind || item.badge"
            class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-dimmed shrink-0"
          >
            <span
              v-if="item.kind"
              class="font-medium"
            >{{ item.kind }}</span>
            <span
              v-if="item.badge"
              class="px-1 py-px rounded bg-neutral/10 text-dimmed normal-case"
            >{{ item.badge }}</span>
          </span>
        </button>
      </nav>
    </UCard>

    <div class="space-y-4 min-w-0">
      <slot />
    </div>
  </div>
</template>
