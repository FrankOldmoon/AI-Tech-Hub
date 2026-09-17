/**
 * 图像处理流水线：把「图像处理工坊」里已有的算子串成一条链，
 * **每一步的输入是上一步的输出** —— 这正是它和工坊页的区别：工坊是「一个算子一张卡」，
 * 每个算子都作用在原图上；这里是一条连续的处理链，可以看中间过程。
 *
 * 为什么单独抽成模块而不是写在页面里：执行器只做 ImageData 运算，不碰 canvas / DOM，
 * 因此可以在 Node 里直接跑测试（见 tests/image-pipeline.test.ts：真的跑一遍
 * 灰度 → 降噪 → 增强 → 细节强化，并断言每一步都确实改变了像素）。
 *
 * 只收录 canvas / opencv 两类算子：它们是确定性的经典算法、不需要下载模型，
 * 适合课堂现场一步步演示。mediapipe / yolo / transformers 这类模型任务不在其中
 * （它们要等模型加载，串起来误差来源太多，不利于讲清「算法链」这件事）。
 */
import type { ImageTool } from './image-tools'
import type { LocalizedText } from './localized'
import { imageTools, toolPages } from './image-tools'
import { buildParamSpecs } from './localized'
import { paramDefaults } from './params'

/** 流水线里的一步：绑一个算子 + 它自己的参数 */
export interface PipelineStep {
  /** 算子 id（imageTools 里的 id） */
  toolId: string
  /** 是否参与本次执行 */
  enabled: boolean
  params: Record<string, number | string | boolean>
}

/** 执行产物：每一步之后得到的图像 */
export interface PipelineStage {
  /** 'input'（原图）/ 'result'（最终）/ 步骤下标字符串 */
  id: string
  image: ImageData
  /** 产出它的算子 id；原图与最终结果为空 */
  toolId: string | null
  /** 该步耗时（ms）；原图与最终结果为空 */
  ms: number | null
}

export interface PipelineRun {
  /** 原图 + 每一步的产物，顺序即执行顺序（被禁用的步骤不出现） */
  stages: PipelineStage[]
  result: ImageData
  totalMs: number
  /** 执行中产出为空图像、被跳过的步骤（正常应为空） */
  skipped: string[]
}

// ===== 算子目录 =====

/** 目录里出现的页面，顺序即分组顺序 */
const CATALOG_PAGES = ['color', 'adjustment', 'filters', 'enhancement', 'morphology', 'edge', 'object', 'transform'] as const

/** 分组标题（与 image-tools.ts 的 page 归属对应） */
export const pipelinePageLabels: Record<string, LocalizedText> = {
  color: { zh: '颜色', en: 'Color' },
  adjustment: { zh: '调整', en: 'Adjustment' },
  filters: { zh: '滤波', en: 'Filters' },
  enhancement: { zh: '增强', en: 'Enhancement' },
  morphology: { zh: '形态学', en: 'Morphology' },
  edge: { zh: '边缘', en: 'Edge' },
  object: { zh: '轮廓', en: 'Contours' },
  transform: { zh: '几何', en: 'Geometry' }
}

/**
 * 不适合进链的算子：
 * - 只报信息/只取像素，不产出新图（info / pixel-picker / pixel-grid / pixel-math）
 * - 直方图是统计图，接在链中间没有意义
 * - crop 需要人工框选，属于交互式工具
 */
const EXCLUDED = new Set(['info', 'pixel-picker', 'pixel-grid', 'pixel-math', 'histogram', 'crop'])

export interface PipelineCatalogGroup {
  page: string
  label: LocalizedText
  tools: ImageTool[]
}

/** 可进流水线的算子，按所属页面分组 */
export function pipelineCatalog(): PipelineCatalogGroup[] {
  const groups: PipelineCatalogGroup[] = []
  for (const page of CATALOG_PAGES) {
    const tools = imageTools.filter((tool) => {
      if (tool.kind !== 'canvas' && tool.kind !== 'opencv') return false
      if (EXCLUDED.has(tool.id) || tool.planned) return false
      if (tool.needsSecondImage || tool.interactive) return false
      return toolPages(tool).includes(page)
    })
    if (!tools.length) continue
    groups.push({ page, label: pipelinePageLabels[page] ?? { zh: page, en: page }, tools })
  }
  return groups
}

/** 按 id 取算子（目录外的 id 也会命中，便于以后加步骤时直接复用）；不存在则返回 undefined */
export function pipelineTool(toolId: string): ImageTool | undefined {
  return imageTools.find(tool => tool.id === toolId)
}

/**
 * 造一步：参数默认值取算子自己的 specs，所以「加进流水线」和「在工坊页打开」
 * 的初始状态完全一致。
 */
export function buildStep(toolId: string, lang: 'zh' | 'en'): PipelineStep | null {
  const tool = pipelineTool(toolId)
  if (!tool) return null
  return {
    toolId,
    enabled: true,
    params: paramDefaults(buildParamSpecs(tool.params, lang))
  }
}

// ===== 预设链 =====

export interface PipelinePreset {
  id: string
  label: LocalizedText
  hint: Localized
  /** 步骤算子 id，顺序即执行顺序 */
  steps: string[]
}

/**
 * 预设链。第一条是默认：全 canvas 算子，改参数即时出结果，不依赖 OpenCV。
 * 第二条对应「经典图像处理流程」的教学味道（灰度 → 降噪 → 增强 → 边缘），
 * 用真正的 Sobel（OpenCV）演示特征强化。
 */
export const pipelinePresets: PipelinePreset[] = [
  {
    id: 'classic',
    label: { zh: '经典四步（快速）', en: 'Classic four (fast)' },
    hint: { zh: '灰度 → 降噪 → 增强 → 细节强化，全部为浏览器内的像素运算，拖参数即时出结果。', en: 'Grayscale → denoise → enhance → detail boost. All in-browser pixel math, updates instantly.' },
    steps: ['grayscale', 'denoise', 'enhance', 'unsharp-mask']
  },
  {
    id: 'edge',
    label: { zh: '含边缘检测（OpenCV）', en: 'With edge detection (OpenCV)' },
    hint: { zh: '把最后一步换成 Sobel 边缘（OpenCV.js）。首次运行需要加载 OpenCV，会慢一些。', en: 'Replaces the last step with Sobel edges (OpenCV.js). The first run must load OpenCV, so it is slower.' },
    steps: ['grayscale', 'denoise', 'enhance', 'sobel']
  },
  {
    id: 'scan',
    label: { zh: '文档扫描风', en: 'Document scan' },
    hint: { zh: '灰度 → 自动对比度 → 自适应阈值，把照片里的文字提成黑白稿。', en: 'Grayscale → auto contrast → adaptive threshold, turning text in a photo into black and white.' },
    steps: ['grayscale', 'auto-contrast', 'adaptive-threshold']
  }
]

export const defaultPreset: PipelinePreset = pipelinePresets[0]!

/** 按预设造出一组步骤（算子不存在时跳过，避免预设写错就整页空掉） */
export function buildStepsFromPreset(preset: PipelinePreset, lang: 'zh' | 'en'): PipelineStep[] {
  const steps: PipelineStep[] = []
  for (const toolId of preset.steps) {
    const step = buildStep(toolId, lang)
    if (step) steps.push(step)
  }
  return steps
}

// ===== 执行 =====

/**
 * 依次执行启用的步骤，返回原图与每一步的产物。
 * 单步失败不会中断整条链：记进 skipped 并跳过该步（沿用该步的输入），
 * 否则课堂演示时一个畸形参数就会把整条链变成空白。
 */
export async function runPipeline(
  input: ImageData,
  steps: PipelineStep[],
  lang: 'zh' | 'en',
  onStage?: (stage: PipelineStage) => void
): Promise<PipelineRun> {
  const stages: PipelineStage[] = [{ id: 'input', image: input, toolId: null, ms: null }]
  const skipped: string[] = []
  let current = input
  let totalMs = 0

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step || !step.enabled) continue
    const tool = pipelineTool(step.toolId)
    if (!tool) {
      skipped.push(step.toolId)
      continue
    }
    const started = typeof performance === 'undefined' ? Date.now() : performance.now()
    try {
      const out = await tool.run({
        imageData: current,
        original: input,
        params: step.params,
        lang
      })
      const finished = typeof performance === 'undefined' ? Date.now() : performance.now()
      if (!out.imageData) {
        skipped.push(step.toolId)
        continue
      }
      current = out.imageData
      const stage: PipelineStage = { id: String(i), image: current, toolId: step.toolId, ms: finished - started }
      stages.push(stage)
      totalMs += stage.ms ?? 0
      onStage?.(stage)
    } catch {
      skipped.push(step.toolId)
    }
  }

  const result: PipelineStage = { id: 'result', image: current, toolId: null, ms: null }
  stages.push(result)
  return { stages, result: current, totalMs, skipped }
}
