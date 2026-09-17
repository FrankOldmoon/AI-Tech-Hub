/**
 * 图像处理入门演示的执行器：把几个经典算子按固定顺序串成一条链，
 * **每一步的输入是上一步的输出**。
 *
 * 这是一个教学页（与「像素原理」同组）的执行层，刻意只做三件事：
 * 1. 固定链：灰度 → 降噪 → 增强 → 特征强调（`LESSON_CHAIN`，顺序即课堂讲解顺序）；
 * 2. 复用算子：每一步都调图像处理工坊注册表里的算子，不新写任何图像算法；
 * 3. 留档：返回原图与每一步的产物，页面据此逐步展示「图像是怎么被改造的」。
 *
 * 抽成模块而不是写在页面里，是为了能在 Node 里直接测（见 tests/image-pipeline.test.ts：
 * 真的跑一遍链，并断言灰度步每个像素 R=G=B、每一步都确实改变了像素）。
 * 因此这里只做 ImageData 运算，不碰 canvas / DOM。
 */
import type { ImageTool } from './image-tools'
import { imageTools } from './image-tools'
import { buildParamSpecs } from './localized'
import { paramDefaults } from './params'

/** 演示链里的一步：绑一个算子 + 它自己的参数 */
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
  /** 原图 + 每一步的产物，顺序即执行顺序 */
  stages: PipelineStage[]
  /** 最终结果 = 最后一个产物 */
  result: ImageData
  /** 各步耗时之和（被跳过的步按 0 计） */
  totalMs: number
  /** 被跳过的步骤（停用 / 算子缺失 / 抛错） */
  skipped: string[]
}

/**
 * 这节课的固定链：灰度 → 降噪 → 增强 → 特征强调。
 *
 * 顺序不是随便定的，页面里会给学生讲清：先降维（三通道压成一）、
 * 再降噪（增强与锐化都会放大局部差异，噪声先放大就再也去不掉）、
 * 最后提特征（在已经干净的图上提取结构，否则提取到的是噪声的轮廓）。
 *
 * 前三个是 canvas 算子（即时出结果）；最后一个是 OpenCV 的 Sobel
 * （opencv.js 自托管在 public/opencv/，首次点击该步需要加载一次，约 10MB）。
 */
export const LESSON_CHAIN = ['grayscale', 'denoise', 'enhance', 'sobel'] as const

/** 按 id 取算子；不存在则返回 undefined */
export function pipelineTool(toolId: string): ImageTool | undefined {
  return imageTools.find(tool => tool.id === toolId)
}

/**
 * 造一步：参数默认值取算子自己的 specs，所以「这一步的初始状态」与
 * 「在工坊页打开同一个算子」完全一致。
 *
 * 不收 lang：默认值本身与语言无关（只有标签需要按语言解析，那是渲染时的事），
 * 所以整条链只需构造一次，切语言时不必重建。
 */
export function buildStep(toolId: string): PipelineStep | null {
  const tool = pipelineTool(toolId)
  if (!tool) return null
  return {
    toolId,
    enabled: true,
    params: paramDefaults(buildParamSpecs(tool.params, 'zh'))
  }
}

/** 按固定链造出全部步骤（算子缺失时跳过，避免一处笔误让整页空掉） */
export function buildLessonSteps(): PipelineStep[] {
  const steps: PipelineStep[] = []
  for (const toolId of LESSON_CHAIN) {
    const step = buildStep(toolId)
    if (step) steps.push(step)
  }
  return steps
}

/** 单步执行的结果 */
export interface StepOutcome {
  /** 产出的图像；null 表示该步被跳过（算子缺失或未产出图像） */
  image: ImageData | null
  /** 该步耗时（ms） */
  ms: number
  /** 是否被跳过 */
  skipped: boolean
}

/**
 * 执行一步：输入是上一步的产物（第一步则是原图）。
 *
 * 执行器只做「跑一个算子」，不关心链有多长 —— 页面据此**逐步推进**
 * （学生点到第几步就算到第几步，第 5 步的 OpenCV 也只在真正点到时才加载）。
 */
export async function runStep(
  original: ImageData,
  current: ImageData,
  step: PipelineStep,
  lang: 'zh' | 'en'
): Promise<StepOutcome> {
  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())
  const tool = pipelineTool(step.toolId)
  if (!tool) return { image: null, ms: 0, skipped: true }
  const started = now()
  try {
    const out = await tool.run({ imageData: current, original, params: step.params, lang })
    const ms = now() - started
    if (!out.imageData) return { image: null, ms, skipped: true }
    return { image: out.imageData, ms, skipped: false }
  } catch {
    return { image: null, ms: now() - started, skipped: true }
  }
}

/**
 * 把链推进到「已算完 upTo 个算子」，返回推进后的完整产物列表。
 *
 * 页面只调这一个函数：学生点到第几步就传几，函数自己判断从哪儿接着算
 * （靠已有产物里数字 id 的个数），所以不会重复运行已经算过的步骤。
 *
 * 三种情况都不会中断链：
 * - 步骤被停用（enabled: false）：直接沿用上一步的产物，让学生看到「少了这一步会怎样」
 * - 算子不存在 / 抛错 / 没产出图像：沿用上一步的产物，并把算子 id 记进 skipped
 */
export async function runSegment(
  original: ImageData,
  done: PipelineStage[],
  steps: PipelineStep[],
  upTo: number,
  lang: 'zh' | 'en'
): Promise<{ stages: PipelineStage[], skipped: string[] }> {
  const stages: PipelineStage[] = done.length
    ? [...done]
    : [{ id: 'input', image: original, toolId: null, ms: null }]
  const skipped = stages.filter(s => s.ms === 0).map(s => s.toolId ?? '')
  let index = stages.filter(s => !Number.isNaN(Number(s.id))).length

  while (index < upTo && index < steps.length) {
    const step = steps[index]
    if (!step) break
    const current = stages[stages.length - 1]?.image ?? original
    if (!step.enabled) {
      stages.push({ id: String(index), image: current, toolId: step.toolId, ms: 0 })
      skipped.push(step.toolId)
      index++
      continue
    }
    const outcome = await runStep(original, current, step, lang)
    if (!outcome.image) skipped.push(step.toolId)
    stages.push({
      id: String(index),
      // 跳过/失败时沿用上一步的产物，链的连续性不会断
      image: outcome.image ?? current,
      toolId: step.toolId,
      ms: outcome.image ? outcome.ms : 0
    })
    index++
  }
  return { stages, skipped }
}

/**
 * 一次跑完整条链。
 * 教学页是「点到第几步算到第几步」（用 runSegment），这个整体版给测试与批量场景用。
 */
export async function runPipeline(
  original: ImageData,
  steps: PipelineStep[],
  lang: 'zh' | 'en'
): Promise<PipelineRun> {
  const { stages, skipped } = await runSegment(original, [], steps, steps.length, lang)
  return {
    stages,
    result: stages[stages.length - 1]?.image ?? original,
    totalMs: stages.reduce((sum, stage) => sum + (stage.ms ?? 0), 0),
    skipped
  }
}
