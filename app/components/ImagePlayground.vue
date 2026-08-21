<script setup lang="ts">
/**
 * 图像工坊通用 Playground：
 * - 左侧：本页工具列表（Tab 切换）
 * - 右侧：上传区 → 原图/结果双画布 + 参数面板 + 信息 + 下载
 * - 底部：当前工具的 Python 参考实现
 *
 * 工具全部来自 ~/utils/image-tools 注册表，本组件不包含任何算法逻辑。
 */
import type { LocalizedDemo } from '~/utils/demos'
import { humanError } from '~/utils/errors'
import type { ImageTool, ImageToolKind } from '~/utils/image-tools'
import { buildParamSpecs, pickText } from '~/utils/image-tools'
import { paramDefaults } from '~/utils/params'
import { processImageFile } from '~/utils/image'
import * as alg from '~/utils/image-algorithms'

const props = defineProps<{
  demo: LocalizedDemo
  tools: ImageTool[]
}>()

const { t, locale } = useI18n()
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))

useSeoMeta({
  title: () => props.demo.title,
  description: () => props.demo.description || '',
  ogTitle: () => props.demo.title,
  ogDescription: () => props.demo.description || ''
})

const fileInput = ref<HTMLInputElement>()
const origCanvas = ref<HTMLCanvasElement>()
const resultCanvas = ref<HTMLCanvasElement>()
const secondFileInput = ref<HTMLInputElement>()
const secondCanvas = ref<HTMLCanvasElement>()

const original = ref<ImageData | null>(null)
const secondOriginal = ref<ImageData | null>(null)
const result = ref<ImageData | null>(null)
const resultInfo = ref<{ label: string; value: string }[]>([])
const fileName = ref('')
const secondFileName = ref('')
const sourceBytes = ref(0)
const running = ref(false)
const error = ref<string | null>(null)
const dragOver = ref(false)

const activeToolId = ref('')
const activeTool = computed<ImageTool | undefined>(() => props.tools.find(t => t.id === activeToolId.value) || props.tools[0])
const specs = computed(() => buildParamSpecs(activeTool.value?.params, lang.value))
const paramValues = ref<Record<string, number | string | boolean>>({})
/**
 * resize 工具的结果图显示比例：
 * 默认 canvas 用 max-w-full 固定撑满容器，像素尺寸变化在显示上不可见；
 * resize 工具改为按固定显示比例渲染（像素变大 → 显示变大），
 * 拖动手柄才能真正"看到"图片缩放效果。
 * 注意：必须声明在 watch(activeToolId) 之前（immediate watch 会同步访问）。
 */
const resultScale = ref(0)

const downloadFormat = ref<'png' | 'jpeg' | 'webp'>('png')
const quality = ref(0.92)
const formatItems = [
  { label: 'PNG', value: 'png' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'WebP', value: 'webp' }
]

// ===== 结果图弹性过渡（Apple「可中断弹簧 + 方向暗示」）=====
// 切工具 / 手柄松手 / 慢工具出结果时，结果容器轻微缩放弹入，提示「结果已更新」
const pulseTarget = ref(1)
const resultPulse = useSpring(pulseTarget, { damping: 0.95, stiffness: 260 })

function pulseResult(scale = 0.97) {
  pulseTarget.value = scale
  // 等弹簧先收敛到缩小值（~80ms），再弹回 1.0，产生「新结果弹入」的方向暗示
  setTimeout(() => {
    pulseTarget.value = 1
  }, 80)
}

const kindLabels: Record<ImageToolKind, string> = {
  canvas: 'Canvas',
  opencv: 'OpenCV.js',
  mediapipe: 'MediaPipe',
  transformers: 'Transformers.js',
  tesseract: 'Tesseract',
  python: 'Python'
}

function kindLabel(kind: ImageToolKind): string {
  return kindLabels[kind]
}

let timer: ReturnType<typeof setTimeout> | null = null
let rafId = 0
let latestReq = 0
let pending = false

// ===== 工具切换与参数 =====

watch(() => props.tools, (list) => {
  if (!list.some(t => t.id === activeToolId.value)) {
    activeToolId.value = list[0]?.id ?? ''
  }
}, { immediate: true })

watch(activeToolId, () => {
  paramValues.value = paramDefaults(specs.value)
  runLater()
  // 切回 resize 工具时重置显示基准，按当前容器宽度重新计算
  if (activeTool.value?.id === 'resize') {
    resultScale.value = 0
    nextTick(updateResultScale)
  }
}, { immediate: true })

watch(paramValues, scheduleRun, { deep: true })

function selectTool(id: string) {
  activeToolId.value = id
  pulseResult(0.97)
}

// ===== 运行 =====

/** canvas 工具即时预览（rAF 节流），慢工具（AI/OpenCV 等）保持防抖 */
function isImmediateTool() {
  return activeTool.value?.kind === 'canvas'
}

function scheduleRun() {
  ++latestReq
  if (isImmediateTool()) {
    // 拖动/点击即时响应：每帧至多重跑一次，参数变化立即生效
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0
        // run() 默认取最新 latestReq，避免帧执行前参数又变导致结果被丢弃
        run()
      })
    }
  } else {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => run(), 200)
  }
}

function runLater() {
  scheduleRun()
}

async function run(req = latestReq) {
  const tool = activeTool.value
  if (!tool || !original.value) return
  // 运行中收到新请求：标记 pending，当前完成后立即补跑最新参数（不再丢弃）
  if (running.value) {
    pending = true
    return
  }
  running.value = true
  error.value = null
  try {
    // 防御：参数始终与默认值合并，避免首次运行缺键导致 NaN
    const mergedParams = { ...paramDefaults(specs.value), ...paramValues.value }
    const res = await tool.run({
      imageData: alg.cloneImageData(original.value),
      original: original.value,
      secondImage: secondOriginal.value ?? undefined,
      params: mergedParams,
      lang: lang.value
    })
    if (req === latestReq) {
      if (res.imageData) result.value = res.imageData
      resultInfo.value = res.info ?? []
    }
  } catch (e) {
    if (req === latestReq) {
      error.value = humanError(e, t)
      resultInfo.value = []
    }
  } finally {
    running.value = false
    if (pending) {
      pending = false
      run(latestReq)
    }
  }
}

function runNow() {
  if (timer) clearTimeout(timer)
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  run()
}

function reset() {
  paramValues.value = paramDefaults(specs.value)
  run()
}

// ===== resize 拖拽手柄（与参数面板双向联动） =====
const resizing = ref(false)
const resizeStart = ref({ x: 0, y: 0, w: 0, h: 0 })

function onResizeStart(e: MouseEvent) {
  const canvas = resultCanvas.value
  if (!canvas || !result.value) return
  e.preventDefault()
  resizing.value = true
  resizeStart.value = {
    x: e.clientX,
    y: e.clientY,
    w: result.value.width,
    h: result.value.height
  }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!resizing.value || !result.value) return
  const canvas = resultCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  // 显示尺寸 → 像素尺寸换算
  const scaleX = result.value.width / rect.width
  const scaleY = result.value.height / rect.height
  const newW = Math.min(4096, Math.max(1, Math.round(resizeStart.value.w + (e.clientX - resizeStart.value.x) * scaleX)))
  const newH = Math.min(4096, Math.max(1, Math.round(resizeStart.value.h + (e.clientY - resizeStart.value.y) * scaleY)))
  // 联动：写入参数（keep 开启时高度由 run 自动保持宽高比）
  const keep = Boolean(paramValues.value.keep)
  paramValues.value = {
    ...paramValues.value,
    width: newW,
    ...(keep ? {} : { height: newH })
  }
}

function onResizeEnd() {
  resizing.value = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  // 手柄松手：轻微「settle」确认
  pulseResult(0.99)
}

function updateResultScale() {
  const canvas = resultCanvas.value
  if (!canvas || !result.value) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width && rect.height) {
    resultScale.value = rect.width / result.value.width
  }
}

// 首个结果出来后计算显示基准（拖动过程中不重算，保持拖拽映射线性）
watch(result, (v) => {
  if (activeTool.value?.id === 'resize' && v && resultScale.value === 0) {
    nextTick(updateResultScale)
  }
  // 慢工具（AI/OpenCV 等）出结果：轻微弹入提示更新（canvas 工具每帧重绘不弹）
  if (v && !isImmediateTool() && !resizing.value) {
    pulseResult(0.985)
  }
})

// ===== 上传 =====

const sampleImages = computed(() => [
  { label: t('samples.face'), url: '/samples/images/portrait.jpg' },
  { label: t('samples.group'), url: '/samples/images/group.jpg' },
  { label: t('samples.landscape'), url: '/samples/images/landscape.jpg' },
  { label: t('samples.document'), url: '/samples/images/document.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' }
])

async function useSample(url: string) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const file = new File([blob], url.split('/').pop() || 'sample.jpg', { type: blob.type })
    await loadFile(file)
  } catch (e) {
    error.value = humanError(e, t)
  }
}

async function loadFile(file: File) {
  if (!file.type.startsWith('image/')) {
    error.value = t('image.error') + ': ' + file.name
    return
  }
  try {
    const url = await processImageFile(file, 2048)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    original.value = ctx.getImageData(0, 0, canvas.width, canvas.height)
    fileName.value = file.name
    sourceBytes.value = file.size
    result.value = null
    resultInfo.value = []
    error.value = null
    runLater()
  } catch (e) {
    error.value = humanError(e, t)
  }
}

async function loadSecondFile(file: File) {
  if (!file.type.startsWith('image/')) return
  try {
    const url = await processImageFile(file, 2048)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    secondOriginal.value = ctx.getImageData(0, 0, canvas.width, canvas.height)
    secondFileName.value = file.name
    runLater()
  } catch (e) {
    error.value = humanError(e, t)
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) loadFile(f)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) loadFile(f)
}

function openSecondFilePicker() {
  secondFileInput.value?.click()
}

function onSecondFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) loadSecondFile(f)
}

function onSecondDrop(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0]
  if (f) loadSecondFile(f)
}

// ===== 画布 =====

function drawCanvas(canvas: HTMLCanvasElement | undefined, data: ImageData | null) {
  if (!canvas || !data) return
  canvas.width = data.width
  canvas.height = data.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(data, 0, 0)
}

watch(original, (v) => drawCanvas(origCanvas.value, v), { flush: 'post' })
watch(result, (v) => drawCanvas(resultCanvas.value, v), { flush: 'post' })
watch(secondOriginal, (v) => drawCanvas(secondCanvas.value, v), { flush: 'post' })

function onResultClick(e: MouseEvent) {
  const tool = activeTool.value
  const canvas = resultCanvas.value
  if (!tool?.onPick || !canvas || !result.value || !original.value) return
  const rect = canvas.getBoundingClientRect()
  const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width))
  const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height))
  resultInfo.value = tool.onPick({
    imageData: result.value,
    original: original.value,
    secondImage: secondOriginal.value ?? undefined,
    params: paramValues.value,
    lang: lang.value
  }, x, y)
}

// ===== 下载 =====

function download() {
  const canvas = resultCanvas.value
  if (!canvas) return
  const fmt = downloadFormat.value
  const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png'
  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${props.demo.slug}-${activeTool.value?.id ?? 'result'}.${fmt === 'jpeg' ? 'jpg' : fmt}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, mime, quality.value)
}

const modeText = computed(() => {
  if (!original.value) return ''
  return alg.hasAlpha(original.value) ? t('image.modeRgba') : t('image.modeRgb')
})
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="space-y-6">
      <!-- 页面标题 -->
      <div class="flex items-start gap-4">
        <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UIcon :name="demo.icon" class="size-6" />
        </div>
        <div class="min-w-0">
          <h1 class="text-2xl font-bold text-highlighted">
            {{ demo.title }}
          </h1>
          <p class="mt-1 text-muted">
            {{ demo.description }}
          </p>
        </div>
      </div>

      <div class="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-6 items-start">
        <!-- 工具列表 -->
        <UCard class="lg:sticky lg:top-20">
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-wrench" class="size-4 text-primary" />
              <span>{{ t('image.tools') }}</span>
            </div>
          </template>
          <nav class="space-y-1">
            <button
              v-for="tool in tools"
              :key="tool.id"
              type="button"
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors cursor-pointer"
              :class="tool.id === activeToolId
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted hover:bg-elevated/60 hover:text-highlighted'"
              @click="selectTool(tool.id)"
            >
              <span class="truncate flex-1">{{ pickText(tool.name, lang) }}</span>
              <span
                v-if="tool.planned"
                class="text-[10px] px-1.5 py-0.5 rounded bg-neutral/10 text-dimmed shrink-0"
              >
                {{ t('image.planned') }}
              </span>
              <span class="text-[10px] uppercase tracking-wide text-dimmed shrink-0">{{ kindLabel(tool.kind) }}</span>
            </button>
          </nav>
        </UCard>

        <!-- 主区域 -->
        <div class="space-y-4 min-w-0">
          <!-- 上传区 -->
          <div
            v-if="!original"
            class="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors"
            :class="dragOver ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/60'"
            @click="openFilePicker"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <UIcon name="i-lucide-image-plus" class="size-10 text-muted mx-auto" />
            <p class="mt-3 text-sm font-medium text-highlighted">{{ t('image.upload') }}</p>
            <p class="mt-1 text-xs text-dimmed">{{ t('image.uploadHint') }}</p>
            <div class="mt-4 flex flex-wrap justify-center items-center gap-2" @click.stop>
              <span class="text-xs text-dimmed">{{ t('samples.trySample') }}:</span>
              <UButton
                v-for="s in sampleImages"
                :key="s.url"
                :label="s.label"
                icon="i-lucide-image"
                size="xs"
                color="neutral"
                variant="soft"
                @click="useSample(s.url)"
              />
            </div>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onFileChange"
          >

          <template v-if="original">
            <!-- 图片信息 -->
            <div class="flex flex-wrap gap-2 text-xs">
              <UBadge color="neutral" variant="subtle">{{ fileName }}</UBadge>
              <UBadge color="neutral" variant="subtle">{{ original.width }} × {{ original.height }}</UBadge>
              <UBadge color="neutral" variant="subtle">{{ alg.formatBytes(sourceBytes) }}</UBadge>
              <UBadge color="neutral" variant="subtle">{{ modeText }}</UBadge>
            </div>

            <!-- 控制区：参数面板 + 操作按钮（置于展示框上方） -->
            <div class="space-y-3">
              <DemoParams
                v-if="specs.length"
                v-model="paramValues"
                :specs="specs"
                :running="running"
              />

              <div class="flex flex-wrap items-center gap-2">
                <UButton icon="i-lucide-play" :loading="running" @click="runNow">
                  {{ t('image.run') }}
                </UButton>
                <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="soft" @click="reset">
                  {{ t('image.reset') }}
                </UButton>
                <div class="ms-auto flex items-center gap-2">
                  <USelect
                    v-model="downloadFormat"
                    :items="formatItems"
                    class="w-32"
                    :aria-label="t('image.format')"
                  />
                  <UButton
                    icon="i-lucide-download"
                    color="primary"
                    variant="solid"
                    :disabled="!result"
                    @click="download"
                  >
                    {{ t('image.download') }}
                  </UButton>
                </div>
              </div>
            </div>

            <!-- 原图 / 结果 -->
            <div class="grid md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">{{ t('image.original') }}</p>
                <canvas ref="origCanvas" class="max-w-full h-auto rounded-lg border border-default" />
              </div>
              <div class="space-y-2">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">
                  {{ t('image.result') }}
                  <span v-if="running" class="text-primary normal-case tracking-normal ms-2">
                    <UIcon name="i-lucide-loader-circle" class="size-3.5 inline animate-spin align-[-2px]" />
                    {{ t('image.processing') }}
                  </span>
                </p>
                <div class="overflow-auto rounded-lg border border-default">
                  <div
                    class="relative w-fit"
                    :style="{ transform: `scale(${resultPulse})`, transformOrigin: 'center' }"
                  >
                    <canvas
                      ref="resultCanvas"
                      class="rounded-lg"
                      :class="[
                        activeTool?.id === 'resize' ? '' : 'max-w-full h-auto',
                        activeTool?.interactive === 'click' ? 'cursor-crosshair' : ''
                      ]"
                      :style="activeTool?.id === 'resize' && result && resultScale > 0
                        ? { width: `${Math.round(result.width * resultScale)}px`, height: `${Math.round(result.height * resultScale)}px` }
                        : undefined"
                      @click="onResultClick"
                    />
                    <!-- resize 拖拽手柄：拖动调整输出尺寸，与参数面板联动 -->
                    <button
                      v-if="activeTool?.id === 'resize' && result"
                      type="button"
                      class="absolute bottom-1.5 right-1.5 size-7 rounded-md bg-primary/90 text-white flex items-center justify-center shadow cursor-nwse-resize hover:bg-primary transition-colors"
                      :class="{ 'ring-2 ring-primary': resizing }"
                      :aria-label="t('image.resizeDrag')"
                      @mousedown="onResizeStart"
                    >
                      <UIcon
                        name="i-lucide-move-diagonal"
                        class="size-4"
                      />
                    </button>
                  </div>
                </div>
                <p v-if="activeTool?.interactive === 'click'" class="text-xs text-dimmed">
                  {{ t('image.clickHint') }}
                </p>
              </div>
            </div>

            <!-- 第二张图（双图工具） -->
            <div v-if="activeTool?.needsSecondImage" class="rounded-lg border border-default p-4">
              <p class="text-xs font-medium text-muted uppercase tracking-wide mb-2">{{ t('image.secondImage') }}</p>
              <div
                v-if="!secondOriginal"
                class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary/60"
                @click="openSecondFilePicker"
                @dragover.prevent
                @drop.prevent="onSecondDrop"
              >
                <UIcon name="i-lucide-image-plus" class="size-8 text-muted mx-auto" />
                <p class="mt-2 text-xs text-dimmed">{{ t('image.secondImageHint') }}</p>
              </div>
              <div v-else class="flex items-start gap-3">
                <canvas ref="secondCanvas" class="max-w-[180px] h-auto rounded-lg border border-default" />
                <div class="text-xs text-muted space-y-1">
                  <p>{{ secondFileName }}</p>
                  <p>{{ secondOriginal.width }} × {{ secondOriginal.height }}</p>
                  <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-refresh-cw" @click="openSecondFilePicker">
                    {{ t('image.replaceSecond') }}
                  </UButton>
                </div>
              </div>
            </div>
            <input
              ref="secondFileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onSecondFileChange"
            >

            <!-- 结果信息 -->
            <div v-if="resultInfo.length" class="rounded-lg border border-default p-3">
              <p class="text-xs font-medium text-muted uppercase tracking-wide mb-2">{{ t('image.info') }}</p>
              <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div v-for="(row, i) in resultInfo" :key="i" class="flex justify-between gap-4">
                  <span class="text-muted shrink-0">{{ row.label }}</span>
                  <span class="text-highlighted font-mono text-right">{{ row.value }}</span>
                </div>
              </div>
            </div>

            <!-- 错误 -->
            <UAlert
              v-if="error"
              color="error"
              variant="subtle"
              icon="i-lucide-alert-triangle"
              :title="error"
            />
          </template>
        </div>
      </div>

      <!-- Python 参考实现 -->
      <PythonSourceViewer v-if="activeTool" :feature="activeTool.pythonModule" />
    </div>
  </UContainer>
</template>
