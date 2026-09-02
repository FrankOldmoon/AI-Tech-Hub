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
  /** 本页专属示例图（未配置时用通用示例列表） */
  samples?: Array<{ label: string, url: string, secondUrl?: string }> | null
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
/** 结果图显示：水平把手固定「显示高度」（宽度按内在比例）、垂直把手固定「显示宽度」——
 * 否则 canvas 内在比例变化 + max-w-full h-auto 会让显示高度跳变（如水平拖小宽后 350→600 拉长） */
const resizeDisplayMode = ref<'h' | 'v' | null>(null)
const resizeDisplayBase = ref({ w: 0, h: 0 })
const resizeResultStyle = computed(() => {
  if (activeTool.value?.id !== 'resize') return undefined
  if (resizeDisplayMode.value === 'h' && resizeDisplayBase.value.h) {
    return { height: `${resizeDisplayBase.value.h}px`, width: 'auto' }
  }
  if (resizeDisplayMode.value === 'v' && resizeDisplayBase.value.w) {
    return { width: `${resizeDisplayBase.value.w}px`, height: 'auto' }
  }
  return undefined
})
/**
 * 参数面板 specs：
 * - resize 工具的 width/height 为 slider，范围随原图尺寸动态（1 ~ 原图 2 倍，含当前值，上限 4096）
 * - keep（保持宽高比）开启时 height 由 run 自动按宽度等比计算，面板禁用该滑块
 */
const specs = computed(() => {
  const base = buildParamSpecs(activeTool.value?.params, lang.value)
  if (activeTool.value?.id === 'resize' && original.value) {
    return base.map((s) => {
      if (s.key === 'width' || s.key === 'height') {
        const src = s.key === 'width' ? original.value!.width : original.value!.height
        const cur = Number(paramValues.value[s.key]) || 0
        const max = Math.min(4096, Math.max(src * 2, 512, cur))
        const help = s.key === 'height' && paramValues.value.keep
          ? (lang.value === 'zh' ? '保持宽高比开启时，高度按宽度自动等比计算。' : 'With aspect ratio kept, height follows width automatically.')
          : s.help
        return { ...s, type: 'slider' as const, min: 1, max, step: 1, help }
      }
      return s
    })
  }
  return base
})
/** keep 开启时禁用 height 滑块（由 run 自动计算） */
const disabledParamKeys = computed<string[]>(() =>
  activeTool.value?.id === 'resize' && paramValues.value.keep ? ['height'] : []
)
const paramValues = ref<Record<string, number | string | boolean>>({})

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
  if (prefersReducedMotion()) return
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
  tesseract: 'Tesseract'
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
  resizeDisplayMode.value = null
  paramValues.value = paramDefaults(specs.value)
  // resize 工具：默认宽高跟随原图实际尺寸（不硬编码 800×600）
  if (activeTool.value?.id === 'resize' && original.value) {
    paramValues.value = {
      ...paramValues.value,
      width: original.value.width,
      height: original.value.height
    }
  }
  runLater()
}, { immediate: true })

watch(paramValues, scheduleRun, { deep: true })

// 图片变化时：resize 工具默认宽高跟随原图尺寸（用户可直接拖拽调整，而非固定 800×600）
watch(original, () => {
  if (activeTool.value?.id !== 'resize' || !original.value) return
  paramValues.value = {
    ...paramValues.value,
    width: original.value.width,
    height: original.value.height
  }
})

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
    if (activeTool.value?.id === 'resize') {
      // resize：拖动中 GPU 直绘预览（60fps 零回读），停止 150ms 后跑完整管线
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0
          previewResize()
        })
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => run(), 150)
    } else {
      // 其他 canvas 工具：每帧即时重跑（<16ms）
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0
          run()
        })
      }
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
    // 把手拖动期间忽略 keep 等比（水平/垂直把手独立控制单边，等比把手自行等比）
    if (activeTool.value?.id === 'resize' && resizeDragKeep.value) {
      mergedParams.keep = false
    }
    // canvas 工具不改源图，直接传原图省一次 4MB 深拷贝（AI 工具保留防御性克隆）
    const src = isImmediateTool() ? original.value : alg.cloneImageData(original.value)
    const res = await tool.run({
      imageData: src,
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
  resizeDisplayMode.value = null
  paramValues.value = paramDefaults(specs.value)
  // resize 工具：恢复为原图尺寸（与默认跟随原图一致，而非 specs 硬编码 800×600）
  if (activeTool.value?.id === 'resize' && original.value) {
    paramValues.value = {
      ...paramValues.value,
      width: original.value.width,
      height: original.value.height
    }
  }
  run()
}

// ===== resize 拖拽手柄（与参数面板双向联动） =====
/** resize 把手模式：h = 水平（只改宽度）、v = 垂直（只改高度）、s = 等比（按当前宽高比同变） */
type ResizeMode = 'h' | 'v' | 's'
const resizing = ref(false)
/** 把手拖动期间忽略 keep 等比：水平把手只改宽、垂直只改高（keep 仅作用于滑块操作与等比把手） */
const resizeDragKeep = ref(false)
/** scale slider 拖动开始时的基准宽高（连续 input 需基于基准而非累积） */
let scaleDragBase: { w: number, h: number } | null = null
let scaleDragTimer: ReturnType<typeof setTimeout> | null = null
const resizeStart = ref({ mode: 'h' as ResizeMode, x: 0, y: 0, w: 0, h: 0, rectW: 1, rectH: 1 })

function onResizeStart(e: PointerEvent, mode: ResizeMode) {
  const canvas = origCanvas.value
  if (!canvas || !original.value) return
  e.preventDefault()
  const handle = e.currentTarget as HTMLElement
  // Pointer Capture：拖动过程中指针移出按钮仍持续收到事件（触屏/鼠标统一）
  handle.setPointerCapture(e.pointerId)
  resizing.value = true
  resizeDragKeep.value = true
  // 记录拖动前结果图显示尺寸，并锁定固定边（水平固定高、垂直固定宽、等比不锁）
  const rc = resultCanvas.value
  if (rc) {
    const r = rc.getBoundingClientRect()
    resizeDisplayBase.value = { w: r.width || 0, h: r.height || 0 }
  }
  resizeDisplayMode.value = mode === 's' ? null : mode
  const rect = canvas.getBoundingClientRect()
  // 基准宽高 = 当前实际输出尺寸（keep 开启时高度是等比输出而非 paramValues.height，
  // 否则水平把手会把高度"跳变"回默认值）
  const curW = Number(paramValues.value.width) || original.value.width
  const curH = paramValues.value.keep
    ? Math.round(original.value.height * (curW / original.value.width))
    : Number(paramValues.value.height) || original.value.height
  resizeStart.value = {
    mode,
    x: e.clientX,
    y: e.clientY,
    w: curW,
    h: curH,
    // 固定换算基准：拖动中原图显示会随参数变化，比例用起始 rect，避免非线性漂移
    rectW: rect.width || 1,
    rectH: rect.height || 1
  }
  handle.addEventListener('pointermove', onResizeMove)
  handle.addEventListener('pointerup', onResizeEnd)
  handle.addEventListener('pointercancel', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  if (!resizing.value || !original.value) return
  const st = resizeStart.value
  // 显示尺寸 → 像素尺寸换算（原图为被操作对象）
  const scaleX = original.value.width / st.rectW
  const scaleY = original.value.height / st.rectH
  const clampPx = (v: number) => Math.min(4096, Math.max(1, Math.round(v)))
  const dxPx = (e.clientX - st.x) * scaleX
  const dyPx = (e.clientY - st.y) * scaleY
  let newW = st.w
  let newH = st.h
  if (st.mode === 'h') {
    newW = clampPx(st.w + dxPx)
  } else if (st.mode === 'v') {
    newH = clampPx(st.h + dyPx)
  } else { // 's' 等比：按当前宽高比同变（高度 = 起始高 × 宽变化率）
    newW = clampPx(st.w + dxPx)
    // 学习垂直逻辑：基于当前值缩放，保持当前图片的宽高比（与 keep 无关）
    newH = clampPx(st.h * (newW / st.w))
  }
  // 联动：始终显式写入最终 width/height（水平=st.h 保持高、垂直=新高、等比=等比高；
  // 拖动期间 run 忽略 keep，避免 keep 把高度按宽度等比覆盖）
  paramValues.value = {
    ...paramValues.value,
    width: newW,
    height: newH
  }
}

function onResizeEnd(e: PointerEvent) {
  resizing.value = false
  // 清掉拖动中的防抖/rAF，立即以「忽略 keep」的参数补跑最终结果；
  // 否则 150ms 防抖 run 在松手后执行时 keep 已恢复，会把高度按宽度等比覆盖
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  run()
  resizeDragKeep.value = false
  const handle = e.currentTarget as HTMLElement
  handle.removeEventListener('pointermove', onResizeMove)
  handle.removeEventListener('pointerup', onResizeEnd)
  handle.removeEventListener('pointercancel', onResizeEnd)
  // 手柄松手：轻微「settle」确认
  pulseResult(0.99)
}

// ===== resize 三控制（width/height/scale）相互独立 =====
// 水平（width）只改宽、垂直（height）只改高、等比（scale）只在自己被拖动时按原图比例
// 等比设置 width/height；三者在数值上互不跟随（用户要求：拖水平时等比缩放不应变化）
let syncingResize = false
let syncReleaseTimer: ReturnType<typeof setTimeout> | null = null

/** 联动期间锁住另一 watch：Vue watch 回调在微任务队列，必须用宏任务（setTimeout 0）释放，
 * 否则 watch width → 设 scale → watch scale（微任务时标志已 false）→ 又等比覆盖 height，形成循环 */
function beginResizeSync() {
  syncingResize = true
  if (syncReleaseTimer) clearTimeout(syncReleaseTimer)
  syncReleaseTimer = setTimeout(() => {
    syncingResize = false
  }, 0)
}

watch(() => paramValues.value.scale, (v) => {
  if (syncingResize || !original.value || activeTool.value?.id !== 'resize') return
  beginResizeSync()
  resizeDisplayMode.value = null
  // 拖动开始（或恢复）时记录基准：slider 拖动是连续 input，若基于"上次已设的 width/height"
  // 再乘 ratio 会累积放大（1575→3354→…→clamp 4096），必须基于拖动开始时的尺寸
  if (!scaleDragBase) {
    const curW = Number(paramValues.value.width) || original.value.width
    const curH = paramValues.value.keep
      ? Math.round(original.value.height * (curW / original.value.width))
      : Number(paramValues.value.height) || original.value.height
    scaleDragBase = { w: curW, h: curH }
  }
  if (scaleDragTimer) clearTimeout(scaleDragTimer)
  scaleDragTimer = setTimeout(() => {
    scaleDragBase = null
  }, 300)
  const ratio = (Number(v) || 100) / 100
  const { w: curW, h: curH } = scaleDragBase
  // 等比学习垂直逻辑：基于当前图片等比缩放（保持当前宽高比），而非相对原图
  paramValues.value = {
    ...paramValues.value,
    width: Math.max(1, Math.min(4096, Math.round(curW * ratio))),
    height: Math.max(1, Math.min(4096, Math.round(curH * ratio)))
  }
})

// ===== crop 可拖拽选区框（与 x/y/w/h 参数双向同步）=====
type CropMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'
const cropWrap = ref<HTMLDivElement>()
const cropDrag = ref<null | {
  mode: CropMode
  startX: number
  startY: number
  rect: { x: number, y: number, w: number, h: number }
  rectW: number
  rectH: number
}>(null)

const cropRect = computed(() => ({
  x: Number(paramValues.value.x) || 0,
  y: Number(paramValues.value.y) || 0,
  w: Number(paramValues.value.w) || 80,
  h: Number(paramValues.value.h) || 80
}))

const cropHandles: Array<{ mode: CropMode, cls: string }> = [
  { mode: 'nw', cls: '-top-1 -left-1 cursor-nwse-resize' },
  { mode: 'ne', cls: '-top-1 -right-1 cursor-nesw-resize' },
  { mode: 'sw', cls: '-bottom-1 -left-1 cursor-nesw-resize' },
  { mode: 'se', cls: '-bottom-1 -right-1 cursor-nwse-resize' }
]

function clampPercent(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function onCropStart(e: PointerEvent) {
  const wrap = cropWrap.value
  if (!wrap || !original.value) return
  e.preventDefault()
  wrap.setPointerCapture(e.pointerId)
  const mode = ((e.target as HTMLElement).dataset.mode ?? 'move') as CropMode
  const r = wrap.getBoundingClientRect()
  cropDrag.value = {
    mode,
    startX: e.clientX,
    startY: e.clientY,
    rect: { ...cropRect.value },
    rectW: r.width || 1,
    rectH: r.height || 1
  }
}

function onCropMove(e: PointerEvent) {
  const d = cropDrag.value
  if (!d) return
  const dx = ((e.clientX - d.startX) / d.rectW) * 100
  const dy = ((e.clientY - d.startY) / d.rectH) * 100
  let { x, y, w, h } = d.rect
  if (d.mode === 'move') {
    x = clampPercent(x + dx, 0, 100 - w)
    y = clampPercent(y + dy, 0, 100 - h)
  } else if (d.mode === 'se') {
    w = clampPercent(w + dx, 10, 100 - x)
    h = clampPercent(h + dy, 10, 100 - y)
  } else if (d.mode === 'ne') {
    w = clampPercent(w + dx, 10, 100 - x)
    const ny = clampPercent(y + dy, 0, y + h - 10)
    h = h + y - ny
    y = ny
  } else if (d.mode === 'sw') {
    h = clampPercent(h + dy, 10, 100 - y)
    const nx = clampPercent(x + dx, 0, x + w - 10)
    w = w + x - nx
    x = nx
  } else { // nw
    const nx = clampPercent(x + dx, 0, x + w - 10)
    w = w + x - nx
    x = nx
    const ny = clampPercent(y + dy, 0, y + h - 10)
    h = h + y - ny
    y = ny
  }
  paramValues.value = {
    ...paramValues.value,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h)
  }
}

function onCropEnd(e: PointerEvent) {
  cropDrag.value = null
  cropWrap.value?.releasePointerCapture?.(e.pointerId)
}

// ===== resize GPU 直绘预览（拖动中 60fps，零 ImageData 回读） =====
function previewResize() {
  const src = origCanvas.value
  const dst = resultCanvas.value
  if (!src || !dst || !original.value) return
  const w = Math.max(1, Math.round(Number(paramValues.value.width) || original.value.width))
  const keep = Boolean(paramValues.value.keep) && !resizeDragKeep.value
  const h = keep
    ? Math.max(1, Math.round(original.value.height * (w / original.value.width)))
    : Math.max(1, Math.round(Number(paramValues.value.height) || original.value.height))
  dst.width = w
  dst.height = h
  const ctx = dst.getContext('2d')
  if (!ctx) return
  // 预览与最终结果保持同一插值方式（OpenCV 三档）
  const interp = String(paramValues.value.interpolation || 'linear')
  ctx.imageSmoothingEnabled = interp !== 'nearest'
  ctx.imageSmoothingQuality = interp === 'high' ? 'high' : 'low'
  ctx.drawImage(src, 0, 0, w, h)
}

watch(result, (v) => {
  // 慢工具（AI/OpenCV 等）出结果：轻微弹入提示更新（canvas 工具每帧重绘不弹）
  if (v && !isImmediateTool() && !resizing.value) {
    pulseResult(0.985)
  }
})

// ===== 上传 =====

const defaultSamples = computed(() => [
  { label: t('samples.face'), url: '/samples/images/portrait.jpg' },
  { label: t('samples.group'), url: '/samples/images/group.jpg' },
  { label: t('samples.landscape'), url: '/samples/images/urban-street.jpg' },
  { label: t('samples.document'), url: '/samples/images/document.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' }
])
const sampleImages = computed(() => props.samples ?? defaultSamples.value)

async function useSample(s: { url: string, secondUrl?: string }) {
  try {
    const res = await fetch(s.url)
    const blob = await res.blob()
    const file = new File([blob], s.url.split('/').pop() || 'sample.jpg', { type: blob.type })
    await loadFile(file)
    // 配对样本：同时加载第二图（单图工具暂存，切到双图工具如特征匹配时直接可用）
    if (s.secondUrl) {
      await useSecondSample(s.secondUrl)
    }
  } catch (e) {
    error.value = humanError(e, t)
  }
}

async function useSecondSample(url: string) {
  const res = await fetch(url)
  const blob = await res.blob()
  const file = new File([blob], url.split('/').pop() || 'sample2.jpg', { type: blob.type })
  await loadSecondFile(file)
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
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url)
      throw new Error(t('image.sizeInvalid'))
    }
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
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url)
      throw new Error(t('image.sizeInvalid'))
    }
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
  if (!data.width || !data.height) return
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
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ demo.title }}
            </h1>
            <DemoStatusBadge :status="demo.status" />
          </div>
          <p class="mt-1 text-muted">
            {{ demo.description }}
          </p>
        </div>
      </div>

      <!-- 工作原理（教学向，审计批次5） -->
      <HowItWorksSection :text="demo.howItWorks" />

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
              class="w-full flex flex-col items-start gap-0.5 px-2 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer"
              :class="tool.id === activeToolId
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted hover:bg-elevated/60 hover:text-highlighted'"
              @click="selectTool(tool.id)"
            >
              <!-- 两行布局：第一行完整工具名（可换行不截断），第二行类型 + 状态徽章 -->
              <span class="leading-snug w-full break-words">{{ pickText(tool.name, lang) }}</span>
              <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-dimmed shrink-0">
                <span class="font-medium">{{ kindLabel(tool.kind) }}</span>
                <span
                  v-if="tool.planned"
                  class="px-1 py-px rounded bg-neutral/10 text-dimmed normal-case"
                >
                  {{ t('image.planned') }}
                </span>
              </span>
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
                @click="useSample(s)"
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
                :disabled-keys="disabledParamKeys"
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

            <!-- 原图 / 结果：原图列 3fr（显示约为全宽的 30%，即原来的 60%），结果列 7fr 更宽 -->
            <div class="grid grid-cols-1 md:grid-cols-[3fr_7fr] gap-4">
              <div class="space-y-2">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">{{ t('image.original') }}</p>
                <div class="overflow-auto rounded-lg border border-default">
                  <div class="relative w-fit">
                    <canvas
                      ref="origCanvas"
                      class="rounded-lg max-w-full h-auto"
                    />
                    <!-- resize 三把手（原图固定，结果图响应）：右中=水平(只改宽)、下中=垂直(只改高)、右下=等比 -->
                    <button
                      v-if="activeTool?.id === 'resize' && original"
                      type="button"
                      class="absolute right-1 top-1/2 -translate-y-1/2 size-6 rounded-md bg-primary/90 text-white flex items-center justify-center shadow cursor-ew-resize hover:bg-primary transition-colors touch-none"
                      :class="{ 'ring-2 ring-primary': resizing }"
                      :aria-label="t('image.resizeDragH')"
                      data-resize-mode="h"
                      @pointerdown="onResizeStart($event, 'h')"
                    >
                      <UIcon
                        name="i-lucide-move-horizontal"
                        class="size-3.5"
                      />
                    </button>
                    <button
                      v-if="activeTool?.id === 'resize' && original"
                      type="button"
                      class="absolute bottom-1 left-1/2 -translate-x-1/2 size-6 rounded-md bg-primary/90 text-white flex items-center justify-center shadow cursor-ns-resize hover:bg-primary transition-colors touch-none"
                      :class="{ 'ring-2 ring-primary': resizing }"
                      :aria-label="t('image.resizeDragV')"
                      data-resize-mode="v"
                      @pointerdown="onResizeStart($event, 'v')"
                    >
                      <UIcon
                        name="i-lucide-move-vertical"
                        class="size-3.5"
                      />
                    </button>
                    <button
                      v-if="activeTool?.id === 'resize' && original"
                      type="button"
                      class="absolute bottom-1 right-1 size-6 rounded-md bg-primary/90 text-white flex items-center justify-center shadow cursor-nwse-resize hover:bg-primary transition-colors touch-none"
                      :class="{ 'ring-2 ring-primary': resizing }"
                      :aria-label="t('image.resizeDragS')"
                      data-resize-mode="s"
                      @pointerdown="onResizeStart($event, 's')"
                    >
                      <UIcon
                        name="i-lucide-move-diagonal"
                        class="size-3.5"
                      />
                    </button>
                    <!-- crop 选区框：拖动移动 / 四角缩放，与 x/y/w/h 参数双向同步 -->
                    <div
                      v-if="activeTool?.id === 'crop' && original"
                      ref="cropWrap"
                      class="absolute z-10 cursor-move touch-none"
                      :style="{
                        left: `${cropRect.x}%`,
                        top: `${cropRect.y}%`,
                        width: `${cropRect.w}%`,
                        height: `${cropRect.h}%`
                      }"
                      :aria-label="t('image.cropDrag')"
                      @pointerdown="onCropStart"
                      @pointermove="onCropMove"
                      @pointerup="onCropEnd"
                      @pointercancel="onCropEnd"
                    >
                      <div class="absolute inset-0 border-2 border-primary/80 bg-primary/10 pointer-events-none" />
                      <div
                        v-for="h in cropHandles"
                        :key="h.mode"
                        :data-mode="h.mode"
                        :class="h.cls"
                        class="absolute size-3 bg-primary border-2 border-white rounded-sm pointer-events-auto"
                      />
                    </div>
                  </div>
                </div>
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
                      class="rounded-lg max-w-full h-auto"
                      :class="activeTool?.interactive === 'click' ? 'cursor-crosshair' : ''"
                      :style="resizeResultStyle"
                      @click="onResultClick"
                    />
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
    </div>
  </UContainer>
</template>
