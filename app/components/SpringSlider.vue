<script setup lang="ts">
/**
 * 弹簧滑块（Apple 手感）：
 * - 拖动即时跟手（原生 range，v-model 即改即发 → 结果即时重跑）
 * - 数值徽章用弹簧流动（从当前值平滑过渡，可中断）
 * - 拖动中徽章放大强调（Hinting：操作中强调，松手回落）
 * - Pointer Events（为触屏适配打基础）
 */
const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** 显示精度（小数位） */
  precision?: number
  /** 无障碍标签 */
  label?: string
}>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  precision: 0,
  label: undefined
})

const emit = defineEmits<{ 'update:modelValue': [number] }>()

const dragging = ref(false)

// 数值流动：目标值变化时从当前值平滑过渡（可中断弹簧，临界阻尼）
const displayValue = useSpring(computed(() => props.modelValue), { damping: 1, stiffness: 220 })

// 拖动中徽章放大（松手弹簧回落，带轻微过冲产生「确认感」）
const badgeScale = useSpring(computed(() => (dragging.value ? 1.16 : 1)), { damping: 0.95, stiffness: 260 })

// 轨道填充百分比（主色 = 已生效区间，Apple 式「已调节 vs 未调节」）
const fillPercent = computed(() => {
  const range = props.max - props.min
  if (range <= 0) return 0
  return Math.min(100, Math.max(0, ((Number(displayValue.value) - props.min) / range) * 100))
})

const displayText = computed(() => {
  const v = Number(displayValue.value)
  return props.precision > 0 ? v.toFixed(props.precision) : String(Math.round(v))
})

function onInput(e: Event) {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value))
}

function onPointerDown() {
  dragging.value = true
}

function onPointerUp() {
  dragging.value = false
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      type="range"
      class="spring-slider flex-1"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="label"
      :style="{ '--fill': `${fillPercent}%` }"
      @input="onInput"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
    <span
      class="spring-badge tabular-nums text-xs font-semibold text-highlighted rounded-md px-1.5 py-0.5 bg-elevated/80 border border-default min-w-10 text-center shrink-0"
      :style="{ transform: `scale(${badgeScale})` }"
    >{{ displayText }}</span>
  </div>
</template>

<style scoped>
.spring-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--ui-primary, #00dc82) var(--fill, 0%), var(--ui-bg-elevated, #e2e8f0) var(--fill, 0%));
  outline: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.spring-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.spring-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ui-primary, #00dc82);
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  cursor: grab;
  transition: transform 0.12s ease;
}
.spring-slider:active::-webkit-slider-thumb {
  transform: scale(1.18);
  cursor: grabbing;
}
.spring-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ui-primary, #00dc82);
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  cursor: grab;
}
.spring-slider:disabled::-webkit-slider-thumb,
.spring-slider:disabled::-moz-range-thumb {
  cursor: not-allowed;
}
</style>
