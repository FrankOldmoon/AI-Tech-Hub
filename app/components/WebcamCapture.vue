<script setup lang="ts">
/**
 * 通用摄像头组件（从 FaceCameraCapture 抽取出的纯取帧部分）。
 * - 打开摄像头 → 实时镜像预览 → 点「拍照」把当前帧导出为 JPEG File 并 emit 'capture'。
 * - 通过命名插槽 `overlay`（作用域含 video/active）暴露实时视频，供父组件做逐帧绘制。
 * - 内置 getUserMedia 权限/设备/繁忙友好错误提示；卸载时自动停止媒体轨道。
 */
import { mediaError } from '~/utils/errors'

const { t } = useI18n()
const emit = defineEmits<{ capture: [file: File], close: [] }>()

const videoEl = ref<HTMLVideoElement>()
const active = ref(false)
const busy = ref(false)
const cameraError = ref('')

let stream: MediaStream | null = null

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
      // 自动播放：iOS/部分浏览器需要 muted / playsinline
      videoEl.value.muted = true
      videoEl.value.playsInline = true
      await videoEl.value.play().catch(() => { /* 忽略自动播放拦截 */ })
    }
  } catch (e) {
    cameraError.value = mediaError(e, t)
  } finally {
    busy.value = false
  }
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
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  active.value = false
  if (videoEl.value) videoEl.value.srcObject = null
}

function toggle() {
  if (active.value) stop()
  else open()
}

function close() {
  stop()
  emit('close')
}

// 打开即自动开启摄像头，避免「先展开再点一次」的重复操作。
// 若权限不足或失败则回落到 idle 状态，用户仍可用按钮重试。
onMounted(() => {
  void open()
})
onBeforeUnmount(() => stop())

defineExpose({ open, capture, stop, close, toggle, videoEl })
</script>

<template>
  <div class="rounded-xl border border-default/70 bg-elevated/40 p-3">
    <div
      v-if="!active"
      class="flex flex-wrap items-center gap-2"
    >
      <UButton
        icon="i-lucide-video"
        :label="t('webcam.useCamera')"
        color="secondary"
        variant="subtle"
        :loading="busy"
        @click="open"
      />
    </div>
    <div
      v-else
      class="space-y-2"
    >
      <div class="relative overflow-hidden rounded-lg bg-black">
        <video
          ref="videoEl"
          class="block w-full scale-x-[-1]"
          muted
          playsinline
        />
        <slot
          name="overlay"
          v-bind="{ video: videoEl, active }"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-lucide-camera"
          :label="t('webcam.capture')"
          color="primary"
          @click="capture"
        />
        <UButton
          icon="i-lucide-x"
          size="sm"
          color="neutral"
          variant="ghost"
          :label="t('webcam.closeCamera')"
          @click="close"
        />
      </div>
    </div>
    <UAlert
      v-if="cameraError"
      class="mt-2"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="cameraError"
    />
  </div>
</template>
