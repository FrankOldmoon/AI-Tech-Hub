<script setup lang="ts">
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'
import { humanError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'interactive-segmenter')!)

const canvasRef = ref<HTMLCanvasElement>()
const fileInput = ref<HTMLInputElement>()
const loading = ref(false)
const error = ref<string | null>(null)
const hasImage = ref(false)
/** 实际生效的推理后端：GPU 优先，客户端不支持时自动降级 CPU */
const delegateMode = ref<'GPU' | 'CPU'>('GPU')

let segmenter: any = null
let DrawingUtilsCtor: any = null
let bitmap: ImageBitmap | null = null

/**
 * @mediapipe/tasks-vision v1.0.1 的 BrushMode 仅存在于类型声明，
 * 运行时 bundle（vision_bundle.mjs）未导出它（官方导出清单无 BrushMode），
 * 直接 import 会得到 undefined。此处按官方 vision.d.ts 本地定义。
 */
const BrushMode = { UNSPECIFIED: 0, POSITIVE: 1, NEGATIVE: 2, LASSO: 3 } as const

/** 主动检测 WebGL2 是否可用：创建 canvas 试拿上下文（硬件加速关/无独显时通常失败） */
function detectWebGL2(): boolean {
  try {
    const c = document.createElement('canvas')
    return typeof WebGL2RenderingContext !== 'undefined' && !!(c.getContext('webgl2'))
  } catch {
    return false
  }
}

async function createSegmenter(delegate: 'GPU' | 'CPU') {
  const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  return InteractiveSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mediapipeModels.magicTouch, delegate }
  })
}

/** GPU 执行失败后重建 CPU segmenter（并恢复当前图片） */
async function rebuildCpu() {
  const { DrawingUtils } = await import('@mediapipe/tasks-vision')
  DrawingUtilsCtor = DrawingUtils
  if (segmenter) {
    try {
      segmenter.close()
    } catch {
      /* ignore */
    }
    segmenter = null
  }
  segmenter = await createSegmenter('CPU')
  delegateMode.value = 'CPU'
  if (bitmap) segmenter.setImage(bitmap)
}

async function ensure() {
  if (segmenter) return segmenter
  loading.value = true
  error.value = null
  try {
    const { DrawingUtils } = await import('@mediapipe/tasks-vision')
    DrawingUtilsCtor = DrawingUtils
    // 按客户端能力判定：先主动检测 WebGL2（创建 canvas 试拿上下文），
    // 不可用直接 CPU；创建期失败也自动降级 CPU
    const preferred: 'GPU' | 'CPU' = detectWebGL2() ? 'GPU' : 'CPU'
    try {
      segmenter = await createSegmenter(preferred)
      delegateMode.value = preferred
    } catch (e) {
      if (preferred === 'GPU') {
        console.warn('[interactive-segmenter] GPU delegate 创建失败，自动降级 CPU:', e)
        segmenter = await createSegmenter('CPU')
        delegateMode.value = 'CPU'
      } else {
        throw e
      }
    }
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
  return segmenter
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await loadImageFile(file)
  input.value = ''
}

async function loadImageFile(file: File) {
  const s = await ensure()
  if (!s) return
  loading.value = true
  try {
    bitmap = await createImageBitmap(file)
    segmenter.setImage(bitmap)
    const canvas = canvasRef.value!
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    redraw()
    hasImage.value = true
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function useSample(url: string) {
  try {
    const file = await fetchSampleFile(url)
    await loadImageFile(file)
  } catch (e) {
    error.value = humanError(e, t)
  }
}

const { fetchSampleFile } = useVisionSamples()
// 交互式分割样本：多人照（点不同人）+ 桌面多物体（点不同物体），演示"点哪抠哪"
const samples = computed(() => [
  { label: t('samples.group'), url: '/samples/images/group.jpg' },
  { label: t('samples.desk'), url: '/samples/images/desk.jpg' }
])

onMounted(() => {
  // 课堂演示：打开页面自动加载多人示例图，点击画面即可交互分割
  useSample('/samples/images/group.jpg')
})

function redraw(mask?: any, point?: { x: number, y: number }) {
  const canvas = canvasRef.value
  if (!canvas || !bitmap) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  if (mask) {
    const d = new DrawingUtilsCtor(ctx)
    d.drawCategoryMask(mask, ['rgba(0,0,0,0)', 'rgba(0,220,130,0.55)'])
  }
  if (point) {
    ctx.beginPath()
    ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(6, canvas.width * 0.01), 0, Math.PI * 2)
    ctx.fillStyle = '#FF0040'
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

async function onCanvasClick(e: MouseEvent) {
  if (!bitmap || !segmenter) return
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const nx = (e.clientX - rect.left) / rect.width
  const ny = (e.clientY - rect.top) / rect.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return
  loading.value = true
  error.value = null
  const doSegment = () => segmenter.segment([{
    brushMode: BrushMode.POSITIVE,
    point: [{ x: nx, y: ny }],
    isCompleted: true
  }])
  try {
    const mask = doSegment()
    redraw(mask, { x: nx, y: ny })
  } catch (e: any) {
    // GPU 创建成功但执行分割时才拿 WebGL2 上下文——执行失败时重建 CPU 重试一次
    if (delegateMode.value === 'GPU') {
      try {
        await rebuildCpu()
        const mask = doSegment()
        redraw(mask, { x: nx, y: ny })
      } catch (e2) {
        error.value = humanError(e2, t)
      }
    } else {
      error.value = humanError(e, t)
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-2">
      <UButton icon="i-lucide-upload" :label="t('mp.upload')" color="primary" :loading="loading" @click="fileInput?.click()" />
      <SampleImagePicker
        :samples="samples"
        @pick="useSample"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
      <span v-if="hasImage" class="text-sm text-muted">{{ t('mp.clickHint') }}</span>
      <UBadge
        v-if="hasImage"
        :color="delegateMode === 'GPU' ? 'primary' : 'neutral'"
        variant="subtle"
      >
        {{ delegateMode === 'GPU' ? 'GPU' : 'CPU' }}
      </UBadge>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <div class="w-full flex justify-center">
      <canvas
        v-show="hasImage"
        ref="canvasRef"
        class="max-w-full h-auto rounded-xl bg-elevated/60 cursor-crosshair"
        @click="onCanvasClick"
      />
    </div>
    <div v-if="!hasImage" class="w-full max-w-3xl mx-auto aspect-video rounded-xl bg-elevated/60 flex items-center justify-center">
      <UIcon name="i-lucide-image-plus" class="size-10 text-muted" />
    </div>
  </MediaDemoShell>
</template>
