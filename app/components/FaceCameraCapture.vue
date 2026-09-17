<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/**
 * 人脸摄像头：在通用取帧组件 WebcamCapture 之上只加「face-api 实时识别叠加」这一层。
 *
 * 取流、镜像预览、拍照导出 JPEG、权限/设备错误提示、卸载停轨这些都在 WebcamCapture 里，
 * 本组件不再自己写一遍 getUserMedia（以前两份逐行重复，改一处漏一处）。
 *
 * - 默认（live=false）：纯取帧，点「拍照」把当前帧交给上层。
 * - live：预览就绪后按节流间隔识别人脸，在画布上叠加人脸框与人名。
 */
import { mediaError } from '~/utils/errors'
import { extractFaces, getRegistry, recognizeDescriptor, ensureFaceApiLoaded } from '~/utils/face-studio'

const { t } = useI18n()
const props = withDefaults(defineProps<{ live?: boolean }>(), { live: false })
const emit = defineEmits<{ capture: [file: File], close: [] }>()

const overlayEl = ref<HTMLCanvasElement>()
/** 由 WebcamCapture 的 ready 事件交过来的预览 video 元素 */
const videoEl = ref<HTMLVideoElement | null>(null)
const liveReady = ref(false)
const detectionError = ref('')

let rafId = 0
let detectionBusy = false
let lastTick = 0
/** 实时识别更新间隔（毫秒）；face-api 逐帧太耗性能，做节流 */
const LIVE_INTERVAL = 450

function onCapture(file: File) {
  emit('capture', file)
}

/** 预览就绪：拿到 video 元素，live 模式下随即开跑识别循环 */
function onReady(video: HTMLVideoElement) {
  videoEl.value = video
  if (props.live) void startLiveLoop()
}

async function startLiveLoop() {
  liveReady.value = false
  try {
    await ensureFaceApiLoaded()
    liveReady.value = true
  } catch (e: any) {
    detectionError.value = mediaError(e, t)
    return
  }
  cancelLiveLoop()
  rafId = requestAnimationFrame(tick)
}

function cancelLiveLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  detectionBusy = false
}

/** 实时识别主循环：按节流间隔从视频帧取人脸，叠加画框与人名。 */
async function tick() {
  if (!props.live || !videoEl.value) return
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
    detectionError.value = ''
  } catch (e: any) {
    // 识别失败（模型/资源）走统一错误分类；取流本身的错误由 WebcamCapture 自己报
    if (props.live) detectionError.value = mediaError(e, t)
  } finally {
    detectionBusy = false
    lastTick = performance.now()
  }
}

/** 关闭：停掉本层的识别循环，停流/停轨交给 WebcamCapture 的卸载钩子 */
function onClose() {
  cancelLiveLoop()
  videoEl.value = null
  liveReady.value = false
  detectionError.value = ''
  emit('close')
}

onBeforeUnmount(cancelLiveLoop)
</script>

<template>
  <div>
    <WebcamCapture
      :open-label="t('image.faceStudio.useCamera')"
      :capture-label="t('image.faceStudio.cameraCapture')"
      :close-label="t('image.faceStudio.closeCamera')"
      @capture="onCapture"
      @close="onClose"
      @ready="onReady"
    >
      <template #overlay>
        <canvas
          v-if="props.live"
          ref="overlayEl"
          class="absolute inset-0 h-full w-full"
          :class="liveReady ? 'opacity-100' : 'opacity-0'"
        />
        <div
          v-if="props.live"
          class="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white"
        >
          <UIcon
            name="i-lucide-scan-face"
            class="size-3.5"
          />
          {{ liveReady ? t('image.faceStudio.liveRecognition') : t('image.faceStudio.analyzing') }}
        </div>
      </template>
      <template #footer>
        <div
          v-if="props.live"
          class="text-xs text-muted"
        >
          {{ t('image.faceStudio.liveHint') }}
        </div>
      </template>
    </WebcamCapture>
  </div>
</template>
