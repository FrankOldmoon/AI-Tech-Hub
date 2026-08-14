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

const downloadFormat = ref<'png' | 'jpeg' | 'webp'>('png')
const quality = ref(0.92)
const formatItems = [
  { label: 'PNG', value: 'png' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'WebP', value: 'webp' }
]

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

// ===== 工具切换与参数 =====

watch(() => props.tools, (list) => {
  if (!list.some(t => t.id === activeToolId.value)) {
    activeToolId.value = list[0]?.id ?? ''
  }
}, { immediate: true })

watch(activeToolId, () => {
  paramValues.value = paramDefaults(specs.value)
  runLater()
}, { immediate: true })

watch(paramValues, runLater, { deep: true })

function selectTool(id: string) {
  activeToolId.value = id
}

// ===== 运行 =====

function runLater() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(run, 200)
}

async function run() {
  const tool = activeTool.value
  if (!tool || !original.value) return
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
    if (res.imageData) result.value = res.imageData
    resultInfo.value = res.info ?? []
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
    resultInfo.value = []
  } finally {
    running.value = false
  }
}

function runNow() {
  if (timer) clearTimeout(timer)
  run()
}

function reset() {
  paramValues.value = paramDefaults(specs.value)
  run()
}

// ===== 上传 =====

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
    await loadFile(file)
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
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
    error.value = (e as Error)?.message || String(e)
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
    error.value = (e as Error)?.message || String(e)
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
                <canvas
                  ref="resultCanvas"
                  class="max-w-full h-auto rounded-lg border border-default"
                  :class="activeTool?.interactive === 'click' ? 'cursor-crosshair' : ''"
                  @click="onResultClick"
                />
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

            <!-- 参数面板 -->
            <DemoParams
              v-if="specs.length"
              v-model="paramValues"
              :specs="specs"
              :running="running"
            />

            <!-- 操作 -->
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
          </template>
        </div>
      </div>

      <!-- Python 参考实现 -->
      <PythonSourceViewer v-if="activeTool" :feature="activeTool.pythonModule" />
    </div>
  </UContainer>
</template>
