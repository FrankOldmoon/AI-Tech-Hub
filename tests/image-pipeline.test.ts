/**
 * 图像处理入门演示的执行器测试。
 *
 * 关键点：这里**真的跑**一遍算子链，并断言每一步都确实改变了像素 ——
 * 固定的链最容易出的问题是某一步静默变成恒等变换（参数没绑上、算子被跳过），
 * 只看 UI 很难发现。执行器不碰 canvas，所以能在 Node 里跑。
 *
 * Node 没有 ImageData（那是浏览器 API），这里补一个最小实现：算子只用到
 * width / height / data 三个字段，以及 `new ImageData(data, w, h)` 两种构造。
 *
 * 最后一个算子 Sobel 是 OpenCV（需要浏览器加载 opencv.js），Node 里跑不了：
 * 这里只断言它确实在链上且标记为 opencv，实际执行由浏览器端 e2e 覆盖。
 */
import { beforeAll, describe, expect, it } from 'vitest'

class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a
      this.height = b
      this.data = new Uint8ClampedArray(a * b * 4)
    } else {
      this.data = a
      this.width = b
      this.height = c ?? 0
    }
    for (let i = 3; i < this.data.length; i += 4) {
      if (this.data[i] === 0) this.data[i] = 255
    }
  }
}

beforeAll(() => {
  (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData
})

const {
  LESSON_CHAIN,
  buildLessonSteps,
  buildStep,
  pipelineTool,
  runPipeline,
  runSegment
} = await import('../app/utils/image-pipeline')

/** 16×16 测试图：彩色渐变 + 一条高对比边 + 确定性椒盐噪声（保证降噪/增强/边缘都有活干） */
function makeImage(size = 16): ImageData {
  const img = new FakeImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      img.data[i] = (x / (size - 1)) * 255
      img.data[i + 1] = (y / (size - 1)) * 255
      img.data[i + 2] = x < size / 2 ? 40 : 220
      if ((x * 7 + y * 13) % 11 === 0) {
        img.data[i] = 255
        img.data[i + 1] = 0
        img.data[i + 2] = 0
      }
    }
  }
  return img as unknown as ImageData
}

/** 比较两图的像素差异数量 */
function diff(a: ImageData, b: ImageData): number {
  let changed = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      if ((a.data[i + k] ?? 0) !== (b.data[i + k] ?? 0)) {
        changed++
        break
      }
    }
  }
  return changed
}

/** Node 里能跑的那几步（Sobel 需要 OpenCV，交给浏览器 e2e） */
const nodeSteps = () => buildLessonSteps().filter(s => pipelineTool(s.toolId)?.kind === 'canvas')

describe('课程链', () => {
  it('链是固定的四步，顺序即讲解顺序', () => {
    expect([...LESSON_CHAIN]).toEqual(['grayscale', 'denoise', 'enhance', 'sobel'])
  })

  it('每一步的算子都存在，且能造出带默认参数的一步', () => {
    const steps = buildLessonSteps()
    expect(steps.map(s => s.toolId)).toEqual([...LESSON_CHAIN])
    expect(steps.every(s => s.enabled)).toBe(true)
    for (const step of steps) {
      const tool = pipelineTool(step.toolId)
      expect(tool, step.toolId).toBeDefined()
      for (const key of Object.keys(step.params)) {
        expect(tool?.params?.some(p => p.key === key), `${step.toolId}.${key}`).toBe(true)
      }
    }
  })

  it('前三个是 canvas 算子（即时），第四个是 OpenCV 的 Sobel', () => {
    const kinds = buildLessonSteps().map(s => pipelineTool(s.toolId)?.kind)
    expect(kinds).toEqual(['canvas', 'canvas', 'canvas', 'opencv'])
  })

  it('算子不存在时返回 null，不抛错', () => {
    expect(buildStep('not-a-real-tool')).toBeNull()
  })
})

describe('执行器', () => {
  it('逐段推进：产物按顺序累积，每步都真的改变了像素', async () => {
    const input = makeImage()
    const steps = nodeSteps()
    const { stages, skipped } = await runSegment(input, [], steps, steps.length, 'zh')

    expect(skipped).toEqual([])
    // 原图 + 每步产物
    expect(stages).toHaveLength(steps.length + 1)
    expect(stages[0]?.id).toBe('input')

    let previous = input
    for (const stage of stages.slice(1)) {
      expect(diff(previous, stage.image), `步骤 ${stage.toolId} 没有改变任何像素`).toBeGreaterThan(0)
      expect(stage.ms).toBeGreaterThanOrEqual(0)
      previous = stage.image
    }
  })

  it('分段推进与一次跑完结果一致（页面就是分段推进的）', async () => {
    const input = makeImage()
    const steps = nodeSteps()
    const whole = await runSegment(input, [], steps, steps.length, 'zh')
    let incremental = await runSegment(input, [], steps, 1, 'zh')
    incremental = await runSegment(input, incremental.stages, steps, 2, 'zh')
    incremental = await runSegment(input, incremental.stages, steps, 3, 'zh')
    // 重复推进到同一目标不应重复计算
    incremental = await runSegment(input, incremental.stages, steps, 3, 'zh')
    expect(incremental.stages).toHaveLength(whole.stages.length)
    expect(Array.from(incremental.stages[3]?.image.data ?? [])).toEqual(Array.from(whole.stages[3]?.image.data ?? []))
  })

  it('第一步是灰度化：产物每个像素都满足 R=G=B', async () => {
    const steps = nodeSteps()
    expect(steps[0]?.toolId).toBe('grayscale')
    const { stages } = await runSegment(makeImage(), [], steps, steps.length, 'zh')
    const gray = stages[1]
    for (let i = 0; i < (gray?.image.data.length ?? 0); i += 4) {
      expect(gray?.image.data[i]).toBe(gray?.image.data[i + 1])
      expect(gray?.image.data[i + 1]).toBe(gray?.image.data[i + 2])
    }
  })

  it('停用某一步：沿用上一步的产物，链不断，并记进 skipped', async () => {
    const input = makeImage()
    const steps = nodeSteps()
    const disabled = steps.map((s, i) => (i === 1 ? { ...s, enabled: false } : s))
    const { stages, skipped } = await runSegment(input, [], disabled, disabled.length, 'zh')
    expect(skipped).toEqual(['denoise'])
    // 被停用的那一步产物 = 上一步的产物
    expect(Array.from(stages[2]?.image.data ?? [])).toEqual(Array.from(stages[1]?.image.data ?? []))
    // 后面的步骤照常执行
    expect(diff(stages[2]?.image as ImageData, stages[3]?.image as ImageData)).toBeGreaterThan(0)
  })

  it('算子不存在时记进 skipped，不影响后面的步骤', async () => {
    const input = makeImage()
    const steps = [...nodeSteps(), { toolId: 'no-such-tool', enabled: true, params: {} }]
    const { stages, skipped } = await runSegment(input, [], steps, steps.length, 'zh')
    expect(skipped).toEqual(['no-such-tool'])
    expect(stages).toHaveLength(steps.length + 1)
  })

  it('runPipeline 与 runSegment 等价，且 totalMs 有值', async () => {
    const input = makeImage()
    const steps = nodeSteps()
    const run = await runPipeline(input, steps, 'zh')
    const segment = await runSegment(input, [], steps, steps.length, 'zh')
    expect(run.stages).toHaveLength(segment.stages.length)
    expect(Array.from(run.result.data)).toEqual(Array.from(segment.stages[segment.stages.length - 1]?.image.data ?? []))
    expect(run.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('同样输入跑两次结果完全一致（确定性）', async () => {
    const steps = nodeSteps()
    const a = await runPipeline(makeImage(), steps, 'zh')
    const b = await runPipeline(makeImage(), steps, 'zh')
    expect(Array.from(a.result.data)).toEqual(Array.from(b.result.data))
  })

  it('参数真的透传到算子：改灰度方法会改变产物', async () => {
    const input = makeImage()
    const luminance = buildStep('grayscale')!
    const average = { ...buildStep('grayscale')!, params: { method: 'average' } }
    const a = await runPipeline(input, [luminance], 'zh')
    const b = await runPipeline(input, [average], 'zh')
    expect(diff(a.result, b.result)).toBeGreaterThan(0)
  })
})
