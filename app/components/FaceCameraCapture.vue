<script setup lang="ts">
/**
 * 摄像头拍照组件。
 * - 默认：实时预览（镜像），点「拍照」把当前帧导出为 JPEG File 并 emit 'capture'。
 * - live 模式：每次打开即连续做 face-api 实时识别，在画面叠加人脸框与人名（无需逐帧拍照）。
 * 内置 getUserMedia 权限/设备/繁忙友好错误提示；卸载时自动停止媒体轨道。
 */
import { mediaError } from '~/utils/errors'
import { extractFaces, getRegistry, recognizeDescriptor, ensureFaceApiLoaded } from '~/utils/face-studio'

const { t } = useI18n()
const props = withDefaults(defineProps<{ live?: boolean }>(), { live: false })
const emit = defineEmits<{ capture: [file: File], close: [] }>()

const videoEl = ref<HTMLVideoElement>()
const overlayEl = ref<HTMLCanvasElement>()
const active = ref(false)
const busy = ref(false)
const cameraError = ref('')
const liveReady = ref(false)

let stream: MediaStream | null = null
let rafId = 0
let detectionBusy = false
let detectionError = ''
let lastTick = 0
/** 实时识别更新间隔（毫秒）；face-api 逐帧太耗性能，做节流 */
const LIVE_INTERVAL = 450

async function open() {
  if (active.value) return
  cameraError.value = ''
  busy.value = true
  stream = null
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraError.value = t('errors.unsupported')
      return
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
    active.value = true
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      // 自动播放：iOS/部分浏览器需要 usesinnet / muted / playsinline
      videoEl.value.muted = true
      videoEl.value.playsInline = true
      await videoEl.value.play().catch(() => { /* 忽略自动播放拦截 */ })
    }
    if (props.live) startLiveLoop()
  } catch (e: any) {
    cameraError.value = mediaError(e, t)
  } finally {
    busy.value = false
  }
}

/** 实时识别主循环：按节流间隔从视频帧取人脸，叠加画框与人名。 */
async function startLiveLoop() {
  liveReady.value = false
  try {
    await ensureFaceApiLoaded()
    liveReady.value = true
  } catch (e: any) {
    cameraError.value = mediaError(e, t)
    return
  }
  cancelLiveLoop()
  rafId = requestAnimationFrame(tick)
}

function cancelLiveLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  detectionBusy = false
}

async function tick() {
  if (!active.value || !props.live) return
  rafId = requestAnimationFrame(tick)
  const now = performance.now()
  if (detectionBusy || now - lastTick < LIVE_INTERVAL) return
  detectionBusy = true
  await nextTick()
  try {
    const video = videoEl.value
    const canvas = overlayEl.value
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // 背景：绘制（镜像后的）当前视频帧
    ctx.save()
    ctx.translate(vw, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, vw, vh)
    ctx.restore()

    const faces = await extractFaces(video as unknown as HTMLImageElement)
    const list = getRegistry()
    for (const f of faces) {
      const hit = recognizeDescriptor(f.descriptor, list)
      // 人脸框坐标需随镜像翻转
      const x = vw - f.box.x - f.box.width
      const y = f.box.y
      const color = hit ? '#22c55e' : '#ef4444'
      ctx.lineWidth = 3
      ctx.strokeStyle = color
      ctx.strokeRect(x, y, f.box.width, f.box.height)
      const label = hit ? `${hit.name} ${Math.round(hit.similarity * 100)}%` : t('image.faceStudio.liveUnknown')
      const fs = Math.max(12, Math.round(f.box.height / 6))
      ctx.font = `600 ${fs}px system-ui, sans-serif`
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.fillRect(x, y - fs - 6, tw + 8, fs + 6)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, x + 4, y - 4)
    }
  } catch (e: any) {
    detectionError = humanized(e)
  } finally {
    detectionBusy = false
    lastTick = performance.now()
  }
}

function humanized(e: any): string {
  if (!props.live) return ''
  try { return mediaError(e, t) } catch { return '' }
}

function capture() {
  const video = videoEl.value
  if (!video || !video.videoWidth) {
    cameraError.value = t('errors.unknown')
    return
  }
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(video, 0, 0)
  canvas.toBlob((blob) => {
    if (blob) emit('capture', new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }))
  }, 'image/jpeg', 0.85)
}

function stop() {
  cancelLiveLoop()
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  active.value = false
  if (videoEl.value) videoEl.value.srcObject = null
}

function close() {
  stop()
  emit('close')
}

onBeforeUnmount(() => stop())
</script>

<template>
  <div class="rounded-xl border border-default/70 bg-elevated/40 p-3">
    <div v-if="!active" class="flex flex-wrap items-center gap-2">
      <UButton icon="i-lucide-video" :label="t('image.faceStudio.useCamera')" color="secondary" variant="subtle" :loading="busy" @click="open" />
    </div>
    <div v-else class="space-y-2">
      <div class="relative overflow-hidden rounded-lg bg-black">
        <video ref="videoEl" class="block w-full scale-x-[-1]" muted playsinline />
        <canvas
          v-if="props.live"
          ref="overlayEl"
          class="absolute inset-0 h-full w-full"
          :class="liveReady ? 'opacity-100' : 'opacity-0'"
        />
        <div v-if="props.live" class="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
          <UIcon name="i-lucide-scan-face" class="size-3.5" />
          {{ liveReady ? t('image.faceStudio.liveRecognition') : t('image.faceStudio.analyzing') }}
        </div>
      </div>
      <div v-if="props.live" class="text-xs text-muted">{{ t('image.faceStudio.liveHint') }}</div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton icon="i-lucide-camera" :label="t('image.faceStudio.cameraCapture')" color="primary" @click="capture" />
        <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" :label="t('image.faceStudio.closeCamera')" @click="close" />
      </div>
    </div>
    <UAlert v-if="cameraError" class="mt-2" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="cameraError" />
  </div>
</template>