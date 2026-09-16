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
import { humanError, mediaError } from '~/utils/errors'
import type { ImageTool, ImageToolKind } from '~/utils/image-tools'
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import { buildParamSpecs, pickText } from '~/utils/localized'
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
const resultInfo = ref<{ label: string, value: string }[]>([])
const fileName = ref('')
const secondFileName = ref('')
const sourceBytes = ref(0)
const running = ref(false)
const error = ref<string | null>(null)
const dragOver = ref(false)
const webcamOpen = ref(false)

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
  // MediaPipe 任务复用 visionTasks 的参数（label 走 i18n key），其余走 LocalizedParamSpec
  const resolved = activeTool.value?.resolvedParams?.(t)
  if (resolved) return resolved
  const base = buildParamSpecs(activeTool.value?.params, lang.value)
  if (activeTool.value?.id === 'resize' && original.value) {
    return base.map((s) => {
      if (s.key === 'width' || s.key === 'height') {
        const src = s.key === 'width' ? original.value!.width : original.value!.height
        // max 只依原图尺寸决定（≤2 倍、上限 4096），不随拖拽中的当前值变化——
        // 否则拖动会让 max 不断增长并重渲染面板，打断原生 range 的首次拖拽
        const max = Math.min(4096, Math.max(src * 2, 512))
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
  tesseract: 'Tesseract',
  yolo: 'YOLO',
  tfjs: 'TensorFlow.js'
}

function kindLabel(kind: ImageToolKind): string {
  return kindLabels[kind]
}

// ===== 运行时可观测：单次耗时 + 实际后端 =====
// 能力页的价值在于「同一任务多实现对比」，因此必须把耗时与后端显式呈现，
// 否则学生会把「后端差距」误读成「模型差距」。

const lastRunMs = ref<number | null>(null)
const lastDevice = ref<string | null>(null)
/** 本机是否支持 WebGPU（复用 utils/transformers 的判定；动态引入以免把推理库带进首屏） */
const gpuOk = ref(false)

onMounted(async () => {
  applyDeepLink()
  try {
    const { hasWebGPU } = await import('~/utils/transformers')
    gpuOk.value = hasWebGPU()
  } catch { /* 探测失败即按不支持处理 */ }
})

/** 实际后端：工具报告优先，否则按 kind + 本机能力推断 */
function effectiveDevice(res?: { device?: string } | null): string {
  if (res?.device) return res.device
  switch (activeTool.value?.kind) {
    case 'transformers': return gpuOk.value ? 'webgpu' : 'wasm'
    case 'mediapipe': return 'GPU'
    case 'yolo': return gpuOk.value ? 'webgpu' : 'wasm'
    case 'opencv':
    case 'tesseract': return 'wasm'
    default: return 'cpu'
  }
}

/** canvas 类工具每帧重跑（<16ms），展示耗时与后端只会是噪声 */
const showRunMeta = computed(() =>
  activeTool.value?.kind !== 'canvas' && (lastRunMs.value !== null || lastDevice.value !== null)
)

/** 「耗时 38 ms · 后端 webgpu」——用 computed 拼串，避免模板里堆内联 template */
const runMetaText = computed(() => {
  const parts: string[] = []
  if (lastRunMs.value !== null) parts.push(`${t('image.elapsed')} ${lastRunMs.value} ms`)
  if (lastDevice.value) parts.push(`${t('image.backend')} ${lastDevice.value}`)
  return parts.join(' · ')
})

// ===== 深链：URL ↔ 工具/参数 =====
// 形如 /vision/detection?tool=yolo-detect&conf=0.4 —— 老师可把「指定工具 + 指定参数」
// 的链接发给学生，点开即落在同一状态。参数按各自默认值的类型还原。

const route = useRoute()
const router = useRouter()

function coerceQuery(defaultValue: unknown, raw: unknown): number | string | boolean | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  if (typeof defaultValue === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (typeof defaultValue === 'boolean') return raw === '1' || raw === 'true'
  return raw
}

/** 从 URL 还原的参数（只取当前工具 spec 里存在的键，按各自默认值的类型转换） */
function urlParams(): Record<string, number | string | boolean> {
  const base = paramDefaults(specs.value)
  const out: Record<string, number | string | boolean> = {}
  for (const [key, def] of Object.entries(base)) {
    const v = coerceQuery(def, route.query[key])
    if (v !== undefined) out[key] = v
  }
  return out
}

/** 切工具时待还原的深链参数：由 activeToolId 的 watcher 消费
 *（否则「切工具→重置默认值」会把 URL 里的参数覆盖掉） */
let pendingParams: Record<string, number | string | boolean> | null = null

/** 进入页面时按 URL 恢复工具与参数 */
function applyDeepLink() {
  const wanted = String(route.query.tool ?? '')
  if (wanted !== '' && wanted !== activeToolId.value && props.tools.some(x => x.id === wanted)) {
    pendingParams = urlParams()
    activeToolId.value = wanted
    return
  }
  paramValues.value = { ...paramDefaults(specs.value), ...urlParams() }
}

let urlTimer: ReturnType<typeof setTimeout> | null = null
/** 上一次写进 URL 的参数键：切工具后据此清掉旧工具残留的 query */
let writtenParams = new Set<string>()

/** 状态变化写回 URL（防抖避免刷历史；只写偏离默认值的参数，链接保持简短） */
function syncUrl() {
  if (urlTimer) clearTimeout(urlTimer)
  urlTimer = setTimeout(() => {
    const defaults = paramDefaults(specs.value)
    const query: Record<string, string> = {}
    for (const [k, v] of Object.entries(route.query)) {
      if (typeof v === 'string' && k !== 'tool' && !writtenParams.has(k)) query[k] = v
    }
    if (activeToolId.value) query.tool = activeToolId.value
    const next = new Set<string>()
    for (const [k, v] of Object.entries(paramValues.value)) {
      if (v === undefined || v === null || v === '') continue
      if (String(v) === String(defaults[k])) continue
      query[k] = String(v)
      next.add(k)
    }
    writtenParams = next
    router.replace({ query })
  }, 400)
}

watch([activeToolId, paramValues], syncUrl, { deep: true })

// ===== 首次加载提示 =====
// 模型首次下载 + 初始化期间界面只有转圈，容易被当成卡死；超过阈值就给一句说明。

const slowHint = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | null = null

function startSlowHint() {
  if (isImmediateTool()) return
  if (slowTimer) clearTimeout(slowTimer)
  slowTimer = setTimeout(() => {
    slowHint.value = true
  }, 1200)
}

function stopSlowHint() {
  if (slowTimer) {
    clearTimeout(slowTimer)
    slowTimer = null
  }
  slowHint.value = false
}

// 离开页面时取消挂起的写 URL / 慢加载提示，避免卸载后回写地址栏
onUnmounted(() => {
  if (urlTimer) clearTimeout(urlTimer)
  if (slowTimer) clearTimeout(slowTimer)
})

// 左侧工具栏数据（共享 ToolSidebar 组件，样式集中在组件内）
// section 按当前页面 slug 解析（能力页 = 实现引擎，引擎页 = 任务族），再经 i18n 取文案
function sectionFor(tool: ImageTool): string | undefined {
  const key = tool.section?.[props.demo.slug] ?? tool.section?.['*']
  return key ? t(key) : undefined
}

const toolItems = computed<ToolSidebarItem[]>(() => props.tools.map(tool => ({
  id: tool.id,
  label: pickText(tool.name, lang.value),
  kind: kindLabel(tool.kind),
  badge: tool.planned ? t('image.planned') : undefined,
  section: sectionFor(tool)
})))

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
  // 深链切工具时合并 URL 参数；普通切工具则回到该工具的参数默认值
  const merged = pendingParams ? { ...paramDefaults(specs.value), ...pendingParams } : paramDefaults(specs.value)
  pendingParams = null
  paramValues.value = merged
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

function selectTool(rawId: string | number) {
  // 切工具即断开摄像头（避免多实例占轨道 / 指示灯不灭）
  if (liveActive.value) stopLive()
  activeToolId.value = String(rawId)
  pulseResult(0.97)
}

// ===== 参数合并 =====

/** 与参数默认值合并（避免首次运行缺键导致 NaN）；拖动 resize 把手时忽略 keep */
function mergedParams(): Record<string, number | string | boolean> {
  const merged: Record<string, number | string | boolean> = { ...paramDefaults(specs.value), ...paramValues.value }
  if (activeTool.value?.id === 'resize' && resizeDragKeep.value) merged.keep = false
  return merged
}

// ===== 交互式提示点（interactive: 'prompt'：点击坐标喂回推理）=====

/** 提示点（归一化 0~1，相对结果画布）；未点击时为 null */
const promptPoint = computed<{ x: number, y: number } | null>(() => {
  const x = Number(paramValues.value.promptX)
  const y = Number(paramValues.value.promptY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
})
const promptTool = computed(() => activeTool.value?.interactive === 'prompt')

function clearPrompt() {
  const next = { ...paramValues.value }
  delete next.promptX
  delete next.promptY
  paramValues.value = next
}

// ===== 实时模式（ImageTool.live：摄像头逐帧推理）=====

const liveRequested = ref(false)
const liveActive = ref(false)
const liveStarting = ref(false)
const liveVideo = ref<HTMLVideoElement>()
let liveStream: MediaStream | null = null
let liveRaf = 0
let liveLastTime = -1
let liveInferring = false

const liveSupported = computed(() => Boolean(activeTool.value?.live))

async function startLive() {
  const tool = activeTool.value
  if (!tool?.live || liveStarting.value) return
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = t('errors.insecureContext')
    return
  }
  liveStarting.value = true
  liveRequested.value = true
  error.value = null
  try {
    await nextTick()
    const video = liveVideo.value
    if (!video) return
    if (!liveStream) {
      liveStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    }
    video.srcObject = liveStream
    await video.play()
    await tool.live.ensure()
    liveLastTime = -1
    liveActive.value = true
    loopLive()
  } catch (e) {
    error.value = mediaError(e, t)
    stopLive()
  } finally {
    liveStarting.value = false
  }
}

/** 逐帧循环：runFrame 允许异步，用 liveInferring 守卫避免重入 */
function loopLive() {
  if (!liveActive.value) return
  const video = liveVideo.value
  const tool = activeTool.value
  if (video && tool?.live && !liveInferring && video.readyState >= 2 && video.currentTime !== liveLastTime) {
    liveLastTime = video.currentTime
    liveInferring = true
    Promise.resolve(tool.live.runFrame(video, performance.now(), mergedParams(), lang.value))
      .then((res) => {
        if (res && liveActive.value) {
          if (res.imageData) result.value = res.imageData
          resultInfo.value = res.info ?? []
          // 实时为逐帧循环，单帧耗时不具可比性，只标注后端
          lastRunMs.value = null
          lastDevice.value = effectiveDevice(res)
        }
      })
      .catch((e) => { error.value = humanError(e, t) })
      .finally(() => { liveInferring = false })
  }
  liveRaf = requestAnimationFrame(loopLive)
}

function stopLive() {
  liveActive.value = false
  liveRequested.value = false
  if (liveRaf) {
    cancelAnimationFrame(liveRaf)
    liveRaf = 0
  }
  liveInferring = false
  liveLastTime = -1
  if (liveStream) {
    liveStream.getTracks().forEach(tr => tr.stop())
    liveStream = null
  }
  if (liveVideo.value) liveVideo.value.srcObject = null
  activeTool.value?.live?.dispose?.()
}

onBeforeUnmount(() => {
  stopLive()
})

// ===== 手绘输入（needsDrawing 工具，如简笔画识别）=====

const sketchBrush = ref(24)
const sketchClearToken = ref(0)
const needsDrawing = computed(() => Boolean(activeTool.value?.needsDrawing))

/** 画布变化（每次笔画结束）→ 作为「原图」并立即重跑 */
function onSketchChange(data: ImageData) {
  original.value = data
  fileName.value = 'sketch'
  sourceBytes.value = data.width * data.height * 4
  result.value = null
  resultInfo.value = []
  error.value = null
  runLater()
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
    const params = mergedParams()
    const src = isImmediateTool() ? original.value : alg.cloneImageData(original.value)
    const t0 = performance.now()
    startSlowHint()
    const res = await tool.run({
      imageData: src,
      original: original.value,
      secondImage: secondOriginal.value ?? undefined,
      params,
      lang: lang.value
    })
    const elapsed = Math.round(performance.now() - t0)
    if (req === latestReq) {
      if (res.imageData) result.value = res.imageData
      resultInfo.value = res.info ?? []
      lastRunMs.value = elapsed
      lastDevice.value = effectiveDevice(res)
    }
  } catch (e) {
    if (req === latestReq) {
      error.value = humanError(e, t)
      resultInfo.value = []
      lastRunMs.value = null
      lastDevice.value = null
    }
  } finally {
    stopSlowHint()
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
  if (liveActive.value) stopLive()
  resizeDisplayMode.value = null
  clearPrompt()
  paramValues.value = paramDefaults(specs.value)
  // resize 工具：恢复为原图尺寸（与默认跟随原图一致，而非 specs 硬编码 800×600）
  if (activeTool.value?.id === 'resize' && original.value) {
    paramValues.value = {
      ...paramValues.value,
      width: original.value.width,
      height: original.value.height
    }
  }
  // 手绘工具：清空画布即可，画布的 change 事件会自动重跑
  if (needsDrawing.value) {
    sketchClearToken.value += 1
    return
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
  // 慢工具（AI/OpenCV 等）出结果：轻微弹入提示更新（canvas 工具每帧重绘不弹；实时逐帧不弹）
  if (v && !isImmediateTool() && !resizing.value && !liveActive.value) {
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

function onCamCapture(file: File) {
  loadFile(file)
  webcamOpen.value = false
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

watch(original, v => drawCanvas(origCanvas.value, v), { flush: 'post' })
watch(result, v => drawCanvas(resultCanvas.value, v), { flush: 'post' })
watch(secondOriginal, v => drawCanvas(secondCanvas.value, v), { flush: 'post' })

function onResultClick(e: MouseEvent) {
  const tool = activeTool.value
  const canvas = resultCanvas.value
  if (!tool || !canvas || !original.value) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  // prompt：点击坐标（归一化）喂回推理，触发重跑（交互式分割）
  if (tool.interactive === 'prompt') {
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    paramValues.value = { ...paramValues.value, promptX: nx, promptY: ny }
    if (liveActive.value) return
    runNow()
    return
  }
  // click：只读像素信息，不改变结果
  if (tool.interactive === 'click' && tool.onPick && result.value) {
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
          <UIcon
            :name="demo.icon"
            class="size-6"
          />
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

      <ToolSidebar
        :model-value="activeToolId"
        :title="t('image.tools')"
        :items="toolItems"
        @update:model-value="selectTool"
      >
        <!-- 实时模式取帧源（不可见但保持播放；结果画布直接显示视频帧 + 叠加） -->
        <video
          v-show="liveRequested"
          ref="liveVideo"
          class="absolute w-px h-px opacity-0 pointer-events-none"
          playsinline
          muted
          autoplay
        />

        <!-- 手绘输入（needsDrawing 工具）：白底粗黑线，快照即「原图」 -->
        <div
          v-if="needsDrawing"
          class="rounded-xl border border-default p-3 space-y-3"
        >
          <div>
            <p class="text-sm font-medium text-highlighted">
              {{ t('image.sketchTitle') }}
            </p>
            <p class="mt-1 text-xs text-dimmed">
              {{ t('image.sketchHint') }}
            </p>
          </div>
          <SketchCanvas
            :brush="sketchBrush"
            :clear-token="sketchClearToken"
            @change="onSketchChange"
          />
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-xs text-muted shrink-0">{{ t('image.brush') }}</span>
            <input
              v-model.number="sketchBrush"
              type="range"
              min="8"
              max="48"
              step="2"
              class="flex-1 min-w-32"
              :aria-label="t('image.brush')"
            >
            <span class="text-xs text-muted tabular-nums w-7">{{ sketchBrush }}</span>
            <UButton
              icon="i-lucide-rotate-ccw"
              size="xs"
              color="neutral"
              variant="soft"
              @click="sketchClearToken += 1"
            >
              {{ t('image.clearCanvas') }}
            </UButton>
          </div>
        </div>

        <!-- 上传区 -->
        <div
          v-if="!original && !needsDrawing"
          class="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors"
          :class="dragOver ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/60'"
          @click="openFilePicker"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <UIcon
            name="i-lucide-image-plus"
            class="size-10 text-muted mx-auto"
          />
          <p class="mt-3 text-sm font-medium text-highlighted">
            {{ t('image.upload') }}
          </p>
          <p class="mt-1 text-xs text-dimmed">
            {{ t('image.uploadHint') }}
          </p>
          <div
            class="mt-4 flex flex-wrap justify-center items-center gap-2"
            @click.stop
          >
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

        <!-- 摄像头取帧 -->
        <div
          v-if="webcamOpen"
          class="mt-4"
        >
          <WebcamCapture
            @capture="onCamCapture"
            @close="webcamOpen = false"
          />
        </div>
        <button
          v-if="!webcamOpen && !needsDrawing"
          type="button"
          class="mt-3 mx-auto flex items-center gap-2 rounded-lg border border-default/70 bg-elevated/40 px-3 py-1.5 text-sm text-muted transition hover:border-primary/50 hover:text-highlighted"
          @click="webcamOpen = true"
        >
          <UIcon
            name="i-lucide-video"
            class="size-4"
          />
          {{ t('webcam.useCamera') }}
        </button>

        <template v-if="original">
          <!-- 图片信息 -->
          <div class="flex flex-wrap gap-2 text-xs">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ fileName }}
            </UBadge>
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ original.width }} × {{ original.height }}
            </UBadge>
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ alg.formatBytes(sourceBytes) }}
            </UBadge>
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ modeText }}
            </UBadge>
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
              <UButton
                icon="i-lucide-play"
                :loading="running"
                @click="runNow"
              >
                {{ t('image.run') }}
              </UButton>
              <UButton
                v-if="liveSupported"
                :icon="liveActive ? 'i-lucide-square' : 'i-lucide-video'"
                :color="liveActive ? 'error' : 'primary'"
                :variant="liveActive ? 'subtle' : 'soft'"
                :loading="liveStarting"
                :disabled="liveStarting"
                @click="liveActive ? stopLive() : startLive()"
              >
                {{ liveActive ? t('image.liveStop') : t('image.liveStart') }}
              </UButton>
              <UButton
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="soft"
                @click="reset"
              >
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

          <!-- 原图 / 结果：两列对半，图像一样大 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-if="!needsDrawing"
              class="space-y-2"
            >
              <p class="text-xs font-medium text-muted uppercase tracking-wide">
                {{ t('image.original') }}
              </p>
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
            <div :class="needsDrawing ? 'space-y-2 md:col-span-2' : 'space-y-2'">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">
                  {{ t('image.result') }}
                  <span
                    v-if="running"
                    class="text-primary normal-case tracking-normal ms-2"
                  >
                    <UIcon
                      name="i-lucide-loader-circle"
                      class="size-3.5 inline animate-spin align-[-2px]"
                    />
                    {{ t('image.processing') }}
                  </span>
                </p>
                <p
                  v-if="showRunMeta"
                  class="text-xs text-dimmed tabular-nums"
                >
                  {{ runMetaText }}
                </p>
              </div>
              <p
                v-if="slowHint"
                class="text-xs text-dimmed"
              >
                {{ t('image.firstLoadHint') }}
              </p>
              <div class="overflow-auto rounded-lg border border-default">
                <div
                  class="relative w-fit"
                  :style="{ transform: `scale(${resultPulse})`, transformOrigin: 'center' }"
                >
                  <canvas
                    ref="resultCanvas"
                    class="rounded-lg max-w-full h-auto"
                    :class="activeTool?.interactive === 'click' || promptTool ? 'cursor-crosshair' : ''"
                    :style="resizeResultStyle"
                    @click="onResultClick"
                  />
                  <!-- 交互式提示点标记（interactive: 'prompt'） -->
                  <span
                    v-if="promptTool && promptPoint"
                    class="absolute size-3 rounded-full bg-primary ring-2 ring-white pointer-events-none -translate-x-1/2 -translate-y-1/2"
                    :style="{ left: `${promptPoint.x * 100}%`, top: `${promptPoint.y * 100}%` }"
                  />
                </div>
              </div>
              <p
                v-if="activeTool?.interactive === 'click'"
                class="text-xs text-dimmed"
              >
                {{ t('image.clickHint') }}
              </p>
              <p
                v-if="promptTool"
                class="text-xs text-dimmed"
              >
                {{ t('image.promptHint') }}
              </p>
            </div>
          </div>

          <!-- 第二张图（双图工具） -->
          <div
            v-if="activeTool?.needsSecondImage"
            class="rounded-lg border border-default p-4"
          >
            <p class="text-xs font-medium text-muted uppercase tracking-wide mb-2">
              {{ t('image.secondImage') }}
            </p>
            <div
              v-if="!secondOriginal"
              class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary/60"
              @click="openSecondFilePicker"
              @dragover.prevent
              @drop.prevent="onSecondDrop"
            >
              <UIcon
                name="i-lucide-image-plus"
                class="size-8 text-muted mx-auto"
              />
              <p class="mt-2 text-xs text-dimmed">
                {{ t('image.secondImageHint') }}
              </p>
            </div>
            <div
              v-else
              class="flex items-start gap-3"
            >
              <canvas
                ref="secondCanvas"
                class="max-w-[180px] h-auto rounded-lg border border-default"
              />
              <div class="text-xs text-muted space-y-1">
                <p>{{ secondFileName }}</p>
                <p>{{ secondOriginal.width }} × {{ secondOriginal.height }}</p>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-refresh-cw"
                  @click="openSecondFilePicker"
                >
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
          <div
            v-if="resultInfo.length"
            class="rounded-lg border border-default p-3"
          >
            <p class="text-xs font-medium text-muted uppercase tracking-wide mb-2">
              {{ t('image.info') }}
            </p>
            <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div
                v-for="(row, i) in resultInfo"
                :key="i"
                class="flex justify-between gap-4"
              >
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
      </ToolSidebar>
    </div>
  </UContainer>
</template>
