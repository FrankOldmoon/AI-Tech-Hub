<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 特征提取入门（教学页，与「像素原理」「图像处理入门」同组）。
 *
 * 教学图讲四步：输入图像 → 特征提取 → 特征图 → 理解。
 * 这页把四步做成一条能动手的链，同一张图逐步被「看」出来：
 *
 *   1 输入图像      真实照片（这一步只提供素材）
 *   2 特征提取      6 个卷积核各自在图上滑一遍 —— 换核 = 换「看什么」
 *                   （竖直/水平/对角边缘、斑点角点、锐化、平滑反例），
 *                   外加一个能自己填权重的 3×3 核
 *   3 特征图        响应值 → 激活（ReLU / 取模）→ 池化 → 伪彩热力图，
 *                   再叠成一摞「通道」—— 这就是分类器真正读的输入
 *   4 理解          真的跑一个分类模型（EfficientNet-Lite0），
 *                   看「特征 → 类别」这一步长什么样
 *
 * 为什么第 2 步要摆一排核而不是只给一个边缘算子：学生最容易误解「AI 看见轮廓」，
 * 实际上是**一叠方向不同的核**各看各的，拼起来才是「看见」。所以换核时响应图必须换得很明显。
 *
 * 执行层在 ~/utils/feature-extraction（纯函数，Node 里可测）；这页只管摆画面与交互。
 * 计算全部在浏览器本地完成，不上传任何图片。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { ScalarField } from '~/utils/feature-extraction'
import { humanError } from '~/utils/errors'
import { loadImageData } from '~/utils/image'
import {
  CUSTOM_KERNEL_DEFAULT,
  FEATURE_KERNELS,
  KERNEL_PRESETS,
  absField,
  convolveField,
  fieldToImageData,
  matrixSum,
  poolField,
  reluField,
  statsOf,
  toGrayFloat
} from '~/utils/feature-extraction'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'feature-extraction')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

/** 处理尺寸上限：卷积是逐像素 9 次乘加，原图直接跑会明显卡顿（一节课要即时反馈） */
const MAX_EDGE = 720

/** 自定义核的 id（不是真核，只是在画廊里占一个位置） */
const CUSTOM_ID = 'custom'
const CUSTOM_WEIGHT_MAX = 4

/** 四个步骤：顺序即讲解顺序，与教学图一一对应 */
const lesson: Array<{ id: string, icon: string, title: L, kind: string }> = [
  { id: 'input', icon: 'i-lucide-image', title: { zh: '1 输入图像', en: '1 Input Image' }, kind: 'ORIGINAL' },
  { id: 'extract', icon: 'i-lucide-grid-3x3', title: { zh: '2 特征提取', en: '2 Feature Extraction' }, kind: 'CONVOLUTION · 3×3' },
  { id: 'map', icon: 'i-lucide-flame', title: { zh: '3 特征图', en: '3 Feature Map' }, kind: 'RELU · HEATMAP' },
  { id: 'understand', icon: 'i-lucide-brain', title: { zh: '4 理解', en: '4 Understanding' }, kind: 'EFFICIENTNET-LITE0' }
]

/** 为什么重要（教学图右侧那一栏） */
const whyItems = [
  {
    icon: 'i-lucide-search',
    title: { zh: '只看重要的', en: 'Finds what matters' },
    text: { zh: '把注意力放在关键结构上，而不是几千个像素各看各的。', en: 'Focuses on the key patterns instead of every single pixel.' }
  },
  {
    icon: 'i-lucide-rocket',
    title: { zh: '认得更准', en: 'Improves accuracy' },
    text: { zh: '特征稳定了，换个角度、换点光线也照样认得出来。', en: 'Stable features keep recognition reliable across angles and lighting.' }
  },
  {
    icon: 'i-lucide-gauge',
    title: { zh: '更快更省', en: 'Faster & smarter' },
    text: { zh: '把复杂图像压成有用的少量信息，后续计算量一下降下来。', en: 'Compresses complex images into a small amount of useful information.' }
  },
  {
    icon: 'i-lucide-lightbulb',
    title: { zh: '到处都是它', en: 'Used everywhere' },
    text: { zh: '自动驾驶、人脸解锁、照片滤镜、医学影像、安防系统都从这里开始。', en: 'Self-driving cars, face unlock, photo filters, medical imaging, security.' }
  }
]

// ===== 状态 =====
const selected = ref(lesson[0]!.id)
const source = ref<ImageData | null>(null)
const sourceLabel = ref('')
/** 卷积的输入：单通道浮点（彩色图先去色，省 3 倍计算） */
const gray = ref<ScalarField | null>(null)
/** 各核的响应图（按核 id 存；算完一个塞一个，画廊逐个亮起来） */
const responses = ref<Record<string, ScalarField>>({})
const computing = ref(false)
const errorMsg = ref('')

/** 自定义 3×3 核的权重 */
const customWeights = ref<number[][]>(CUSTOM_KERNEL_DEFAULT.map(row => [...row]))
const customResponse = ref<ScalarField | null>(null)
const customPending = ref(false)

/** 第 3 步的显示参数：激活方式与池化 */
const reluOn = ref(false)
const poolSize = ref(1)
/** 第 3 步看哪个核的特征图 */
const mapKernelId = ref(FEATURE_KERNELS[0]!.id)

/** 第 4 步：分类结果 */
const predictions = ref<Array<{ name: string, score: number }>>([])
const classifying = ref(false)
const classifyMs = ref<number | null>(null)
const classifyError = ref('')

const activeRow = computed(() => lesson.find(s => s.id === selected.value) ?? lesson[0]!)
const kernelById = (id: string) => FEATURE_KERNELS.find(k => k.id === id)

/** 画廊里的全部条目：6 个教学核 + 一个自定义槽位 */
const galleryItems = computed(() => [
  ...FEATURE_KERNELS.map(k => ({
    id: k.id,
    name: pick(k.name),
    matrix: k.matrix,
    counterExample: !!k.counterExample
  })),
  { id: CUSTOM_ID, name: pick({ zh: '自定义核', en: 'Your kernel' }), matrix: customWeights.value, counterExample: false }
])

/** 第 2 步选中的核；未选择时落在第一个核上 */
const selectedKernelId = ref(FEATURE_KERNELS[0]!.id)
/** 当前选中的核（自定义时返回 null，页面走另一套讲解文案） */
const activeKernel = computed(() => (selectedKernelId.value === CUSTOM_ID ? null : kernelById(selectedKernelId.value) ?? null))

function fieldFor(id: string): ScalarField | null {
  return id === CUSTOM_ID ? customResponse.value : responses.value[id] ?? null
}

const activeField = computed(() => fieldFor(selectedKernelId.value))
const activeMatrix = computed(() => (selectedKernelId.value === CUSTOM_ID ? customWeights.value : activeKernel.value?.matrix ?? []))
const activeStats = computed(() => (activeField.value ? statsOf(activeField.value) : null))
const activeExplains = computed(() => activeKernel.value
  ? pick(activeKernel.value.responds)
  : pick({
      zh: '这是你自己写的核：中间那一格是「自己」，四周是「邻居」。改一个数字，响应图立刻变 —— 卷积核就是这么被设计（或被训练）出来的。',
      en: 'This is your own kernel: the centre cell is the pixel itself, the ring around it is its neighbours. Change one number and the response map changes at once — this is how kernels are designed (or learned).'
    }))

/** 第 3 步：特征图所在核的响应 → 激活 → 池化 */
const mapSource = computed(() => responses.value[mapKernelId.value] ?? null)
const mapField = computed<ScalarField | null>(() => {
  const base = mapSource.value
  if (!base) return null
  return poolField(reluOn.value ? reluField(base) : absField(base), poolSize.value)
})
const mapStats = computed(() => (mapSource.value ? statsOf(mapSource.value) : null))
/** 特征图选哪个核 */
const mapKernelOptions = computed(() => FEATURE_KERNELS.map(k => ({ label: pick(k.name), value: k.id })))

/** 多通道堆叠：前 4 个核各出一张特征图 */
const stackKernels = computed(() => FEATURE_KERNELS.slice(0, 4))

const sidebarItems = computed<ToolSidebarItem[]>(() => lesson.map(step => ({
  id: step.id,
  label: pick(step.title),
  kind: step.kind,
  icon: step.icon,
  badge: step.id === 'extract' && computing.value ? t('image.processing') : undefined
})))

// ===== 计算 =====
/** 递增轮次：换图后旧的那一轮在每个 await 后自行退出 */
let computeToken = 0

/**
 * 从灰度图开始逐个核算响应：每算完一个就刷新一次画面，
 * 画廊里的瓦片会一个个亮起来，学生能看见「一个核一个核地看过去」。
 */
async function computeResponses() {
  const g = gray.value
  if (!g) return
  const token = ++computeToken
  computing.value = true
  responses.value = {}
  try {
    for (const kernel of FEATURE_KERNELS) {
      if (token !== computeToken) return
      const field = convolveField(g, kernel.matrix)
      if (token !== computeToken) return
      responses.value = { ...responses.value, [kernel.id]: field }
      // 让出一帧：瓦片逐个填上，也避免长任务把界面卡住
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally {
    if (token === computeToken) computing.value = false
  }
  void computeCustom()
}

let customTimer: ReturnType<typeof setTimeout> | undefined

/** 改权重时不必每个按键都算一遍：停手 160ms 再算 */
function scheduleCustom() {
  customPending.value = true
  if (customTimer) clearTimeout(customTimer)
  customTimer = setTimeout(() => {
    customPending.value = false
    void computeCustom()
  }, 160)
}

async function computeCustom() {
  const g = gray.value
  if (!g) return
  const matrix = customWeights.value.map(row => row.map(v => Number(v) || 0))
  customResponse.value = convolveField(g, matrix)
}

function setWeight(row: number, col: number, value: number | string) {
  const next = customWeights.value.map(r => [...r])
  const clamped = Math.max(-CUSTOM_WEIGHT_MAX, Math.min(CUSTOM_WEIGHT_MAX, Number(value) || 0))
  next[row]![col] = clamped
  customWeights.value = next
  scheduleCustom()
}

function usePreset(matrix: number[][]) {
  if (customTimer) clearTimeout(customTimer)
  customWeights.value = matrix.map(row => [...row])
  customPending.value = false
  void computeCustom()
}

// ===== 分类（第 4 步）=====
/** 分类器只创建一次，换图重跑时复用；卸载时关掉 */
let classifier: any = null

async function ensureClassifier() {
  if (classifier) return classifier
  const [{ ImageClassifier, FilesetResolver }, { mediapipeWasm, mediapipeModels }] = await Promise.all([
    import('@mediapipe/tasks-vision'),
    import('~/utils/mediapipe')
  ])
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  const baseOptions = { modelAssetPath: mediapipeModels.imageClassifier, delegate: 'GPU' as const }
  const options = {
    baseOptions,
    runningMode: 'IMAGE' as const,
    maxResults: 5
  }
  try {
    classifier = await ImageClassifier.createFromOptions(vision, options)
  } catch {
    // 没有 WebGL2 的机器上用 CPU 兜底，慢一点但能跑
    classifier = await ImageClassifier.createFromOptions(vision, {
      ...options,
      baseOptions: { ...baseOptions, delegate: 'CPU' as const }
    })
  }
  return classifier
}

/** 真的跑一遍分类：输入是原图，输出是 Top-5 类别与置信度 */
async function runClassify() {
  const image = source.value
  if (!image || classifying.value) return
  classifying.value = true
  classifyError.value = ''
  const started = performance.now()
  try {
    const model = await ensureClassifier()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d')!.putImageData(image, 0, 0)
    const bitmap = await createImageBitmap(canvas)
    let result: any
    try {
      result = model.classify(bitmap)
    } finally {
      bitmap.close?.()
    }
    const categories: any[] = result?.classifications?.[0]?.categories ?? []
    predictions.value = categories.map(c => ({
      name: c.categoryName || c.displayName || c.label || '?',
      score: Number(c.score) || 0
    }))
    classifyMs.value = Math.round(performance.now() - started)
  } catch (e: any) {
    classifyError.value = humanError(e, t)
  } finally {
    classifying.value = false
  }
}

// ===== 画布 =====
/** 画布键 → 元素；用函数 ref 收集，任何一次状态变化都整批重绘 */
const canvases = new Map<string, HTMLCanvasElement>()

function setCanvas(key: string, el: unknown) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el)
  else canvases.delete(key)
}

/** 画布键 → 该显示的像素数据（只算当前真正挂在页面上的那些） */
function imageFor(key: string): ImageData | null {
  if (key === 'solo') return source.value
  if (key === 'gray') return gray.value ? fieldToImageData(gray.value) : null
  if (key.startsWith('k-')) {
    const field = fieldFor(key.slice(2))
    return field ? fieldToImageData(field) : null
  }
  if (key === 'big') return activeField.value ? fieldToImageData(activeField.value) : null
  if (key === 'map-mag') return mapField.value ? fieldToImageData(mapField.value) : null
  if (key === 'map-color') return mapField.value ? fieldToImageData(mapField.value, { colorize: true }) : null
  if (key.startsWith('stack-')) {
    const field = fieldFor(key.slice(6))
    return field ? fieldToImageData(poolField(absField(field), poolSize.value), { colorize: true }) : null
  }
  return null
}

function drawCanvas(key: string, el: HTMLCanvasElement, image: ImageData | null) {
  if (!image) return
  if (el.width !== image.width) el.width = image.width
  if (el.height !== image.height) el.height = image.height
  const ctx = el.getContext('2d')
  if (ctx) ctx.putImageData(image, 0, 0)
}

async function drawAll() {
  await nextTick()
  for (const [key, el] of canvases) drawCanvas(key, el, imageFor(key))
}

watch(
  [source, responses, customResponse, activeField, mapField, poolSize, selected],
  () => { void drawAll() },
  { flush: 'post' }
)

// ===== 输入 =====
const samples = computed(() => [
  { label: t('samples.dog'), url: '/samples/images/dog.jpg' },
  { label: t('samples.cat'), url: '/samples/images/cat.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' },
  { label: t('samples.texture'), url: '/samples/images/texture.jpg' }
])

function setSource(image: ImageData, label: string) {
  source.value = image
  sourceLabel.value = label
  gray.value = toGrayFloat(image)
  // 换图后上一次的结论作废；模型已加载的话顺手重跑一遍
  predictions.value = []
  classifyMs.value = null
  const rerun = !!classifier
  void computeResponses().then(() => {
    if (rerun) void runClassify()
  })
}

async function useSample(url: string, label: string) {
  try {
    errorMsg.value = ''
    setSource(await loadImageData(url, MAX_EDGE), label)
  } catch (e: any) {
    errorMsg.value = humanError(e, t)
  }
}

function onFile(file: File) {
  void (async () => {
    try {
      errorMsg.value = ''
      setSource(await loadImageData(file, MAX_EDGE), file.name)
    } catch (e: any) {
      errorMsg.value = humanError(e, t)
    }
  })()
}

function onSample(url: string) {
  void useSample(url, samples.value.find(s => s.url === url)?.label ?? '')
}

/** 切步骤：第一次进第 4 步时才去加载分类模型（约 18MB，不提前占带宽） */
function selectStep(id: string | number) {
  selected.value = String(id)
  if (selected.value === 'understand' && !predictions.value.length) void runClassify()
}

/** 权重显示：整数直接显示，小数留两位（平滑核是 1/9） */
function fmtWeight(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

const weightSum = computed(() => matrixSum(customWeights.value))

onMounted(() => {
  void useSample(samples.value[0]?.url ?? '', samples.value[0]?.label ?? '')
})

onBeforeUnmount(() => {
  if (customTimer) clearTimeout(customTimer)
  try {
    classifier?.close?.()
  } catch {
    // 关闭失败不影响离开页面
  }
  classifier = null
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <!-- 出错提示放页面级：任何一步失败都要看得见 -->
      <UAlert
        v-if="errorMsg"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="errorMsg"
      />

      <!-- 四步：左侧步骤工具栏，点一步看一步 -->
      <ToolSidebar
        :model-value="selected"
        :items="sidebarItems"
        :title="pick({ zh: '四个步骤', en: 'Four steps' })"
        title-icon="i-lucide-list-ordered"
        @update:model-value="selectStep"
      >
        <UCard :key="activeRow.id">
          <template #header>
            <div class="flex flex-wrap items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                :name="activeRow.icon"
                class="size-4 text-primary"
              />
              <span>{{ pick(activeRow.title) }}</span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ activeRow.kind }}
              </UBadge>
              <UBadge
                v-if="activeRow.id === 'input' && sourceLabel"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ sourceLabel }}
              </UBadge>
              <UBadge
                v-if="activeRow.id === 'input' && source"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ source.width }} × {{ source.height }}
              </UBadge>
              <UBadge
                v-if="activeRow.id === 'extract' && computing"
                color="info"
                variant="subtle"
                size="xs"
              >
                {{ t('image.processing') }}
              </UBadge>
            </div>
          </template>

          <!-- ===== 1 输入图像 ===== -->
          <template v-if="activeRow.id === 'input'">
            <canvas
              v-if="source"
              :ref="el => setCanvas('solo', el)"
              class="w-full rounded border border-default"
            />
            <p
              v-else
              class="rounded border border-dashed border-default p-8 text-center text-sm text-muted"
            >
              {{ pick({ zh: '还没有选图。', en: 'No image selected yet.' }) }}
            </p>

            <p class="mt-3 text-sm text-muted">
              {{ pick({
                zh: '这是真实世界的原图。AI 并不会「一眼看懂」它 —— 它先要在这堆像素里找出值得看的结构，这就是后面三步在做的事。',
                en: 'This is the raw image from the real world. AI does not simply “see” it: it first has to find the structures worth looking at in these pixels — that is what the next three steps do.'
              }) }}
            </p>

            <MediaInput
              class="mt-4"
              accept="image/*"
              camera
              :samples="samples"
              @select="onFile"
              @sample="onSample"
            />

            <!-- 为什么重要：教学图右侧那一栏 -->
            <div class="mt-6">
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '为什么这一步重要？', en: 'Why is it important?' }) }}
              </p>
              <div class="grid gap-3 sm:grid-cols-2">
                <div
                  v-for="item in whyItems"
                  :key="item.icon"
                  class="flex gap-3 rounded border border-default p-3"
                >
                  <UIcon
                    :name="item.icon"
                    class="mt-0.5 size-5 shrink-0 text-primary"
                  />
                  <div>
                    <p class="text-sm font-medium text-highlighted">
                      {{ pick(item.title) }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ pick(item.text) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- ===== 2 特征提取 ===== -->
          <div
            v-else-if="activeRow.id === 'extract'"
            class="space-y-4"
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '工作图（灰度，卷积的输入）', en: 'Working image (grayscale, the convolution input)' }) }}
                </p>
                <canvas
                  v-if="gray"
                  :ref="el => setCanvas('gray', el)"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '响应图', en: 'Response map' }) }} ·
                  {{ selectedKernelId === CUSTOM_ID ? pick({ zh: '自定义核', en: 'Your kernel' }) : pick(activeKernel?.name ?? { zh: '', en: '' }) }}
                </p>
                <canvas
                  v-if="activeField"
                  :ref="el => setCanvas('big', el)"
                  class="w-full rounded border border-default"
                />
                <p
                  v-else
                  class="rounded border border-dashed border-default p-8 text-center text-xs text-muted"
                >
                  {{ pick({ zh: '计算中…', en: 'Computing…' }) }}
                </p>
              </div>
            </div>

            <!-- 选中核的权重、响应强度与讲解 -->
            <div class="grid gap-4 rounded border border-default p-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '卷积核 (3×3)', en: 'Kernel (3×3)' }) }}
                </p>
                <div class="inline-grid grid-cols-3 gap-1 rounded bg-elevated p-1">
                  <template
                    v-for="(row, ri) in activeMatrix"
                    :key="ri"
                  >
                    <span
                      v-for="(v, ci) in row"
                      :key="`${ri}-${ci}`"
                      class="flex size-9 items-center justify-center rounded text-xs tabular-nums"
                      :class="v > 0 ? 'bg-error/15 text-error' : v < 0 ? 'bg-info/15 text-info' : 'text-muted'"
                    >
                      {{ fmtWeight(v) }}
                    </span>
                  </template>
                </div>
                <p class="mt-1 text-xs text-muted">
                  {{ pick({ zh: '权重和', en: 'Sum' }) }} = {{ fmtWeight(matrixSum(activeMatrix)) }}
                </p>
              </div>
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    v-if="activeStats"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ pick({ zh: '峰值', en: 'Peak' }) }} {{ Math.round(activeStats.maxAbs) }}
                  </UBadge>
                  <UBadge
                    v-if="activeStats"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ pick({ zh: '平均', en: 'Mean' }) }} {{ Math.round(activeStats.meanAbs) }}
                  </UBadge>
                  <UBadge
                    v-if="activeStats"
                    :color="activeStats.focus > 0.6 ? 'success' : 'warning'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ pick({ zh: '响应集中度', en: 'Focus' }) }} {{ Math.round(activeStats.focus * 100) }}%
                  </UBadge>
                </div>
                <p class="text-sm text-muted">
                  {{ activeExplains }}
                </p>
                <p class="text-xs text-muted">
                  {{ pick({
                    zh: '「响应集中度」= 1 − 平均 / 峰值：越高说明响应越集中在少数结构上（那才叫特征）；平滑核处处都在响应，这个数字就低。',
                    en: 'Focus = 1 − mean / peak: the higher it is, the more the response concentrates on a few structures (that is what a feature is). A smoothing kernel responds everywhere, so its focus is low.'
                  }) }}
                </p>
              </div>
            </div>

            <!-- 卷积核画廊 -->
            <div>
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '换一个核 = 换一种「看」法（点一个试试）', en: 'Swap the kernel, change what it sees (click one)' }) }}
              </p>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  v-for="item in galleryItems"
                  :key="item.id"
                  type="button"
                  class="rounded border p-2 text-left transition"
                  :class="selectedKernelId === item.id
                    ? 'border-primary bg-primary/5'
                    : 'border-default hover:border-primary/60'"
                  @click="selectedKernelId = item.id"
                >
                  <div class="inline-grid grid-cols-3 gap-px">
                    <span
                      v-for="(v, ci) in item.matrix.flat()"
                      :key="ci"
                      class="size-4 rounded-sm text-[9px] leading-4 text-center tabular-nums"
                      :class="v > 0 ? 'bg-error/20 text-error' : v < 0 ? 'bg-info/20 text-info' : 'bg-elevated text-muted'"
                    >
                      {{ fmtWeight(v) }}
                    </span>
                  </div>
                  <canvas
                    :ref="el => setCanvas(`k-${item.id}`, el)"
                    class="mt-2 w-full rounded border border-default"
                  />
                  <p class="mt-1 truncate text-xs font-medium text-highlighted">
                    {{ item.name }}
                  </p>
                  <p
                    v-if="item.counterExample"
                    class="text-[11px] text-warning"
                  >
                    {{ pick({ zh: '反例：不提特征', en: 'Counter-example: no feature' }) }}
                  </p>
                </button>
              </div>
            </div>

            <!-- 自定义核：自己填权重，立刻看到响应 -->
            <div
              v-if="selectedKernelId === CUSTOM_ID"
              class="space-y-3 rounded border border-default p-3"
            >
              <p class="text-sm font-medium text-highlighted">
                {{ pick({ zh: '自己写一个核', en: 'Write your own kernel' }) }}
              </p>
              <div class="flex flex-wrap items-start gap-4">
                <div class="grid grid-cols-3 gap-1">
                  <template
                    v-for="(row, ri) in customWeights"
                    :key="ri"
                  >
                    <input
                      v-for="(v, ci) in row"
                      :key="`${ri}-${ci}`"
                      :value="v"
                      type="number"
                      :min="-CUSTOM_WEIGHT_MAX"
                      :max="CUSTOM_WEIGHT_MAX"
                      step="1"
                      class="h-9 w-12 rounded border border-default bg-default px-1 text-center text-xs tabular-nums outline-none focus:border-primary"
                      @change="setWeight(ri, ci, ($event.target as HTMLInputElement).value)"
                    >
                  </template>
                </div>
                <div class="min-w-48 flex-1 space-y-2">
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      v-for="preset in KERNEL_PRESETS"
                      :key="preset.id"
                      size="xs"
                      variant="soft"
                      color="neutral"
                      @click="usePreset(preset.matrix)"
                    >
                      {{ pick(preset.name) }}
                    </UButton>
                  </div>
                  <p class="text-xs text-muted">
                    {{ weightSum === 0
                      ? pick({ zh: '权重和为 0 → 输出只剩变化（纯边缘），整体亮度会被减掉。', en: 'Sum = 0 → only changes survive (pure edges); overall brightness cancels out.' })
                      : Math.abs(weightSum - 1) < 0.01
                        ? pick({ zh: '权重和为 1 → 保留整体亮度，只把结构叠回原图（锐化）。', en: 'Sum = 1 → brightness is preserved and structure is added back (sharpen).' })
                        : pick({ zh: '权重和不为 0 也不为 1 → 输出会整体变亮或变暗，再叠加结构。', en: 'Sum is neither 0 nor 1 → the whole output gets brighter or darker, then structure is added.' }) }}
                  </p>
                  <p
                    v-if="customPending"
                    class="text-xs text-muted"
                  >
                    {{ pick({ zh: '计算中…', en: 'Computing…' }) }}
                  </p>
                </div>
              </div>
            </div>

            <p class="text-xs text-muted">
              {{ pick({
                zh: '每个核都在整张图上滑一遍：每停一个位置就做 9 次乘法再相加，得到一个数 —— 于是每个像素都得到一个响应值，排成一张图就是响应图。红格是正权重、蓝格是负权重：正负相对，说明这个核在比「左右（或上下）哪边更亮」。',
                en: 'Each kernel slides across the whole image: at every stop it does 9 multiplications and adds them up, yielding one number — so every pixel gets a response value, and the grid of values is the response map. Red cells are positive weights, blue are negative: their opposition is what makes the kernel compare which side is brighter.'
              }) }}
            </p>
          </div>

          <!-- ===== 3 特征图 ===== -->
          <div
            v-else-if="activeRow.id === 'map'"
            class="space-y-4"
          >
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">{{ pick({ zh: '看哪个核', en: 'Kernel' }) }}</span>
                <USelect
                  v-model="mapKernelId"
                  :items="mapKernelOptions"
                  size="xs"
                  class="w-44"
                />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">{{ pick({ zh: '激活', en: 'Activation' }) }}</span>
                <UButton
                  size="xs"
                  :variant="reluOn ? 'solid' : 'soft'"
                  color="neutral"
                  @click="reluOn = !reluOn"
                >
                  {{ reluOn ? pick({ zh: 'ReLU（负响应清零）', en: 'ReLU (negatives → 0)' }) : pick({ zh: '绝对值（保留全部响应）', en: 'Absolute value (keep both)' }) }}
                </UButton>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">{{ pick({ zh: '池化', en: 'Pooling' }) }}</span>
                <div class="flex gap-1">
                  <UButton
                    v-for="size in [1, 2, 4]"
                    :key="size"
                    size="xs"
                    :variant="poolSize === size ? 'solid' : 'soft'"
                    color="neutral"
                    @click="poolSize = size"
                  >
                    {{ size === 1 ? pick({ zh: '无', en: 'none' }) : `${size}×${size}` }}
                  </UButton>
                </div>
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-3">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '灰度原图', en: 'Grayscale input' }) }}
                </p>
                <canvas
                  v-if="gray"
                  :ref="el => setCanvas('gray', el)"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '响应强度（归一化灰度）', en: 'Response magnitude (normalised grey)' }) }}
                </p>
                <canvas
                  v-if="mapField"
                  :ref="el => setCanvas('map-mag', el)"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '特征图（伪彩热力）', en: 'Feature map (false-colour heat)' }) }}
                </p>
                <canvas
                  v-if="mapField"
                  :ref="el => setCanvas('map-color', el)"
                  class="w-full rounded border border-default"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                v-if="mapField"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ mapField.width }} × {{ mapField.height }}
                <template v-if="poolSize > 1">
                  （{{ pick({ zh: `池化 ${poolSize}×${poolSize}`, en: `pooled ${poolSize}×${poolSize}` }) }}）
                </template>
              </UBadge>
              <UBadge
                v-if="mapStats"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ pick({ zh: '峰值', en: 'Peak' }) }} {{ Math.round(mapStats.maxAbs) }}
              </UBadge>
              <UBadge
                v-if="mapStats"
                :color="mapStats.focus > 0.6 ? 'success' : 'warning'"
                variant="subtle"
                size="xs"
              >
                {{ pick({ zh: '响应集中度', en: 'Focus' }) }} {{ Math.round(mapStats.focus * 100) }}%
              </UBadge>
            </div>

            <p class="text-sm text-muted">
              {{ pick({
                zh: '响应值可能很大也可能很负，人眼看不出来，所以先按这张图自己的峰值归一化（最亮的拉到满格），再上伪彩色。蓝色是「几乎没反应」，红色是「反应最强」—— 亮的那些地方就是这张图里被挑出来的特征。',
                en: 'Responses can be huge or strongly negative, which the eye cannot read, so values are first normalised by this map’s own peak (the strongest response fills the scale) and then coloured. Blue means “almost no reaction”, red means “strongest reaction” — the bright areas are the features this kernel picked out.'
              }) }}
            </p>

            <!-- 多通道堆叠：一个核一张图，叠起来才是 CNN 的输入 -->
            <div>
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '一叠特征图 = 一叠通道', en: 'A stack of feature maps = a stack of channels' }) }}
              </p>
              <div class="relative mx-auto aspect-[4/3] w-full max-w-xl">
                <canvas
                  v-for="(k, i) in stackKernels"
                  :key="k.id"
                  :ref="el => setCanvas(`stack-${k.id}`, el)"
                  class="absolute inset-0 m-auto max-h-full max-w-full rounded border border-default shadow-sm"
                  :style="{
                    transform: `translate(${i * 14}px, ${-i * 14}px)`,
                    zIndex: i
                  }"
                />
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <UBadge
                  v-for="(k, i) in stackKernels"
                  :key="k.id"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ i + 1 }}. {{ pick(k.name) }}
                </UBadge>
              </div>
              <p class="mt-2 text-xs text-muted">
                {{ pick({
                  zh: '一个核出一张特征图，几十上百个核就叠成一摞通道。第 4 步的分类器读的正是这一摞，而不是原始像素 —— 也就是说：AI 是先「看结构」，再「下结论」。',
                  en: 'One kernel produces one feature map; dozens or hundreds of kernels stack into a pile of channels. Step 4’s classifier reads that pile, not the raw pixels — in other words, AI looks at structure first and decides afterwards.'
                }) }}
              </p>
            </div>
          </div>

          <!-- ===== 4 理解 ===== -->
          <div
            v-else
            class="space-y-4"
          >
            <div class="grid gap-4 lg:grid-cols-2">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '输入图像', en: 'Input image' }) }}
                </p>
                <canvas
                  v-if="source"
                  :ref="el => setCanvas('solo', el)"
                  class="w-full rounded border border-default"
                />
                <p class="mt-1 text-xs text-muted">
                  {{ pick({
                    zh: '分类器并不是直接读这张图 —— 它读的是第 3 步那一摞特征图。',
                    en: 'The classifier does not read this image directly — it reads the stack of feature maps from step 3.'
                  }) }}
                </p>
              </div>

              <div class="space-y-3">
                <p class="text-xs text-muted">
                  {{ pick({ zh: '识别结果（Top-5）', en: 'Predictions (Top-5)' }) }}
                </p>

                <div
                  v-if="classifying"
                  class="flex items-center gap-2 text-sm text-muted"
                >
                  <UIcon
                    name="i-lucide-loader-circle"
                    class="size-4 animate-spin"
                  />
                  <span>{{ t('demo.inferring') }}</span>
                </div>

                <template v-else-if="predictions.length">
                  <PredictionBars
                    :predictions="predictions"
                    :top-class="predictions[0]?.name"
                  />
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                      v-if="classifyMs !== null"
                      color="neutral"
                      variant="subtle"
                      size="xs"
                    >
                      {{ t('image.elapsed') }} {{ classifyMs }} ms
                    </UBadge>
                    <UBadge
                      color="neutral"
                      variant="subtle"
                      size="xs"
                    >
                      EfficientNet-Lite0 · ImageNet 1000
                    </UBadge>
                    <UButton
                      size="xs"
                      variant="soft"
                      color="neutral"
                      @click="runClassify"
                    >
                      {{ pick({ zh: '重新运行', en: 'Run again' }) }}
                    </UButton>
                  </div>
                </template>

                <template v-else>
                  <UAlert
                    v-if="classifyError"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="classifyError"
                  />
                  <UAlert
                    v-else
                    color="info"
                    variant="subtle"
                    icon="i-lucide-cpu"
                    :title="t('image.firstLoadHint')"
                  />
                  <UButton
                    size="sm"
                    icon="i-lucide-play"
                    :loading="classifying"
                    @click="runClassify"
                  >
                    {{ pick({ zh: '运行分类', en: 'Run classification' }) }}
                  </UButton>
                </template>
              </div>
            </div>

            <p class="text-sm text-muted">
              {{ pick({
                zh: '最后一步把特征变成答案：分类器（一个在 ImageNet 1000 类上训练过的小卷积网络）看的是第 3 步那摞特征图，输出每个类别的置信度。所以「认得准不准」的关键其实在第 2、3 步 —— 特征没被挑出来，后面的判断就无从谈起。',
                en: 'The last step turns features into an answer: the classifier (a small convolutional network trained on ImageNet’s 1000 classes) reads the stack of feature maps from step 3 and outputs a confidence per class. That is why accuracy is really decided in steps 2 and 3 — if the features were never picked out, nothing downstream can decide well.'
              }) }}
            </p>
          </div>
        </UCard>
      </ToolSidebar>

      <!-- 页脚：想想看 + 这些能力在站内的其他页面 -->
      <UCard>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-lightbulb"
              class="size-5 text-warning"
            />
            <p class="text-sm font-medium text-highlighted">
              {{ pick({ zh: '想想看', en: 'Think about it' }) }}
            </p>
          </div>
          <p class="text-sm text-muted">
            {{ pick({
              zh: '除了认狗，你还能想出哪些事是靠「特征」而不是靠「整张图」完成的？想完可以到下面这些页面里动手验证一下。',
              en: 'Besides recognising a dog, what else is done by “features” rather than by “the whole image”? Try the pages below to check your ideas by hand.'
            }) }}
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              to="/vision/edge"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-scan-line"
            >
              {{ pick({ zh: '边缘与形状检测', en: 'Edge & shape detection' }) }}
            </UButton>
            <UButton
              to="/vision/features"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-crosshair"
            >
              {{ pick({ zh: '特征检测（ORB）', en: 'Feature detection (ORB)' }) }}
            </UButton>
            <UButton
              to="/vision/classification"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-tags"
            >
              {{ pick({ zh: '图像分类（多引擎对比）', en: 'Image classification (by engine)' }) }}
            </UButton>
            <UButton
              to="/vision/detection"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-bounding-box"
            >
              {{ pick({ zh: '目标检测', en: 'Object detection' }) }}
            </UButton>
            <UButton
              to="/vision/face"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-scan-face"
            >
              {{ pick({ zh: '人脸工作室', en: 'Face studio' }) }}
            </UButton>
          </div>
          <p class="text-xs text-muted">
            {{ pick({
              zh: '一句话总结：好的 AI 不是看得更多，而是看得更准 —— 特征提取就是学会「该看什么」。',
              en: 'One line to take away: good AI does not see more, it sees the right things — feature extraction is learning what to look at.'
            }) }}
          </p>
        </div>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
