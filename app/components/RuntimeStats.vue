<script setup lang="ts">
/**
 * 轻量运行时统计徽章（P2-2 教学纵深）
 * - fps：rAF 帧率，20 帧滑动平均（与 boids 子应用 hud 同款口径）
 * - inferenceMs：由父组件传入的单次推理耗时（如 MediaVisionRunner 已内联实现的场景）
 * 页面隐藏时浏览器自动暂停 rAF，无需额外处理。
 */
const props = withDefaults(defineProps<{
  /** 是否显示 fps（内部自跑 rAF 统计） */
  fps?: boolean
  /** 外部传入的推理耗时（ms），null 时不显示 */
  inferenceMs?: number | null
}>(), {
  fps: true,
  inferenceMs: null,
})

const fps = ref(0)
let rafId: number | null = null
let acc = 0
let count = 0
let last = performance.now()

function tick(now: number) {
  const dt = now - last
  last = now
  if (dt > 0) {
    acc += 1000 / dt
    count++
  }
  if (count >= 20) {
    fps.value = Math.round(acc / count)
    acc = 0
    count = 0
  }
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  if (props.fps) rafId = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="flex items-center gap-3 text-sm text-muted tabular-nums">
    <span v-if="fps" class="inline-flex items-center gap-1">
      <UIcon name="i-lucide-gauge" class="size-4" />
      <b class="text-highlighted">{{ fps }}</b>&nbsp;fps
    </span>
    <span v-if="inferenceMs != null" class="inline-flex items-center gap-1">
      <UIcon name="i-lucide-timer" class="size-4" />
      <b class="text-highlighted">{{ inferenceMs }}</b>&nbsp;ms
    </span>
  </div>
</template>