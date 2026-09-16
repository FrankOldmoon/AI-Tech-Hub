<script setup lang="ts">
/**
 * 手绘画布：白底 + 粗黑圆头笔画，作为「简笔画识别」类工具的输入源。
 *
 * 设计要点：
 * - 只在笔画结束时 emit `change`（ImageData），避免逐帧触发推理
 * - 清空通过 `clearToken` 递增触发，父组件无需拿组件实例方法
 * - 白底黑线是简笔画模型的训练画风（DoodleNet 只认黑白线稿），因此初始化即填白
 */
const props = withDefaults(defineProps<{
  /** 画布边长（正方形），默认 320 */
  size?: number
  /** 笔刷粗细（px），默认 24（简笔画模型偏好粗线） */
  brush?: number
  /** 递增该值即清空画布 */
  clearToken?: number
}>(), { size: 320, brush: 24, clearToken: 0 })

const emit = defineEmits<{ change: [ImageData] }>()

const canvasRef = ref<HTMLCanvasElement>()
let drawing = false
let last: { x: number, y: number } | null = null

function ctx(): CanvasRenderingContext2D | null {
  return canvasRef.value?.getContext('2d') ?? null
}

function snapshot() {
  const canvas = canvasRef.value
  const g = ctx()
  if (!canvas || !g) return
  emit('change', g.getImageData(0, 0, canvas.width, canvas.height))
}

function clear() {
  const canvas = canvasRef.value
  const g = ctx()
  if (!canvas || !g) return
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  snapshot()
}

onMounted(() => {
  const canvas = canvasRef.value
  const g = ctx()
  if (!canvas || !g) return
  canvas.width = props.size
  canvas.height = props.size
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = '#000000'
  clear()
})

watch(() => props.clearToken, () => clear())

function pos(e: PointerEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / (rect.width || 1)) * canvas.width,
    y: ((e.clientY - rect.top) / (rect.height || 1)) * canvas.height
  }
}

function stroke(from: { x: number, y: number }, to: { x: number, y: number }) {
  const g = ctx()
  if (!g) return
  g.lineWidth = props.brush
  g.beginPath()
  g.moveTo(from.x, from.y)
  g.lineTo(to.x, to.y)
  g.stroke()
}

function onDown(e: PointerEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  e.preventDefault()
  canvas.setPointerCapture(e.pointerId)
  drawing = true
  last = pos(e)
  // 单击也要留一个点
  stroke(last, last)
}

function onMove(e: PointerEvent) {
  if (!drawing || !last) return
  const p = pos(e)
  stroke(last, p)
  last = p
}

function onUp(e: PointerEvent) {
  if (!drawing) return
  drawing = false
  last = null
  canvasRef.value?.releasePointerCapture?.(e.pointerId)
  snapshot()
}
</script>

<template>
  <canvas
    ref="canvasRef"
    class="w-full max-w-[320px] aspect-square rounded-lg border border-default bg-white touch-none cursor-crosshair"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  />
</template>
