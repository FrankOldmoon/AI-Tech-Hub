<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 边缘检测入门（教学页，与「像素原理」「图像处理入门」「特征提取入门」同组）。
 *
 * 教学图讲四步：输入图像 → 检测变化 → 边缘图 → AI 看得更清楚。
 * 这页把四步做成一条能动手的链，同一张图逐步被「描出轮廓」：
 *
 *   1 输入图像      真实照片（这一步只提供素材）
 *   2 检测变化      把彩图变灰度，量出每一点的横向变化 Gx、纵向变化 Gy，
 *                   合成强度 |∇| —— 直接点图上的任意像素，看它和邻居差多少
 *   3 边缘图        用阈值决定「多陡才算一条边」，白线压在黑底上
 *   4 看得更清楚    把边缘叠回原图 —— AI 从此看到的是形状，不是像素
 *
 * 为什么整页围着「变化」转：学生对「边缘」的直觉是「物体的边线」，
 * 而算法眼里只有一件事 —— 相邻像素的亮度差得够不够大。所以第 2 步必须
 * 把数字摆到桌面上（5×5 亮度表 + 手算差），否则后面的阈值、合成都是空谈。
 *
 * 执行层在 ~/utils/edge-detection（纯函数，Node 里可测）；这页只管摆画面与交互。
 * 计算全部在浏览器本地完成，不上传任何图片。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { ScalarField } from '~/utils/feature-extraction'
import { humanError } from '~/utils/errors'
import { loadImageData } from '~/utils/image'
import { fieldToImageData, statsOf, toGrayFloat } from '~/utils/feature-extraction'
import {
  EDGE_OPERATORS,
  gradientAt,
  gradientFields,
  magnitudeField,
  maskToImageData,
  neighborhood,
  overlayImageData,
  smoothField,
  strongestPixel,
  thresholdMask
} from '~/utils/edge-detection'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'edge-detection')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

/** 处理尺寸上限：差分是逐像素邻域运算，原图直接跑会明显卡顿（课堂要即时反馈） */
const MAX_EDGE = 720
/** 第 2 步那张亮度数字表的边长（奇数，中间那格 = 被选中的像素） */
const GRID = 5
const GRID_CENTER = Math.floor(GRID / 2)

/** 四个步骤：顺序即讲解顺序，与教学图一一对应 */
const lesson: Array<{ id: string, icon: string, title: L, kind: string }> = [
  { id: 'input', icon: 'i-lucide-image', title: { zh: '1 输入图像', en: '1 Input Image' }, kind: 'ORIGINAL' },
  { id: 'changes', icon: 'i-lucide-activity', title: { zh: '2 检测变化', en: '2 Detect Changes' }, kind: 'GRADIENT · GX/GY' },
  { id: 'edges', icon: 'i-lucide-pen-tool', title: { zh: '3 边缘图', en: '3 Edge Image' }, kind: 'THRESHOLD' },
  { id: 'understand', icon: 'i-lucide-box', title: { zh: '4 看得更清楚', en: '4 AI Sees Better' }, kind: 'SHAPES · OVERLAY' }
]

/** 为什么重要（教学图右侧那一栏） */
const whyItems = [
  {
    icon: 'i-lucide-box',
    title: { zh: '找到重要的形状', en: 'Finds important shapes' },
    text: { zh: '帮 AI 认出物体的边界，而不是被颜色和纹理带偏。', en: 'Helps AI identify the boundaries of objects instead of being distracted by colour and texture.' }
  },
  {
    icon: 'i-lucide-target',
    title: { zh: '让识别更准', en: 'Improves accuracy' },
    text: { zh: '边界清楚了，检测与识别就不再忽好忽坏。', en: 'Clear boundaries make detection and recognition far more reliable.' }
  },
  {
    icon: 'i-lucide-image-minus',
    title: { zh: '丢掉多余信息', en: 'Reduces extra information' },
    text: { zh: '只看轮廓，忽略掉大量无关细节，计算量也跟着降下来。', en: 'Focuses on edges and ignores unnecessary detail — which also cuts the computation.' }
  },
  {
    icon: 'i-lucide-rocket',
    title: { zh: '到处都是它', en: 'Used in many applications' },
    text: { zh: '从自动驾驶到医学影像，几乎所有视觉系统的第一步都是它。', en: 'From self-driving cars to medical scans, it is the first step of almost every vision system.' }
  }
]

/** 用在哪里（教学图底部那一排） */
const useItems = [
  { icon: 'i-lucide-car', label: { zh: '自动驾驶', en: 'Self-driving cars' } },
  { icon: 'i-lucide-scan-face', label: { zh: '人脸与物体识别', en: 'Face & object recognition' } },
  { icon: 'i-lucide-sliders-horizontal', label: { zh: '照片编辑', en: 'Photo editing' } },
  { icon: 'i-lucide-activity', label: { zh: '医学影像', en: 'Medical imaging' } },
  { icon: 'i-lucide-bot', label: { zh: '机器人', en: 'Robotics' } },
  { icon: 'i-lucide-shield-check', label: { zh: '安防系统', en: 'Security systems' } }
]

// ===== 状态 =====
const selected = ref(lesson[0]!.id)
const source = ref<ImageData | null>(null)
const sourceLabel = ref('')
/** 灰度（差分运算的输入）：边缘只看亮度，不看颜色 */
const gray = ref<ScalarField | null>(null)
/** 工作图 = 灰度（或先降噪的灰度）—— 差分真正吃进去的那张图 */
const work = ref<ScalarField | null>(null)
/** 横向 / 纵向变化，以及合成强度 */
const gx = ref<ScalarField | null>(null)
const gy = ref<ScalarField | null>(null)
const magnitude = ref<ScalarField | null>(null)
const computing = ref(false)
const errorMsg = ref('')

/** 第 2 步：算子与「先降噪」开关 */
const opId = ref(EDGE_OPERATORS[0]!.id)
const smoothed = ref(false)
/** 被「指着」的那个像素（默认落在最强的边上） */
const pickPoint = ref<{ x: number, y: number } | null>(null)

/** 第 3 / 4 步：阈值与显示模式 */
const threshold = ref(0.25)
const edgeMode = ref<'overlay' | 'shape'>('overlay')

/** 已算好的底图（与阈值无关，避免拖动滑杆时反复重算） */
const base = ref<{ work: ImageData | null, mag: ImageData | null, gx: ImageData | null, gy: ImageData | null }>({
  work: null,
  mag: null,
  gx: null,
  gy: null
})

const activeRow = computed(() => lesson.find(s => s.id === selected.value) ?? lesson[0]!)
const operator = computed(() => EDGE_OPERATORS.find(o => o.id === opId.value) ?? EDGE_OPERATORS[0]!)
const operatorOptions = computed(() => EDGE_OPERATORS.map(o => ({ label: pick(o.name), value: o.id })))
const sidebarItems = computed<ToolSidebarItem[]>(() => lesson.map(step => ({
  id: step.id,
  label: pick(step.title),
  kind: step.kind,
  icon: step.icon,
  badge: step.id === 'changes' && computing.value ? t('image.processing') : undefined
})))

const thresholdPresets = [
  { value: 0.08, name: { zh: '低：细节多', en: 'Low: more detail' } },
  { value: 0.25, name: { zh: '中', en: 'Medium' } },
  { value: 0.5, name: { zh: '高：只要强边', en: 'High: strong only' } }
]

// ===== 计算 =====
/** 递增轮次：换图后旧的那一轮在每个 await 后自行退出 */
let computeToken = 0

/** 灰度 → （可选降噪）→ Gx / Gy → 合成强度，再缓存好与阈值无关的四张底图 */
async function compute() {
  const g = gray.value
  if (!g) return
  const token = ++computeToken
  computing.value = true
  // 让出一帧：状态先刷新（「计算中」提示），也避免长任务把界面卡住
  await new Promise(resolve => setTimeout(resolve, 0))
  if (token !== computeToken) return
  try {
    const wk = smoothed.value ? smoothField(g) : g
    const fields = gradientFields(wk, opId.value)
    if (token !== computeToken) return
    const mag = magnitudeField(fields.gx, fields.gy)
    work.value = wk
    gx.value = fields.gx
    gy.value = fields.gy
    magnitude.value = mag
    base.value = {
      work: fieldToImageData(wk),
      mag: fieldToImageData(mag),
      gx: fieldToImageData(fields.gx),
      gy: fieldToImageData(fields.gy)
    }
    // 新图：把「指针」放到最陡的那一点上，一进第 2 步就有示例可看
    if (!pickPoint.value) {
      const s = strongestPixel(mag)
      pickPoint.value = { x: s.x, y: s.y }
    }
  } finally {
    if (token === computeToken) computing.value = false
  }
}

watch([opId, smoothed], () => {
  void compute()
})

// ===== 指针与读数 =====
const markerStyle = computed(() => {
  const g = gray.value
  const p = pickPoint.value
  if (!g || !p) return null
  return {
    left: `${(p.x / g.width) * 100}%`,
    top: `${(p.y / g.height) * 100}%`
  }
})

const localNumbers = computed(() => {
  const g = gray.value
  const p = pickPoint.value
  return g && p ? neighborhood(g, p.x, p.y, GRID) : null
})

/** 手算示例：中心那格出发，左右差、上下差、合成 —— 就是教学图里那张数字表想说的话 */
const worked = computed(() => {
  const n = localNumbers.value
  if (!n || n.length <= GRID_CENTER) return null
  const row = n[GRID_CENTER] ?? []
  const left = row[0] ?? 0
  const right = row[row.length - 1] ?? 0
  const top = n[0]?.[GRID_CENTER] ?? 0
  const bottom = n[n.length - 1]?.[GRID_CENTER] ?? 0
  const dx = right - left
  const dy = bottom - top
  return { left, right, top, bottom, dx, dy, mag: Math.hypot(dx, dy) }
})

/** 算子在实际像素上的响应（Gx / Gy / 强度 / 方向角） */
const localRead = computed(() => {
  const px = gx.value
  const py = gy.value
  const p = pickPoint.value
  if (!px || !py || !p) return null
  return gradientAt(px, py, p.x, p.y)
})

/** 当前阈值下的边缘统计（阈值滑杆直接读它） */
const edgeStat = computed(() => (magnitude.value ? thresholdMask(magnitude.value, threshold.value) : null))
/** 这一点是不是落在「边缘」上（用同一套阈值判断，前后一致） */
const isEdgeHere = computed(() => {
  const r = localRead.value
  const mag = magnitude.value
  if (!r || !mag) return false
  return r.magnitude >= threshold.value * (statsOf(mag).maxAbs || 1)
})

// ===== 画布 =====
const canvases = new Map<string, HTMLCanvasElement>()

function setCanvas(key: string, el: unknown) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el)
  else canvases.delete(key)
}

/** 画布键 → 该显示的像素数据 */
function imageFor(key: string): ImageData | null {
  if (key === 'solo' || key === 'solo2') return source.value
  if (key === 'work' || key === 'work2') return base.value.work
  if (key === 'mag') return base.value.mag
  if (key === 'gx') return base.value.gx
  if (key === 'gy') return base.value.gy
  if (key === 'edges') return magnitude.value ? maskToImageData(magnitude.value, threshold.value) : null
  if (key === 'overlay') {
    return source.value && magnitude.value
      ? overlayImageData(source.value, magnitude.value, threshold.value, { mode: edgeMode.value })
      : null
  }
  return null
}

function drawCanvas(el: HTMLCanvasElement, image: ImageData | null) {
  if (!image) return
  if (el.width !== image.width) el.width = image.width
  if (el.height !== image.height) el.height = image.height
  const ctx = el.getContext('2d')
  if (ctx) ctx.putImageData(image, 0, 0)
}

async function drawAll() {
  await nextTick()
  for (const [key, el] of canvases) drawCanvas(el, imageFor(key))
}

watch(
  [source, base, magnitude, threshold, edgeMode, pickPoint, selected],
  () => { void drawAll() },
  { flush: 'post' }
)

/** 点一下图上的像素：换算回图像坐标（画布是等比缩放的，用矩形比例反推） */
function pickAt(e: MouseEvent) {
  const g = gray.value
  if (!g) return
  const el = e.currentTarget as HTMLCanvasElement
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = Math.round(((e.clientX - rect.left) / rect.width) * g.width)
  const y = Math.round(((e.clientY - rect.top) / rect.height) * g.height)
  pickPoint.value = {
    x: Math.min(g.width - 1, Math.max(0, x)),
    y: Math.min(g.height - 1, Math.max(0, y))
  }
}

/** 一键跳到最强的边上（默认示例点已经在那里，换完算子/开关后可以再跳一次） */
function jumpStrongest() {
  const mag = magnitude.value
  if (!mag) return
  const s = strongestPixel(mag)
  pickPoint.value = { x: s.x, y: s.y }
}

// ===== 输入 =====
const samples = computed(() => [
  { label: t('samples.dog'), url: '/samples/images/dog.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' },
  { label: t('samples.shapes'), url: '/samples/images/shapes.jpg' },
  { label: t('samples.checkerboard'), url: '/samples/images/checkerboard.jpg' },
  { label: t('samples.texture'), url: '/samples/images/texture.jpg' }
])

function setSource(image: ImageData, label: string) {
  source.value = image
  sourceLabel.value = label
  gray.value = toGrayFloat(image)
  // 换图：指针作废，算完自动落到新图最陡的点上
  pickPoint.value = null
  void compute()
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

function selectStep(id: string | number) {
  selected.value = String(id)
}

onMounted(() => {
  void useSample(samples.value[0]?.url ?? '', samples.value[0]?.label ?? '')
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
                v-if="activeRow.id === 'changes' && computing"
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
                zh: '这是真实世界的原图。边缘检测要做的事只有一件：找出图里「亮度突然变化」的地方，把它们连起来就是物体的轮廓。数值上就是相邻像素差得够不够大 —— 后面三步都在围着这个「差」做文章。',
                en: 'This is the raw image. Edge detection does one thing only: find where the brightness suddenly changes — joined up, those places are the outlines of objects. Numerically that just means how big the difference between neighbouring pixels is, which is what the next three steps are about.'
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

          <!-- ===== 2 检测变化 ===== -->
          <div
            v-else-if="activeRow.id === 'changes'"
            class="space-y-4"
          >
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">{{ pick({ zh: '算子', en: 'Operator' }) }}</span>
                <USelect
                  v-model="opId"
                  :items="operatorOptions"
                  size="xs"
                  class="w-32"
                />
              </div>
              <UButton
                size="xs"
                :variant="smoothed ? 'solid' : 'soft'"
                color="neutral"
                @click="smoothed = !smoothed"
              >
                {{ pick({ zh: '先降噪', en: 'Denoise first' }) }}：{{ smoothed ? pick({ zh: '开', en: 'on' }) : pick({ zh: '关', en: 'off' }) }}
              </UButton>
              <UButton
                size="xs"
                variant="soft"
                color="neutral"
                icon="i-lucide-crosshair"
                @click="jumpStrongest"
              >
                {{ pick({ zh: '跳到最强的边', en: 'Jump to strongest edge' }) }}
              </UButton>
              <span class="text-xs text-muted">{{ pick(operator.note) }}</span>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '工作图（在图上点一下，选一个像素）', en: 'Working image (click to pick a pixel)' }) }}
                </p>
                <div class="relative w-full cursor-crosshair">
                  <canvas
                    v-if="base.work"
                    :ref="el => setCanvas('work', el)"
                    class="w-full rounded border border-default"
                    @click="pickAt"
                  />
                  <span
                    v-if="markerStyle"
                    class="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-error"
                    :style="markerStyle"
                  />
                </div>
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '变化强度 |∇|（越亮 = 变化越剧烈）', en: 'Change magnitude |∇| (brighter = changes more)' }) }}
                </p>
                <canvas
                  v-if="base.mag"
                  :ref="el => setCanvas('mag', el)"
                  class="w-full rounded border border-default"
                />
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '横向变化 Gx（左 ↔ 右）', en: 'Horizontal change Gx (left ↔ right)' }) }}
                </p>
                <canvas
                  v-if="base.gx"
                  :ref="el => setCanvas('gx', el)"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '纵向变化 Gy（上 ↕ 下）', en: 'Vertical change Gy (up ↕ down)' }) }}
                </p>
                <canvas
                  v-if="base.gy"
                  :ref="el => setCanvas('gy', el)"
                  class="w-full rounded border border-default"
                />
              </div>
            </div>

            <!-- 数字表 + 读数：把「变化」这件事摆到桌面上 -->
            <div class="grid gap-4 rounded border border-default p-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '这一点的邻居亮度（5×5）', en: 'Neighbour brightness here (5×5)' }) }}
                </p>
                <div
                  v-if="localNumbers"
                  class="inline-grid grid-cols-5 gap-px rounded border border-default p-px"
                >
                  <template
                    v-for="(row, ri) in localNumbers"
                    :key="ri"
                  >
                    <span
                      v-for="(v, ci) in row"
                      :key="`${ri}-${ci}`"
                      class="flex size-8 items-center justify-center text-[10px] tabular-nums"
                      :class="ri === GRID_CENTER && ci === GRID_CENTER ? 'font-semibold ring-2 ring-error ring-inset' : ''"
                      :style="{ background: `rgb(${v},${v},${v})`, color: v > 128 ? '#000' : '#fff' }"
                    >
                      {{ v }}
                    </span>
                  </template>
                </div>
                <p
                  v-if="pickPoint"
                  class="mt-1 text-xs text-muted tabular-nums"
                >
                  {{ pick({ zh: `第 ${pickPoint.x} 列，第 ${pickPoint.y} 行`, en: `column ${pickPoint.x}, row ${pickPoint.y}` }) }}
                </p>
              </div>
              <div class="space-y-2">
                <div
                  v-if="worked"
                  class="space-y-1 text-sm text-muted"
                >
                  <p>{{ pick({ zh: '像 AI 那样算一遍（只挑最直接的邻居）：', en: 'Work it out the way the AI does (just the closest neighbours):' }) }}</p>
                  <p class="tabular-nums">
                    {{ pick({ zh: '左右差 Gx', en: 'Left–right Gx' }) }} = {{ worked.right }} − {{ worked.left }} =
                    <span class="font-medium text-highlighted">{{ worked.dx }}</span>
                  </p>
                  <p class="tabular-nums">
                    {{ pick({ zh: '上下差 Gy', en: 'Up–down Gy' }) }} = {{ worked.bottom }} − {{ worked.top }} =
                    <span class="font-medium text-highlighted">{{ worked.dy }}</span>
                  </p>
                  <p class="tabular-nums">
                    {{ pick({ zh: '合成强度 |∇|', en: 'Combined magnitude |∇|' }) }} ≈
                    <span class="font-medium text-highlighted">{{ Math.round(worked.mag) }}</span>
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    v-if="localRead"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ pick({ zh: `${GRID}×${GRID} 算子的真实响应`, en: `Real ${GRID}×${GRID} operator response` }) }}
                  </UBadge>
                  <UBadge
                    v-if="localRead"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    Gx {{ Math.round(localRead.gx) }}
                  </UBadge>
                  <UBadge
                    v-if="localRead"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    Gy {{ Math.round(localRead.gy) }}
                  </UBadge>
                  <UBadge
                    v-if="localRead"
                    :color="isEdgeHere ? 'success' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  >
                    |∇| {{ Math.round(localRead.magnitude) }}
                  </UBadge>
                  <UBadge
                    v-if="localRead"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ pick({ zh: '方向', en: 'Direction' }) }} {{ Math.round(localRead.angle) }}°
                  </UBadge>
                </div>
                <p class="text-xs text-muted">
                  {{ pick({
                    zh: '差值接近 0 = 这一片亮度差不多（平地、天空）→ 不是边；差值很大 = 亮度突然变了（物体轮廓）→ 是边。这张表就是「AI 眼里的边缘」最原始的样子。',
                    en: 'A difference near 0 means this area has almost the same brightness (flat ground, sky) → not an edge; a large difference means brightness changed abruptly (an object outline) → an edge. This table is the most primitive form of what the AI calls an edge.'
                  }) }}
                </p>
              </div>
            </div>

            <p class="text-xs text-muted">
              {{ pick({
                zh: '为什么算 Gx 和 Gy 两张：Gx 只管左右变化（所以竖着的轮廓在它上面最亮），Gy 只管上下变化（横着的轮廓最亮）。合成之后，不管哪个方向的边都亮起来 —— 这就是下面第 3 步那张边缘图。',
                en: 'Why two maps, Gx and Gy: Gx only looks at left–right change (so vertical outlines are brightest on it) and Gy only looks at up–down change (horizontal outlines brightest). Combined, edges in every direction light up — which becomes the edge image in step 3.'
              }) }}
            </p>
          </div>

          <!-- ===== 3 边缘图 ===== -->
          <div
            v-else-if="activeRow.id === 'edges'"
            class="space-y-4"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-xs text-muted">{{ pick({ zh: '阈值（多陡才算一条边）', en: 'Threshold (how steep counts as an edge)' }) }}</span>
              <USlider
                v-model="threshold"
                :min="0"
                :max="0.9"
                :step="0.01"
                class="max-w-xs flex-1"
              />
              <span class="w-10 text-xs tabular-nums text-muted">{{ Math.round(threshold * 100) }}%</span>
              <div class="flex gap-1">
                <UButton
                  v-for="p in thresholdPresets"
                  :key="p.value"
                  size="xs"
                  :variant="Math.abs(threshold - p.value) < 0.005 ? 'solid' : 'soft'"
                  color="neutral"
                  @click="threshold = p.value"
                >
                  {{ pick(p.name) }}
                </UButton>
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '灰度原图', en: 'Grayscale input' }) }}
                </p>
                <canvas
                  v-if="base.work"
                  :ref="el => setCanvas('work2', el)"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '边缘图（白线 = 边缘）', en: 'Edge image (white = edge)' }) }}
                </p>
                <canvas
                  v-if="magnitude"
                  :ref="el => setCanvas('edges', el)"
                  class="w-full rounded border border-default"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ pick({ zh: '阈值', en: 'Threshold' }) }} {{ Math.round(threshold * 100) }}%
              </UBadge>
              <UBadge
                v-if="edgeStat && magnitude"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ pick({ zh: '边缘像素占比', en: 'Edge pixels' }) }} {{ ((edgeStat.count / (magnitude.data.length || 1)) * 100).toFixed(1) }}%
              </UBadge>
              <UBadge
                v-if="edgeStat"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ edgeStat.count }} px
              </UBadge>
            </div>

            <p class="text-sm text-muted">
              {{ pick({
                zh: '阈值就是「多陡才算边」的门槛：调低，细小的变化也留成边（轮廓更完整，但噪点和纹理也混进来）；调高，只有最强烈的边界留得下来（更干净，但可能断线）。真实系统里这个数字往往要靠试用和统计数据来定 —— 试着把滑杆来回拉几次，看白线怎么变少。',
                en: 'The threshold is the bar for “how steep counts as an edge”: lower keeps faint changes too (more complete outlines, but noise and texture creep in); higher keeps only the strongest boundaries (cleaner, but lines may break). Real systems often tune this number by trial and statistics — drag the slider back and forth and watch the white lines thin out.'
              }) }}
            </p>
          </div>

          <!-- ===== 4 看得更清楚 ===== -->
          <div
            v-else
            class="space-y-4"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-xs text-muted">{{ pick({ zh: '显示', en: 'View' }) }}</span>
              <UButton
                size="xs"
                :variant="edgeMode === 'overlay' ? 'solid' : 'soft'"
                color="neutral"
                @click="edgeMode = 'overlay'"
              >
                {{ pick({ zh: '轮廓高亮', en: 'Highlight edges' }) }}
              </UButton>
              <UButton
                size="xs"
                :variant="edgeMode === 'shape' ? 'solid' : 'soft'"
                color="neutral"
                @click="edgeMode = 'shape'"
              >
                {{ pick({ zh: '只看形状', en: 'Shape only' }) }}
              </UButton>
              <span class="text-xs text-muted">{{ pick({ zh: '阈值', en: 'Threshold' }) }}</span>
              <USlider
                v-model="threshold"
                :min="0"
                :max="0.9"
                :step="0.01"
                class="max-w-[10rem]"
              />
              <span class="text-xs tabular-nums text-muted">{{ Math.round(threshold * 100) }}%</span>
            </div>

            <div class="grid gap-4 lg:grid-cols-2">
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: '原图（几万个像素各看各的）', en: 'Original (thousands of pixels, all alike)' }) }}
                </p>
                <canvas
                  v-if="source"
                  :ref="el => setCanvas('solo2', el)"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="mb-1 text-xs text-muted">
                  {{ pick({ zh: 'AI 看到的：形状与轮廓', en: 'What AI sees: shapes and outlines' }) }}
                </p>
                <canvas
                  v-if="magnitude"
                  :ref="el => setCanvas('overlay', el)"
                  class="w-full rounded border border-default"
                />
              </div>
            </div>

            <p class="text-sm text-muted">
              {{ pick({
                zh: '把边缘叠回原图之后，物体的形状就「跳」出来了：左边是一堆亮度数字，右边是结构。AI 接下来要做的事（认出这是狗、判断它面向哪边、能不能被分割）都从这一张轮廓图开始 —— 所以边缘检测常被叫作「视觉的第一步」。切到「只看形状」，你会发现丢掉颜色和纹理之后，形状反而更清楚。',
                en: 'Once the edges are laid back over the image, the shape pops out: the left is a pile of brightness numbers, the right is structure. Everything the AI does next (recognising the dog, telling which way it faces, segmenting it) starts from this outline — which is why edge detection is often called the first step of vision. Switch to “shape only”: dropping colour and texture actually makes the shape clearer.'
              }) }}
            </p>

            <div>
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '用在哪里？', en: 'Where is it used?' }) }}
              </p>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div
                  v-for="u in useItems"
                  :key="u.icon"
                  class="flex items-center gap-2 rounded border border-default p-3"
                >
                  <UIcon
                    :name="u.icon"
                    class="size-5 shrink-0 text-primary"
                  />
                  <span class="text-sm">{{ pick(u.label) }}</span>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </ToolSidebar>

      <!-- 页脚：想想看 + 站内相关页面 -->
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
              zh: '在身边找一找：哪些东西的「边」最清楚，哪些几乎没有边（比如一片天空、一面白墙）？再想想 —— 如果一个物体没有边，AI 还认得出它吗？到下面这些页面里动手验证一下。',
              en: 'Look around you: which things have the clearest edges, and which have almost none (a patch of sky, a plain white wall)? And then: if an object has no edges, can AI still recognise it? Try the pages below to find out by hand.'
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
              {{ pick({ zh: '边缘与形状检测（工坊）', en: 'Edge & shape studio' }) }}
            </UButton>
            <UButton
              to="/vision/feature-extraction"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-layers"
            >
              {{ pick({ zh: '特征提取入门（教学）', en: 'Feature extraction (lesson)' }) }}
            </UButton>
            <UButton
              to="/vision/pipeline"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-git-branch"
            >
              {{ pick({ zh: '图像处理入门（教学）', en: 'Image processing (lesson)' }) }}
            </UButton>
            <UButton
              to="/vision/object"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-target"
            >
              {{ pick({ zh: '颜色与轮廓检测', en: 'Colour & contours' }) }}
            </UButton>
          </div>
          <p class="text-xs text-muted">
            {{ pick({
              zh: '一句话总结：AI 不是「看见」了物体，而是先找到了亮度突变的地方，再把这些线拼成形状。',
              en: 'One line to take away: AI does not simply “see” an object — it first finds where brightness jumps, then joins those lines into a shape.'
            }) }}
          </p>
        </div>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
