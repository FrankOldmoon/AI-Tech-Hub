<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import { MODELS } from '~/utils/yolo/models'
import type { YoloModel } from '~/utils/yolo/models'
import { getYoloSession, preprocess } from '~/composables/useYolo'
import {
  postprocess, drawBoxes, drawPose, drawObb, drawSeg, drawSem, drawDepth
} from '~/utils/yolo/postprocess'
import { humanError } from '~/utils/errors'

/**
 * YOLO26 全任务实时检测交互面（纯浏览器端，数据不出浏览器）
 * - 7 个任务 chips 切换；置信度滑块；FPS/结果/后端 HUD；分类 Top5 面板
 * - 外壳（标题/HowItWorks/面包屑/SEO）由 MediaDemoShell 提供
 */
const { t, locale } = useI18n()

const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()

const currentId = ref<string>(MODELS[0]!.id)
const conf = ref(25)
const running = ref(false)
const busy = ref(false)
const status = ref('')
const statusError = ref(false)
const fps = ref<number | string>('--')
const count = ref<number | string>('--')
const backend = ref<number | string>('--')
const loadingModel = ref(false)
const top5 = ref<Array<{ label: string, score: number }>>([])
const showTop5 = ref(false)

let stream: MediaStream | null = null
let rafId: number | null = null

const currentModel = computed<YoloModel>(() => MODELS.find(m => m.id === currentId.value) || MODELS[0]!)
const btnLabel = computed(() =>
  loadingModel.value ? t('yolo.loadingModelShort') : (running.value ? t('yolo.stop') : t('yolo.start'))
)
const needConf = computed(() => currentModel.value.needConf)
const confText = computed(() => (conf.value / 100).toFixed(2))

// 任务 chips（名称随 locale，icon 单独用 UIcon 渲染）
const taskChips = computed(() => MODELS.map(m => ({
  id: m.id,
  label: locale.value === 'zh' ? m.nameZh : m.nameEn,
  icon: m.icon
})))

async function selectTask(id: string) {
  if (id === currentId.value) return
  currentId.value = id
  showTop5.value = id === 'cls'
  const { backend: b } = await getYoloSession(currentModel.value)
  modelBackend.set(id, b)
  backend.value = b
}

// 记录每个已加载模型的后端，用于 chips 切换后刷新 HUD
const modelBackend = new Map<string, string>()

async function loadSession() {
  const m = currentModel.value
  status.value = t('yolo.loading', { name: locale.value === 'zh' ? m.nameZh : m.nameEn, file: m.file })
  statusError.value = false
  loadingModel.value = true
  try {
    const { backend: b } = await getYoloSession(m)
    modelBackend.set(m.id, b)
    backend.value = b
    status.value = running.value ? t('yolo.running') : t('yolo.idle')
  } catch (e: any) {
    statusError.value = true
    status.value = humanError(e, t)
  } finally {
    loadingModel.value = false
  }
}

function loop() {
  if (!running.value) return
  if (!busy.value && videoRef.value && videoRef.value.readyState >= 2) {
    busy.value = true
    ;(async () => {
      try {
        const { session } = await getYoloSession(currentModel.value)
        const p = await preprocess(videoRef.value!, currentModel.value.imgsz, currentModel.value.id === 'cls')
        const t0 = performance.now()
        const results = await session.run({ [session.inputNames[0]]: p.tensor })
        fps.value = Math.round(performance.now() - t0)
        const outputs = session.outputNames.map((n: string) => results[n])
        const res = postprocess(currentModel.value.id, outputs, p, conf.value / 100)
        syncCanvasSize()
        const canvas = canvasRef.value!
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        switch (res.type) {
          case 'boxes': drawBoxes(ctx, res.dets); count.value = res.dets.length; break
          case 'pose': drawPose(ctx, res.dets); count.value = res.dets.length; break
          case 'obb': drawObb(ctx, res.dets); count.value = res.dets.length; break
          case 'seg': drawSeg(ctx, res.dets); count.value = res.dets.length; break
          case 'sem': drawSem(ctx, res, canvas.width, canvas.height); count.value = '-'; break
          case 'depth': drawDepth(ctx, res, canvas.width, canvas.height); count.value = '-'; break
          case 'cls': top5.value = res.top5; count.value = res.label; break
        }
      } catch (e: any) {
        console.error('[yolo] 推理出错', e)
        statusError.value = true
        status.value = t('yolo.inferError') + ': ' + e.message
      } finally {
        busy.value = false
      }
    })()
  }
  rafId = requestAnimationFrame(loop)
}

function syncCanvasSize() {
  const video = videoRef.value, canvas = canvasRef.value
  if (!video || !canvas) return
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
}

async function start() {
  // 预加载默认模型（chips 用法：切换前已加载为之）
  await loadSession()
  if (statusError.value) return
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false
    })
    stream = media
    const video = videoRef.value!
    video.srcObject = media
    await video.play()
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) return resolve()
      video.addEventListener('loadeddata', () => resolve(), { once: true })
    })
    running.value = true
    status.value = t('yolo.running')
    statusError.value = false
    loop()
  } catch (e: any) {
    statusError.value = true
    status.value = t('yolo.camError') + ': ' + e.message
  }
}

function stop() {
  running.value = false
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null }
  if (videoRef.value) videoRef.value.srcObject = null
}

onBeforeUnmount(() => {
  stop()
})
</script>

<template>
  <div class="space-y-4">
    <!-- 任务切换 chips -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="c in taskChips"
        :key="c.id"
        class="rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer"
        :class="c.id === currentId
          ? 'bg-primary border-primary text-white'
          : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
        @click="selectTask(c.id)"
      >
        <UIcon
          :name="c.icon"
          class="size-4"
        />
        {{ c.label }}
      </button>
    </div>

    <!-- 控制条 -->
    <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
      <UButton
        :icon="running ? 'i-lucide-square' : 'i-lucide-video'"
        :label="btnLabel"
        :color="running ? 'error' : 'primary'"
        :variant="running ? 'subtle' : 'solid'"
        :loading="loadingModel"
        :disabled="loadingModel"
        @click="running ? stop() : start()"
      />
      <div
        v-if="needConf"
        class="flex items-center gap-2 text-sm text-muted"
      >
        <label for="yolo-conf">{{ t('yolo.confidence') }}</label>
        <input
          id="yolo-conf"
          v-model.number="conf"
          type="range"
          min="10"
          max="90"
          class="w-36 accent-primary"
        >
        <span class="tabular-nums text-highlighted min-w-8">{{ confText }}</span>
      </div>
    </div>

    <!-- 画面区 -->
    <div class="relative w-full max-w-3xl mx-auto rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center ring-1 ring-primary/10">
      <video
        ref="videoRef"
        class="w-full h-full object-contain"
        playsinline
        muted
      />
      <canvas
        ref="canvasRef"
        class="absolute inset-0 w-full h-full object-contain"
      />

      <!-- 未启动占位 -->
      <div
        v-if="!running"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 pointer-events-none"
      >
        <UIcon
          name="i-lucide-video"
          class="size-12"
        />
        <p class="text-sm">
          {{ t('yolo.placeholder') }}
        </p>
      </div>

      <!-- HUD（左上角） -->
      <div class="absolute top-2.5 left-2.5 flex gap-2 text-xs">
        <span class="bg-black/55 backdrop-blur px-2.5 py-1 rounded tabular-nums">{{ t('yolo.fps') }} <b class="text-green-400">{{ fps }}</b></span>
        <span class="bg-black/55 backdrop-blur px-2.5 py-1 rounded tabular-nums">{{ t('yolo.results') }} <b class="text-green-400">{{ count }}</b></span>
        <span class="bg-black/55 backdrop-blur px-2.5 py-1 rounded tabular-nums">{{ t('yolo.backend') }} <b class="text-green-400">{{ backend }}</b></span>
      </div>
    </div>

    <!-- 状态 -->
    <p
      class="text-sm text-muted min-h-5"
      :class="{ '!text-red-400': statusError }"
    >
      {{ status }}
    </p>

    <!-- 分类 Top5 面板 -->
    <div
      v-if="showTop5"
      class="w-full max-w-3xl mx-auto rounded-lg border border-primary/15 bg-elevated/40 p-4 space-y-1"
    >
      <div
        v-for="(item, i) in top5"
        :key="i"
        class="flex items-center gap-3 text-sm"
      >
        <span class="text-muted w-7 shrink-0">#{{ i + 1 }}</span>
        <span class="text-highlighted w-52 truncate shrink-0">{{ item.label }}</span>
        <div class="flex-1 h-2 bg-default rounded overflow-hidden">
          <div
            class="h-full rounded bg-gradient-to-r from-primary to-emerald-400"
            :style="{ width: `${(item.score * 100).toFixed(1)}%` }"
          />
        </div>
        <span class="w-12 text-right tabular-nums">{{ (item.score * 100).toFixed(1) }}%</span>
      </div>
    </div>
  </div>
</template>
