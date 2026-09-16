<script setup lang="ts">
/**
 * 迁移学习训练页共用的分类结果条（各类别置信度）。
 * 只渲染行本身，外层卡片由调用方决定 —— 文本训练页要把它嵌在「预测」卡片里。
 */
const props = defineProps<{
  predictions: Array<{ name: string, score: number }>
  /** 当前 top-1 类别；为空表示低于阈值 */
  topClass?: string
  /** predictions 非空但 topClass 为空时的提示文案，不传则不提示 */
  belowThresholdHint?: string
}>()

const showHint = computed(() =>
  !props.topClass && props.predictions.length > 0 && !!props.belowThresholdHint
)
</script>

<template>
  <div class="space-y-3">
    <div v-if="showHint" class="text-sm text-muted">
      {{ props.belowThresholdHint }}
    </div>
    <div
      v-for="(p, i) in props.predictions"
      :key="i"
      class="flex items-center gap-3"
    >
      <span class="text-sm font-medium w-24 shrink-0 truncate">{{ p.name }}</span>
      <UProgress :model-value="Math.round(p.score * 100)" size="sm" class="flex-1" />
      <span class="text-sm text-muted w-12 text-right tabular-nums">{{ Math.round(p.score * 100) }}%</span>
    </div>
  </div>
</template>
