<script setup lang="ts">
/**
 * 摄像头组件（人脸注册/识别共用）：
 * - getUserMedia 打开摄像头，镜像预览（自拍习惯）
 * - 支持多摄像头切换（枚举 videoinput）
 * - 暴露 grabFrame()（当前帧 ImageData）与 capturePhoto()（拍照为 File）
 * - 关闭/卸载时自动停止视频轨道
 */

const props = defineProps<{
  /** 为 true 时打开摄像头，为 false 时关闭 */
  active: boolean
}>()

const emit = defineEmits<{
  (e: 'error', message: string): void
}>()

const { t } = useI18n()
const video = ref<HTMLVideoElement>()
const devices = ref<Array<{ label: string; value: string }>>([])
const deviceId = ref('')

let stream: MediaStream | null = null
let stopping = false

function permissionMessage(e: unknown): string {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return t('image.faceStudio.cameraPermissionDenied')
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return t('image.faceStudio.cameraNotFound')
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return t('image.faceStudio.cameraInUse')
  }
  return t('image.faceStudio.cameraPermission')
}

async function refreshDevices() {
  if (import.meta.server) return
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    const cams = list.filter(d => d.kind === 'videoinput')
    devices.value = cams.map(c => ({ label: c.label || c.deviceId.slice(0, 8), value: c.deviceId }))
    if (deviceId.value && !devices.value.some(d => d.value === deviceId.value)) {
      deviceId.value = ''
    }
  } catch {
    /* ignore */
  }
}

async function start() {
  if (stopping) return
  if (import.meta.server || !navigator.mediaDevices?.getUserMedia) {
    emit('error', t('image.faceStudio.cameraUnsupported'))
    return
  }
  try {
    const videoConstraints: MediaTrackConstraints = {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
    if (deviceId.value) {
      videoConstraints.facingMode = undefined
      videoConstraints.deviceId = { exact: deviceId.value }
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false })
    if (video.value) {
      video.value.srcObject = stream
      await video.value.play().catch(() => {})
    }
    await refreshDevices()
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    emit('error', permissionMessage(e))
  }
}

function stop() {
  stopping = true
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  if (video.value) video.value.srcObject = null
  stopping = false
}

// immediate：组件可能以 active=true 挂载（v-if 打开），此时也要启动
watch(() => props.active, (on) => {
  if (on) void start()
  else stop()
}, { immediate: true })

onBeforeUnmount(() => stop())

// 切换摄像头：先停旧流再开新流
watch(deviceId, async () => {
  if (!props.active || !deviceId.value) return
  stop()
  await new Promise(resolve => setTimeout(resolve, 50))
  await start()
})

/** 取当前视频帧（未镜像，与分析坐标一致） */
function grabFrame(): ImageData | null {
  const v = video.value
  if (!v || !v.videoWidth || !v.videoHeight) return null
  const canvas = document.createElement('canvas')
  canvas.width = v.videoWidth
  canvas.height = v.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(v, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** 拍照：当前帧转 JPEG File，可直接喂给 FacePhotoPicker.addFiles */
async function capturePhoto(): Promise<File | null> {
  const frame = grabFrame()
  if (!frame) return null
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  canvas.getContext('2d')!.putImageData(frame, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) return null
  return new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
}

defineExpose({ video, grabFrame, capturePhoto })
</script>

<template>
  <div class="space-y-2">
    <div class="relative rounded-lg overflow-hidden bg-black aspect-video">
      <div class="w-full h-full -scale-x-100">
        <video
          ref="video"
          autoplay
          playsinline
          muted
          class="w-full h-full object-contain"
        />
      </div>
      <!-- 叠加层（实时识别框）放在镜像容器外，避免文字被镜像；框坐标由父组件做水平映射 -->
      <slot />
      <div
        v-if="!stream"
        class="absolute inset-0 flex items-center justify-center text-muted text-sm bg-elevated/40"
      >
        <UIcon name="i-lucide-video-off" class="size-6 mr-2" />
        {{ t('image.faceStudio.cameraOpening') }}
      </div>
    </div>

    <div v-if="devices.length > 1" class="flex items-center gap-2 text-sm">
      <span class="text-muted shrink-0">{{ t('image.faceStudio.cameraSelect') }}</span>
      <USelect
        v-model="deviceId"
        :items="devices"
        size="sm"
        class="min-w-44"
      />
    </div>
  </div>
</template>
