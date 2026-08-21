<script setup lang="ts">
/**
 * 人脸注册与识别（独立页面）：
 * - 注册：姓名 + 一次上传多张照片（每人多样张），合影可点选人脸；同名默认追加样张
 * - 识别：上传 1 张或多张照片，与注册库全部样张比对，返回最佳匹配与候选列表
 * - 注册库保存在浏览器 localStorage（imglab:faces:v2）
 */
import {
  getRegisteredFaces,
  addFaceSamples,
  deleteFace,
  deleteFaceSample,
  recognizeEmbeddings,
  analyzeFace,
  makeFaceThumb,
  makeThumb,
  MATCH_THRESHOLD
} from '~/utils/face-registry'
import { humanError } from '~/utils/errors'
import type { RegisteredFace } from '~/utils/face-registry'
import type { PickedPhoto } from '~/utils/face-studio'
import FaceCamera from '~/components/FaceCamera.vue'
import FacePhotoPicker from '~/components/FacePhotoPicker.vue'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'face-recognition')!)
const { t } = useI18n()

// SSR 阶段 localStorage 不可用，必须延迟到 onMounted 读取，避免 hydration 不一致
const faces = ref<RegisteredFace[]>([])
const name = ref('')
const regPhotos = ref<PickedPhoto[]>([])
const recPhotos = ref<PickedPhoto[]>([])

const busyRegister = ref(false)
const busyRecognize = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)
const result = ref<ReturnType<typeof recognizeEmbeddings> | null>(null)

// ===== 摄像头 =====
const regCamOn = ref(false)
const recCamOn = ref(false)
const regCamera = ref<InstanceType<typeof FaceCamera> | null>(null)
const recCamera = ref<InstanceType<typeof FaceCamera> | null>(null)
const regPicker = ref<InstanceType<typeof FacePhotoPicker> | null>(null)
const liveOverlay = ref<HTMLCanvasElement | null>(null)
const liveFaces = ref<Array<{ bbox: number[]; label: string; matched: boolean }>>([])
let liveTimer: ReturnType<typeof setInterval> | null = null
let liveBusy = false

onMounted(() => {
  faces.value = getRegisteredFaces()
})

const demoBusy = ref(false)
const { fetchSampleFile } = useVisionSamples()

/** 从示例图 URL 加载为 ImageData（analyzeFace 输入） */
async function loadSampleImageData(url: string): Promise<ImageData> {
  const file = await fetchSampleFile(url)
  const bitmap = await createImageBitmap(file)
  if (!bitmap.width || !bitmap.height) {
    bitmap.close?.()
    throw new Error(t('image.sizeInvalid'))
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * 课堂示例演示：注册「示例·小明」（人脸照）→ 用多人照识别。
 * 示例数据写入 localStorage（带"示例"前缀），可在注册列表删除。
 */
async function runDemo() {
  if (demoBusy.value) return
  demoBusy.value = true
  error.value = null
  success.value = null
  try {
    const regImageData = await loadSampleImageData('/samples/images/face.jpg')
    const regAnalysis = await analyzeFace(regImageData)
    if (!regAnalysis.embeddings.length) throw new Error(t('image.faceStudio.demoNoFace'))
    const regEmbedding = regAnalysis.embeddings[0]
    if (!regEmbedding) throw new Error(t('image.faceStudio.demoNoFace'))
    const { appended, created } = addFaceSamples('示例·小明', [{ embedding: regEmbedding }])
    faces.value = getRegisteredFaces()

    const recImageData = await loadSampleImageData('/samples/images/group.jpg')
    const recAnalysis = await analyzeFace(recImageData)
    if (!recAnalysis.embeddings.length) throw new Error(t('image.faceStudio.demoNoFace'))
    result.value = recognizeEmbeddings(recAnalysis.embeddings)
    success.value = t('image.faceStudio.demoSuccess', {
      status: t(created ? 'image.faceStudio.demoCreated' : 'image.faceStudio.demoAppended'),
      n: appended,
      count: recAnalysis.embeddings.length
    })
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    demoBusy.value = false
  }
}

// 识别照片变化后清空旧结果，避免误导
watch(recPhotos, () => {
  result.value = null
}, { deep: true })

/** 从已分析的照片中收集样张（每张照片取选中的那一张脸） */
function collectSamples(photos: PickedPhoto[]): Array<{ embedding: number[]; thumb?: string }> {
  return photos
    .filter(p => p.status === 'ok' && p.analysis && p.analysis.faces > 0)
    .map(p => {
      const i = Math.min(p.selectedFace, p.analysis!.faces - 1)
      const bbox = p.analysis!.bboxes?.[i]
      return {
        embedding: p.analysis!.embeddings[i],
        thumb: bbox?.length === 4 ? makeFaceThumb(p.imageData, bbox) : makeThumb(p.imageData)
      }
    })
}

async function onRegister() {
  error.value = null
  success.value = null
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('image.faceStudio.nameRequired')
    return
  }
  const samples = collectSamples(regPhotos.value)
  if (!samples.length) {
    error.value = t('image.faceStudio.registerEmpty')
    return
  }
  busyRegister.value = true
  try {
    const existed = getRegisteredFaces().some(f => f.name === trimmed)
    const { person, appended, created } = addFaceSamples(trimmed, samples)
    faces.value = getRegisteredFaces()
    success.value = created
      ? t('image.faceStudio.registerSuccess', { name: person.name, n: appended })
      : t('image.faceStudio.appendSuccess', { name: person.name, n: appended, total: person.samples.length })
    regPhotos.value = []
    name.value = ''
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    busyRegister.value = false
  }
}

async function onRecognize() {
  error.value = null
  success.value = null
  const ok = recPhotos.value.filter(p => p.status === 'ok' && p.analysis && p.analysis.faces > 0)
  if (!ok.length) {
    error.value = t('image.faceStudio.recognizeEmpty')
    return
  }
  busyRecognize.value = true
  try {
    const embeddings = ok.map(p => p.analysis!.embeddings[Math.min(p.selectedFace, p.analysis!.faces - 1)])
    result.value = recognizeEmbeddings(embeddings)
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    busyRecognize.value = false
  }
}

function onDeleteFace(id: string) {
  deleteFace(id)
  faces.value = getRegisteredFaces()
}

function onDeleteSample(personId: string, sampleId: string) {
  deleteFaceSample(personId, sampleId)
  faces.value = getRegisteredFaces()
}

// ===== 摄像头：拍照注册 =====
function onCamError(msg: string) {
  error.value = msg
}

async function onCameraCapture() {
  error.value = null
  const file = await regCamera.value?.capturePhoto()
  if (!file) {
    error.value = t('image.faceStudio.cameraNotReady')
    return
  }
  await regPicker.value?.addFiles([file])
}

// ===== 摄像头：实时识别 =====
function toggleLive() {
  recCamOn.value = !recCamOn.value
  if (recCamOn.value) {
    liveFaces.value = []
    liveTimer = setInterval(tickLive, 1200)
  } else {
    stopLive()
  }
}

function stopLive() {
  if (liveTimer) {
    clearInterval(liveTimer)
    liveTimer = null
  }
  liveBusy = false
  liveFaces.value = []
  clearOverlay()
}

function clearOverlay() {
  const canvas = liveOverlay.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx?.clearRect(0, 0, canvas.width, canvas.height)
}

async function tickLive() {
  if (liveBusy || !recCamOn.value) return
  const frame = recCamera.value?.grabFrame()
  if (!frame) return
  liveBusy = true
  try {
    const analysis = await analyzeFace(frame)
    const list: Array<{ bbox: number[]; label: string; matched: boolean }> = []
    for (let i = 0; i < analysis.faces; i++) {
      const r = recognizeEmbeddings([analysis.embeddings[i]])
      list.push({
        bbox: analysis.bboxes[i] ?? [0, 0, 0, 0],
        label: r.best
          ? `${r.best.name} ${r.best.similarity.toFixed(2)}`
          : t('image.faceStudio.liveUnknown'),
        matched: !!r.best
      })
    }
    liveFaces.value = list
    drawOverlay(list)
  } catch {
    // 单帧无脸/分析失败不打断实时识别
    liveFaces.value = []
    clearOverlay()
  } finally {
    liveBusy = false
  }
}

function drawOverlay(faces: Array<{ bbox: number[]; label: string; matched: boolean }>) {
  const canvas = liveOverlay.value
  const v = recCamera.value?.video
  if (!canvas || !v) return
  const W = v.videoWidth || 1
  const H = v.videoHeight || 1
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const f of faces) {
    const [x1, y1, x2, y2] = f.bbox
    // 预览视频被 CSS 水平镜像（scaleX(-1)），叠加层不镜像；
    // 因此绘制时要先把 bbox 的 x 坐标做水平映射，框才能与镜像后的视频对齐，文字保持正向。
    const mx1 = W - x2
    const mx2 = W - x1
    const w = mx2 - mx1
    const h = y2 - y1
    ctx.strokeStyle = f.matched ? '#34d399' : '#f87171'
    ctx.lineWidth = 3
    ctx.strokeRect(mx1, y1, w, h)
    ctx.font = '600 20px system-ui, sans-serif'
    const tw = ctx.measureText(f.label).width
    const labelY = Math.max(0, y1 - 28)
    ctx.fillStyle = f.matched ? '#34d399' : '#f87171'
    ctx.fillRect(mx1, labelY, tw + 14, 26)
    ctx.fillStyle = '#0b1220'
    ctx.fillText(f.label, mx1 + 7, labelY + 18)
  }
}

onBeforeUnmount(() => stopLive())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="warning"
      variant="subtle"
      icon="i-lucide-info"
      :title="t('image.faceStudio.firstRunNote')"
    />
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-hard-drive"
      :title="t('image.faceStudio.storageNote')"
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="error"
    />
    <UAlert
      v-if="success"
      color="success"
      variant="subtle"
      icon="i-lucide-check"
      :title="success"
    />

    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
      <UButton
        icon="i-lucide-clapperboard"
        :label="t('image.faceStudio.demoRun')"
        color="primary"
        :loading="demoBusy"
        :disabled="demoBusy || busyRegister || busyRecognize"
        @click="runDemo"
      />
      <span class="text-sm text-muted">{{ t('image.faceStudio.demoRunHint') }}</span>
    </div>

    <div class="grid lg:grid-cols-2 gap-4">
      <!-- ===== 注册 ===== -->
      <section class="rounded-lg border border-default p-4 space-y-3">
        <p class="text-xs font-medium text-muted uppercase tracking-wide">
          {{ t('image.faceStudio.registerTitle') }}
        </p>
        <p class="text-sm text-muted">{{ t('image.faceStudio.registerHint') }}</p>

        <div class="min-w-52">
          <label class="block text-sm font-medium text-muted mb-1">
            {{ t('image.faceStudio.name') }}
          </label>
          <UInput
            v-model="name"
            :placeholder="t('image.faceStudio.namePlaceholder')"
            :disabled="busyRegister"
          />
        </div>

        <FacePhotoPicker ref="regPicker" v-model:photos="regPhotos" :disabled="busyRegister" />

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            :icon="regCamOn ? 'i-lucide-camera-off' : 'i-lucide-camera'"
            :label="t(regCamOn ? 'image.faceStudio.closeCamera' : 'image.faceStudio.useCamera')"
            color="neutral"
            variant="soft"
            :disabled="busyRegister"
            @click="regCamOn = !regCamOn"
          />
          <UButton
            v-if="regCamOn"
            icon="i-lucide-aperture"
            :label="t('image.faceStudio.cameraCapture')"
            color="primary"
            variant="soft"
            :disabled="busyRegister"
            @click="onCameraCapture"
          />
        </div>
        <FaceCamera
          v-if="regCamOn"
          ref="regCamera"
          :active="regCamOn"
          @error="onCamError"
        />

        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-user-plus"
            :label="t('image.faceStudio.registerBtn')"
            color="primary"
            :loading="busyRegister"
            :disabled="!name.trim() || busyRegister"
            @click="onRegister"
          />
          <UButton
            v-if="regPhotos.length"
            icon="i-lucide-trash-2"
            :label="t('image.faceStudio.clearPhotos')"
            color="neutral"
            variant="soft"
            :disabled="busyRegister"
            @click="regPhotos = []"
          />
        </div>
      </section>

      <!-- ===== 识别 ===== -->
      <section class="rounded-lg border border-default p-4 space-y-3">
        <p class="text-xs font-medium text-muted uppercase tracking-wide">
          {{ t('image.faceStudio.recognizeTitle') }}
        </p>
        <p class="text-sm text-muted">{{ t('image.faceStudio.recognizeHint') }}</p>

        <FacePhotoPicker v-model:photos="recPhotos" :disabled="busyRecognize" />

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            :icon="recCamOn ? 'i-lucide-video-off' : 'i-lucide-video'"
            :label="t(recCamOn ? 'image.faceStudio.stopLive' : 'image.faceStudio.liveRecognition')"
            color="secondary"
            variant="soft"
            :disabled="busyRecognize"
            @click="toggleLive"
          />
        </div>

        <template v-if="recCamOn">
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            :title="t('image.faceStudio.liveHint')"
          />
          <FaceCamera ref="recCamera" :active="recCamOn" @error="onCamError">
            <canvas
              ref="liveOverlay"
              class="absolute inset-0 w-full h-full pointer-events-none"
            />
          </FaceCamera>
        </template>

        <UButton
          icon="i-lucide-scan-face"
          :label="t('image.faceStudio.recognizeBtn')"
          color="secondary"
          variant="soft"
          :loading="busyRecognize"
          :disabled="busyRecognize"
          @click="onRecognize"
        />

        <div v-if="result" class="rounded-lg bg-elevated/60 p-3 space-y-2">
          <p class="text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-user-check" class="size-4 inline" />
            <template v-if="result.best">
              {{ t('image.faceStudio.matched') }}：{{ result.best.name }}
              <span class="text-muted font-normal">
                · {{ t('image.faceStudio.similarity') }} {{ result.best.similarity.toFixed(4) }}
              </span>
            </template>
            <template v-else>
              {{ t('image.faceStudio.notRecognized', { t: MATCH_THRESHOLD }) }}
            </template>
          </p>
          <div v-if="result.candidates.length" class="space-y-1">
            <p class="text-xs text-muted uppercase tracking-wide">{{ t('image.faceStudio.candidates') }}</p>
            <div
              v-for="(c, i) in result.candidates.slice(0, 3)"
              :key="c.name + i"
              class="flex justify-between text-sm"
              :class="i === 0 ? 'text-highlighted font-medium' : 'text-muted'"
            >
              <span>{{ i + 1 }}. {{ c.name }}</span>
              <span>{{ c.similarity.toFixed(4) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ===== 已注册人脸 ===== -->
    <section class="rounded-lg border border-default p-4 space-y-3">
      <p class="text-xs font-medium text-muted uppercase tracking-wide">
        {{ t('image.faceStudio.registeredList') }}（{{ faces.length }}）
      </p>
      <p v-if="!faces.length" class="text-sm text-dimmed">
        {{ t('image.faceStudio.empty') }}
      </p>
      <ul v-else class="grid sm:grid-cols-2 gap-3">
        <li
          v-for="f in faces"
          :key="f.id"
          class="rounded-lg border border-default p-3 space-y-2"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium text-highlighted truncate">{{ f.name }}</p>
            <div class="flex items-center gap-2">
              <UBadge color="neutral" variant="subtle">
                {{ f.samples.length }} {{ t('image.faceStudio.sampleCount') }}
              </UBadge>
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="error"
                variant="ghost"
                :aria-label="t('image.faceStudio.delete')"
                @click="onDeleteFace(f.id)"
              />
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <div v-for="s in f.samples" :key="s.id" class="relative group">
              <img
                v-if="s.thumb"
                :src="s.thumb"
                class="size-12 rounded-lg object-cover border border-default"
                alt=""
              >
              <div v-else class="size-12 rounded-lg bg-elevated/60 border border-default" />
              <button
                type="button"
                class="absolute -top-1 -right-1 size-4 rounded-full bg-error text-white hidden group-hover:flex items-center justify-center"
                :aria-label="t('image.faceStudio.deleteSample')"
                @click="onDeleteSample(f.id, s.id)"
              >
                <UIcon name="i-lucide-x" class="size-2.5" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </MediaDemoShell>
</template>
