<script setup lang="ts">
import { processImageFile } from '~/utils/image'
import { IMG, toSquareCanvas, type Fitted } from '~/utils/moebius/imaging'
import { MoebiusPipeline, loadOrt } from '~/utils/moebius/pipeline'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'inpainting')!)

const imageCanvas = ref<HTMLCanvasElement>()
const maskCanvas = ref<HTMLCanvasElement>()
const resultCanvas = ref<HTMLCanvasElement>()
const fileInput = ref<HTMLInputElement>()

const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const hasImage = ref(false)
const backend = ref('')
const status = ref('')
const progressPct = ref(0)
const progressLabel = ref('')
const doneTime = ref(0)
const downloadUrl = ref('')
const webgpu = ref(false)

const brush = ref(40)
const steps = ref(20)
const guidance = ref(2)
const seed = ref(0)
const paste = ref(true)

onMounted(() => { webgpu.value = 'gpu' in navigator })

let fitRect: Fitted['rect'] | null = null
let loadPromise: Promise<MoebiusPipeline | null> | null = null
let painting = false

function canvasPos(e: PointerEvent): [number, number] {
  const canvas = maskCanvas.value
  if (!canvas) return [0, 0]
  const r = canvas.getBoundingClientRect()
  return [((e.clientX - r.left) / r.width) * IMG, ((e.clientY - r.top) / r.height) * IMG]
}

function paintAt(x: number, y: number) {
  const ctx = maskCanvas.value?.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = 'rgba(110,168,254,0.6)'
  ctx.beginPath()
  ctx.arc(x, y, brush.value / 2, 0, Math.PI * 2)
  ctx.fill()
}

function onPointerDown(e: PointerEvent) {
  if (!hasImage.value) return
  painting = true
  try {
    maskCanvas.value?.setPointerCapture(e.pointerId)
  } catch {
    // 合成事件/异常情况下忽略（指针捕获失败不影响绘制）
  }
  const [x, y] = canvasPos(e)
  paintAt(x, y)
}

function onPointerMove(e: PointerEvent) {
  if (!painting) return
  const [x, y] = canvasPos(e)
  paintAt(x, y)
}

function onPointerUp() {
  painting = false
}

function clearMask() {
  maskCanvas.value?.getContext('2d')?.clearRect(0, 0, IMG, IMG)
}

function setImage(img: HTMLImageElement) {
  const fitted = toSquareCanvas(img, img.naturalWidth, img.naturalHeight)
  fitRect = fitted.rect
  const ictx = imageCanvas.value?.getContext('2d')
  ictx?.clearRect(0, 0, IMG, IMG)
  ictx?.drawImage(fitted.canvas, 0, 0)
  clearMask()
  hasImage.value = true
  status.value = ''
  progressPct.value = 0
  doneTime.value = 0
  downloadUrl.value = ''
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = null
  try {
    const url = await processImageFile(file, 1024)
    const img = new Image()
    img.onload = () => setImage(img)
    img.onerror = () => { error.value = '图片无法解码' }
    img.src = url
  } catch (err: any) {
    error.value = err?.message || String(err)
  }
  input.value = ''
}

function setProgress(stage: string, cur?: number, total?: number) {
  if (!total) {
    status.value = stage
    progressLabel.value = ''
    return
  }
  const pct = (cur! / total) * 100
  progressPct.value = Math.round(pct)
  status.value = stage
  progressLabel.value = total > 100000
    ? `${(cur! / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(0)} MB (${pct.toFixed(0)}%)`
    : `${cur} / ${total} (${pct.toFixed(0)}%)`
}

function ensureModels(): Promise<MoebiusPipeline | null> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const p = new MoebiusPipeline()
    try {
      const modelBase = `${window.location.origin}/api/hf/simonw/Moebius-ONNX/resolve/main`
      await p.load(modelBase, setProgress)
      backend.value = p.backend.toUpperCase()
      status.value = t('inpainting.modelsReady')
      return p
    } catch (err: any) {
      status.value = t('inpainting.loadingModels')
      error.value = (err as Error)?.message || String(err)
      loadPromise = null // 允许重试
      return null
    }
  })()
  return loadPromise
}

async function run() {
  if (!hasImage.value) return
  error.value = null
  running.value = true
  const pipe = await ensureModels()
  if (!pipe) {
    running.value = false
    return
  }
  const t0 = performance.now()
  try {
    const out = await pipe.run(imageCanvas.value!, maskCanvas.value!, {
      steps: steps.value,
      guidance: guidance.value,
      seed: seed.value,
      paste: paste.value,
      onProgress: setProgress
    })
    const rctx = resultCanvas.value?.getContext('2d')
    rctx?.clearRect(0, 0, IMG, IMG)
    rctx?.drawImage(out, 0, 0)
    const secs = (performance.now() - t0) / 1000
    doneTime.value = secs
    status.value = `${t('inpainting.done')} ${secs.toFixed(1)}s`
    progressPct.value = 100

    // 裁剪回原图宽高比后提供下载
    let dlCanvas: HTMLCanvasElement = out
    if (fitRect && (fitRect.w !== IMG || fitRect.h !== IMG)) {
      const crop = document.createElement('canvas')
      crop.width = fitRect.w
      crop.height = fitRect.h
      crop.getContext('2d')!.drawImage(out, fitRect.x, fitRect.y, fitRect.w, fitRect.h, 0, 0, fitRect.w, fitRect.h)
      dlCanvas = crop
    }
    if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = dlCanvas.toDataURL('image/png')
  } catch (err: any) {
    error.value = (err as Error)?.message || String(err)
  } finally {
    running.value = false
  }
}

function download() {
  if (!downloadUrl.value) return
  const a = document.createElement('a')
  a.href = downloadUrl.value
  a.download = 'moebius-inpaint.png'
  a.click()
}

onBeforeUnmount(() => {
  try { if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value) } catch { /* ignore */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        icon="i-lucide-upload"
        :label="t('inpainting.upload')"
        color="primary"
        variant="subtle"
        :disabled="loading || running"
        @click="fileInput?.click()"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
      <UButton
        icon="i-lucide-eraser"
        :label="t('inpainting.clearMask')"
        color="neutral"
        variant="subtle"
        :disabled="!hasImage || running"
        @click="clearMask"
      />
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM</UBadge>
      <span v-if="backend" class="text-sm text-muted">
        {{ t('inpainting.backend') }}: ONNX Runtime Web · {{ backend }}
      </span>
      <span class="text-sm text-muted">{{ t('inpainting.modelHelp') }}</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-if="!webgpu && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('inpainting.noWebgpu')" />
    <UAlert v-if="!hasImage && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('inpainting.firstDownload')" />

    <div class="grid lg:grid-cols-2 gap-4">
      <!-- 输入：图片 + 蒙版 -->
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('mp.upload') }}</label>
        <div class="relative aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default">
          <canvas ref="imageCanvas" width="512" height="512" class="w-full h-full object-contain" />
          <canvas
            ref="maskCanvas"
            width="512"
            height="512"
            class="absolute inset-0 w-full h-full touch-none"
            :class="{ 'cursor-crosshair': hasImage }"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointerleave="onPointerUp"
          />
          <div v-if="!hasImage" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted pointer-events-none">
            <UIcon name="i-lucide-image-plus" class="size-8" />
            <span class="text-sm">{{ t('inpainting.paintHint') }}</span>
          </div>
        </div>
        <p class="mt-2 text-sm text-muted">{{ t('inpainting.paintHint') }}</p>
      </div>

      <!-- 输出 -->
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('inpainting.result') }}</label>
        <div class="relative aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default flex items-center justify-center">
          <canvas ref="resultCanvas" width="512" height="512" class="w-full h-full object-contain" />
          <div v-if="!downloadUrl && !running" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted pointer-events-none">
            <UIcon name="i-lucide-eraser" class="size-8" />
            <span class="text-sm">{{ t('inpainting.result') }}</span>
          </div>
        </div>
        <p class="mt-2 text-sm text-muted" :class="{ 'text-highlighted': status }">{{ status }}</p>
      </div>
    </div>

    <!-- 进度 -->
    <div v-if="running || progressPct > 0" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted truncate">{{ status || t('inpainting.running') }}</span>
        <span class="text-muted">{{ progressLabel }}</span>
      </div>
      <UProgress :model-value="progressPct" />
    </div>

    <!-- 参数 -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
          {{ t('demo.input') }}
        </div>
      </template>
      <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <label class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('inpainting.brush') }}: {{ brush }}</span>
          <input v-model.number="brush" type="range" min="5" max="120" class="w-full" :disabled="running">
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('inpainting.steps') }}: {{ steps }}</span>
          <input v-model.number="steps" type="range" min="4" max="30" class="w-full" :disabled="running">
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('inpainting.guidance') }}: {{ guidance }}</span>
          <input v-model.number="guidance" type="range" min="1" max="6" step="0.5" class="w-full" :disabled="running">
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('inpainting.seed') }}</span>
          <UInput v-model.number="seed" type="number" class="w-full" :disabled="running" />
        </label>
        <div class="flex items-end">
          <UCheckbox v-model="paste" :label="t('inpainting.paste')" :disabled="running" />
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <UButton
          icon="i-lucide-eraser"
          :label="t('inpainting.run')"
          color="primary"
          :loading="running"
          :disabled="!hasImage || running || loading"
          @click="run"
        />
        <UButton
          v-if="downloadUrl"
          icon="i-lucide-download"
          :label="t('inpainting.download')"
          color="secondary"
          variant="subtle"
          @click="download"
        />
        <span v-if="doneTime" class="text-sm text-muted">{{ doneTime.toFixed(1) }}s</span>
      </div>
    </UCard>
  </MediaDemoShell>
</template>
