<script setup lang="ts">
/**
 * 全站唯一的摄像头取帧组件（含人脸实时识别的上层封装，见 FaceCameraCapture）。
 * - 打开摄像头 → 实时镜像预览 → 点「拍照」把当前帧导出为 JPEG File 并 emit 'capture'。
 * - 通过命名插槽 `overlay`（作用域含 video/active）暴露实时视频，供父组件做逐帧绘制；
 *   `footer` 插槽放在视频与按钮之间，用来放「实时识别中」这类说明。
 * - 文案可覆盖（openLabel / captureLabel / closeLabel），便于上层沿用自己页面的措辞。
 * - emit 'ready' 把 video 元素交出去，供上层挂自己的逐帧循环（人脸框等）。
 * - 内置 getUserMedia 权限/设备/繁忙友好错误提示；卸载时自动停止媒体轨道。
 */
import { mediaError } from '~/utils/errors'

const { t } = useI18n()
const props = withDefaults(defineProps<{
  /** 未开摄像头时按钮的文案 */
  openLabel?: string
  /** 「拍照」按钮文案 */
  captureLabel?: string
  /** 「关闭摄像头」按钮文案 */
  closeLabel?: string
}>(), {
  openLabel: undefined,
  captureLabel: undefined,
  closeLabel: undefined
})
const emit = defineEmits<{
  capture: [file: File]
  close: []
  /** 预览就绪：把 video 元素交出去，上层可开始自己的逐帧绘制 */
  ready: [video: HTMLVideoElement]
}>()

const openText = computed(() => props.openLabel ?? t('webcam.useCamera'))
const captureText = computed(() => props.captureLabel ?? t('webcam.capture'))
const closeText = computed(() => props.closeLabel ?? t('webcam.closeCamera'))

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
      emit('ready', videoEl.value)
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
        :label="openText"
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
      <slot name="footer" />
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-lucide-camera"
          :label="captureText"
          color="primary"
          @click="capture"
        />
        <UButton
          icon="i-lucide-x"
          size="sm"
          color="neutral"
          variant="ghost"
          :label="closeText"
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
