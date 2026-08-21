<script setup lang="ts">
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'
import { humanError, mediaError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'image-segmenter')!)

const videoRef = ref<HTMLVideoElement>()
const imgRef = ref<HTMLImageElement>()
const canvasRef = ref<HTMLCanvasElement>()
const fileInput = ref<HTMLInputElement>()

const mode = ref<'webcam' | 'image'>('webcam')
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)

let segmenter: any = null
let DrawingUtilsCtor: any = null
let stream: MediaStream | null = null
let rafId: number | null = null
let lastTime = -1

async function ensure() {
  if (segmenter) return segmenter
  loading.value = true
  error.value = null
  try {
    const { FilesetResolver, ImageSegmenter, DrawingUtils } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
    DrawingUtilsCtor = DrawingUtils
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.selfieSegmenter, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false
    })
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
  return segmenter
}

function drawMask(result: any) {
  const canvas = canvasRef.value
  if (!canvas || !result?.categoryMask) return
  const w = mode.value === 'webcam' ? videoRef.value!.videoWidth : imgRef.value!.naturalWidth
  const h = mode.value === 'webcam' ? videoRef.value!.videoHeight : imgRef.value!.naturalHeight
  if (w && h) { canvas.width = w; canvas.height = h }
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const d = new DrawingUtilsCtor(ctx)
  d.drawCategoryMask(result.categoryMask, ['rgba(0,0,0,0)', 'rgba(0,220,130,0.6)'])
}

async function startWebcam() {
  const s = await ensure()
  if (!s) return
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
  }
}

function loop() {
  if (!running.value) return
  const video = videoRef.value
  if (video && video.readyState >= 2 && video.currentTime !== lastTime) {
    lastTime = video.currentTime
    try {
      segmenter.segmentForVideo(video, performance.now(), (result: any) => drawMask(result))
    } catch (e: any) {
      error.value = humanError(e, t)
      stopLoop()
    }
  }
  rafId = requestAnimationFrame(loop)
}

function stopLoop() {
  running.value = false
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
}

function stopWebcam() {
  stopLoop()
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
  if (videoRef.value) videoRef.value.srcObject = null
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
  stopWebcam()
  mode.value = 'image'
  loading.value = true
  error.value = null
  try {
    const bitmap = await createImageBitmap(file)
    const img = imgRef.value!
    img.src = URL.createObjectURL(file)
    await new Promise<void>((resolve) => { img.onload = () => resolve() })
    segmenter.segmentForVideo(bitmap, performance.now(), (result: any) => drawMask(result))
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
// 分割演示专用样本：单人照优先（前景掩码干净），多人照作难度对照
const samples = computed(() => [
  { label: t('samples.personPhoto'), url: '/samples/images/person.jpg' },
  { label: t('samples.face'), url: '/samples/images/face.jpg' },
  { label: t('samples.group'), url: '/samples/images/group.jpg' }
])

onMounted(() => {
  // 课堂演示：打开页面自动加载单人照并分割（前景掩码干净），第一时间出结果
  useSample('/samples/images/person.jpg')
})

onBeforeUnmount(() => stopWebcam())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-2">
      <UButton v-if="!running" icon="i-lucide-video" :label="t('mp.webcam')" color="primary" :loading="loading" @click="startWebcam" />
      <UButton v-else icon="i-lucide-square" :label="t('mp.stop')" color="error" variant="subtle" @click="stopWebcam" />
      <UButton icon="i-lucide-upload" :label="t('mp.upload')" color="neutral" variant="subtle" :disabled="loading" @click="fileInput?.click()" />
      <SampleImagePicker
        :samples="samples"
        @pick="useSample"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <div class="relative w-full max-w-3xl mx-auto rounded-xl overflow-hidden bg-elevated/60 aspect-video flex items-center justify-center">
      <video v-show="mode === 'webcam'" ref="videoRef" class="w-full h-full object-contain" style="transform: scaleX(-1)" playsinline muted />
      <img v-show="mode === 'image'" ref="imgRef" class="w-full h-full object-contain">
      <canvas ref="canvasRef" class="absolute inset-0 w-full h-full object-contain" :style="mode === 'webcam' ? 'transform: scaleX(-1)' : ''" />
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-black/40">
        <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-white" />
      </div>
    </div>
  </MediaDemoShell>
</template>
