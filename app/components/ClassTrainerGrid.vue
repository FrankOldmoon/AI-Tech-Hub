<script setup lang="ts">
/**
 * 迁移学习训练页共用的「N 个类别」卡片区（类别名改名 / 样本数 / 清空）。
 *
 * 各页差异只有「怎么采集样本」，所以采集控件由调用方用 #collect 插槽填：
 * 图像与姿态是「按住采样」按钮、音频是「按住录音」、文本是「加入类别」按钮。
 * #extra 插槽放在类别名下方，给文本训练页放样本输入框。
 */
const props = defineProps<{
  classNames: string[]
  sampleCounts: number[]
  /** 正在采集的类别下标，-1 表示无（用于高亮当前卡片） */
  activeIndex?: number
}>()

const emit = defineEmits<{
  rename: [index: number, name: string]
  clear: [index: number]
}>()

const { t } = useI18n()

/** 类别色点：类别数固定为 3，取模是为了万一扩到 4+ 也不越界 */
const DOT_CLASSES = ['bg-green-500', 'bg-purple-500', 'bg-orange-500']

function onRename(index: number, event: Event) {
  const el = event.target as HTMLInputElement
  // emit 在 Vue 里是同步的：父级的处理函数会在下面这行读 props 之前把 classNames 更新完，
  // 所以「接受改名」时这里写回的是新值（视觉无变化），「拒绝改名」（该类已有样本）时
  // 写回旧值，输入框自动回滚，不会留下与真实类别名不一致的文本
  emit('rename', index, el.value)
  el.value = props.classNames[index] ?? ''
}
</script>

<template>
  <div class="grid sm:grid-cols-3 gap-4">
    <UCard
      v-for="(name, i) in props.classNames"
      :key="i"
      :class="props.activeIndex === i ? 'ring-2 ring-primary' : ''"
    >
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <span class="size-3 rounded-full" :class="DOT_CLASSES[i % DOT_CLASSES.length]" />
          <input
            :value="name"
            class="flex-1 bg-transparent border-b border-default text-sm font-medium text-highlighted focus:border-primary outline-none py-1"
            @change="onRename(i, $event)"
          >
        </div>

        <slot name="extra" :index="i" />

        <div class="text-3xl font-bold tabular-nums text-highlighted">
          {{ props.sampleCounts[i] ?? 0 }}
        </div>
        <p class="text-xs text-muted">
          {{ t('ml.samples') }}
        </p>

        <div class="flex gap-2">
          <slot name="collect" :index="i" />
          <UButton
            v-if="(props.sampleCounts[i] ?? 0) > 0"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="emit('clear', i)"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
