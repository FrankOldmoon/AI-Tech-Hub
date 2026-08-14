<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'
import { humanError, mediaError } from '~/utils/errors'
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { mediapipeWasm } from '~/utils/mediapipe'
import { processImageFile } from '~/utils/image'

/**
 * 通用 MediaPipe 视觉演示运行器
 * - 摄像头实时 / 图片上传双模式
 * - 通过 props 注入 createDetector / detectVideo / detectImage / draw
 * - 可调参数面板：param key 与 setOptions 选项键一一对应，变更即调用 setOptions
 * - 结果通过 #result scoped slot 暴露
 */
interface RunnerDemo {
  title: string
  description?: string
  icon: string
  status: DemoStatus
  /** 对应 python 下的模块路径，用于展示最简 Python 实现 */
  pythonModule?: string
}

const props = defineProps<{
  demo: RunnerDemo
  createDetector: (vision: any) => Promise<any>
  detectVideo: (detector: any, video: HTMLVideoElement, timestamp: number) => any
  detectImage: (detector: any, image: ImageBitmap) => any
  draw?: (ctx: CanvasRenderingContext2D, result: any) => void
  paramSpecs?: ParamSpec[]
}>()

const { t } = useI18n()
const videoRef = ref<HTMLVideoElement>()
const imgRef = ref<HTMLImageElement>()
const canvasRef = ref<HTMLCanvasElement>()
const fileInput = ref<HTMLInputElement>()

const mode = ref<'webcam' | 'image'>('webcam')
const loading = ref(false)
const starting = ref(false) // 摄像头启动中（防重复点击竞态）
const running = ref(false)
const error = ref<string | null>(null)
const result = ref<any>(null)
const inferenceTime = ref(0)

// 可调参数
const paramValues = ref<Record<string, number | string | boolean>>(
  props.paramSpecs ? paramDefaults(props.paramSpecs) : {}
)
// 当 specs 变化（切换 demo/locale）时重置默认值
watch(() => props.paramSpecs, (specs) => {
  paramValues.value = specs ? paramDefaults(specs) : {}
})

let detector: any = null
let stream: MediaStream | null = null
let rafId: number | null = null
let lastVideoTime = -1

async function ensureDetector() {
  if (detector) return detector
  loading.value = true
  error.value = null
  try {
    const { FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
    detector = await props.createDetector(vision)
    // 创建后立即应用当前参数（覆盖 create 中的默认值）
    if (props.paramSpecs?.length) {
      await detector.setOptions(paramValues.value)
    }
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
  return detector
}

// 参数变更 → 实时 setOptions
watch(paramValues, async (vals) => {
  if (detector && props.paramSpecs?.length) {
    try {
      await detector.setOptions(vals)
    } catch (e: any) {
      error.value = humanError(e, t)
    }
  }
}, { deep: true })

async function startWebcam() {
  if (starting.value) return
  starting.value = true
  const det = await ensureDetector()
  if (!det) {
    starting.value = false
    return
  }
  stopLoop()
  mode.value = 'webcam'
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    const video = videoRef.value!
    video.srcObject = stream
    await video.play()
    running.value = true
    loop()
  } catch (e: any) {
    error.value = mediaError(e, t)
  } finally {
    starting.value = false
  }
}

function loop() {
  if (!running.value) return
  const video = videoRef.value
  if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime
    const t0 = performance.now()
    try {
      result.value = props.detectVideo(detector, video, performance.now())
      inferenceTime.value = Math.round(performance.now() - t0)
      drawOverlay(video)
    } catch (e: any) {
      error.value = humanError(e, t)
      stopLoop()
    }
  }
  rafId = requestAnimationFrame(loop)
}

function drawOverlay(source: HTMLVideoElement | ImageBitmap) {
  const canvas = canvasRef.value
  if (!canvas || !props.draw) return
  const w = (source as HTMLVideoElement).videoWidth || (source as ImageBitmap).width
  const h = (source as HTMLVideoElement).videoHeight || (source as ImageBitmap).height
  if (w && h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  props.draw(ctx, result.value)
  ctx.restore()
}

function stopLoop() {
  running.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function stopWebcam() {
  stopLoop()
  if (stream) {
    stream.getTracks().forEach(t => t.stop())
    stream = null
  }
  if (videoRef.value) videoRef.value.srcObject = null
}

const sampleImages = computed(() => [
  { label: t('samples.face'), url: '/samples/images/face.jpg' },
  { label: t('samples.group'), url: '/samples/images/group.jpg' },
  { label: t('samples.landscape'), url: '/samples/images/landscape.jpg' },
  { label: t('samples.document'), url: '/samples/images/document.jpg' }
])

async function useSample(url: string) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const file = new File([blob], url.split('/').pop() || 'sample.jpg', { type: blob.type })
    await runImageFile(file)
  } catch (e) {
    error.value = humanError(e, t)
  }
}

async function runImageFile(file: File) {
  const det = await ensureDetector()
  if (!det) return
  stopWebcam()
  mode.value = 'image'
  loading.value = true
  error.value = null
  try {
    // 先解码为标准 PNG（HEIC/超大图等 createImageBitmap 直接解码会失败）
    const processedUrl = await processImageFile(file)
    const img = imgRef.value!
    img.src = processedUrl
    await img.decode()
    const bitmap = await createImageBitmap(await (await fetch(processedUrl)).blob())
    const t0 = performance.now()
    result.value = props.detectImage(det, bitmap)
    inferenceTime.value = Math.round(performance.now() - t0)
    drawOverlay(bitmap)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  void runImageFile(file)
}

onBeforeUnmount(() => {
  stopWebcam()
})
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12 space-y-6">
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

      <!-- 控件 -->
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-if="!running"
          icon="i-lucide-video"
          :label="loading ? t('demo.loadingModel') : t('mp.webcam')"
          color="primary"
          :loading="starting || loading"
          :disabled="starting"
          @click="startWebcam"
        />
        <UButton
          v-else
          icon="i-lucide-square"
          :label="t('mp.stop')"
          color="error"
          variant="subtle"
          @click="stopWebcam"
        />
        <UButton
          icon="i-lucide-upload"
          :label="t('mp.upload')"
          color="neutral"
          variant="subtle"
          :disabled="loading"
          @click="fileInput?.click()"
        />
        <template v-for="s in sampleImages" :key="s.url">
          <UButton
            :label="s.label"
            icon="i-lucide-image"
            size="sm"
            color="neutral"
            variant="soft"
            :disabled="loading"
            @click="useSample(s.url)"
          />
        </template>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
        <span v-if="inferenceTime" class="text-sm text-muted ms-2">{{ inferenceTime }} ms</span>
      </div>

      <!-- 错误 -->
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

      <!-- 画面区 -->
      <div class="relative w-full max-w-3xl mx-auto rounded-xl overflow-hidden bg-elevated/60 aspect-video flex items-center justify-center">
        <video
          v-show="mode === 'webcam'"
          ref="videoRef"
          class="w-full h-full object-contain"
          style="transform: scaleX(-1)"
          playsinline
          muted
        />
        <img v-show="mode === 'image'" ref="imgRef" class="w-full h-full object-contain">
        <canvas
          ref="canvasRef"
          class="absolute inset-0 w-full h-full object-contain"
          :style="mode === 'webcam' ? 'transform: scaleX(-1)' : ''"
        />
        <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-black/40">
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-white" />
        </div>
      </div>

      <!-- 可调参数 -->
      <DemoParams v-if="paramSpecs?.length" v-model="paramValues" :specs="paramSpecs" :running="running" />

      <!-- 结果 -->
      <UCard v-if="$slots.result">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-terminal" class="size-4" />
            {{ t('demo.result') }}
          </div>
        </template>
        <slot name="result" :result="result" :inference-time="inferenceTime" />
      </UCard>

      <!-- 对应的 Python 最简实现源码 -->
      <PythonSourceViewer v-if="demo.pythonModule" :feature="demo.pythonModule" />
    </div>
  </UContainer>
</template>
