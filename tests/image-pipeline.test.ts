/**
 * 图像处理流水线测试。
 *
 * 关键点：这里**真的跑**一遍算子链，并断言每一步都确实改变了像素 ——
 * 「串起来的链」最容易出的问题是某一步静默变成恒等变换（参数没绑上、
 * 算子被跳过），只看 UI 很难发现。执行器不碰 canvas，所以能在 Node 里跑。
 *
 * Node 没有 ImageData（那是浏览器 API），这里补一个最小实现：算子只用到
 * width / height / data 三个字段，以及 `new ImageData(data, w, h)` 两种构造。
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
  buildStep,
  buildStepsFromPreset,
  defaultPreset,
  pipelineCatalog,
  pipelinePresets,
  pipelineTool,
  runPipeline
} = await import('../app/utils/image-pipeline')

/** 16×16 测试图：彩色渐变 + 一条高对比边 + 确定性椒盐噪声（保证降噪/边缘都有活干） */
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

/** 比较两图的像素差异数量与最大通道差 */
function diff(a: ImageData, b: ImageData): { changed: number, maxDelta: number } {
  let changed = 0
  let maxDelta = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0
    for (let k = 0; k < 3; k++) delta = Math.max(delta, Math.abs((a.data[i + k] ?? 0) - (b.data[i + k] ?? 0)))
    if (delta > 0) changed++
    maxDelta = Math.max(maxDelta, delta)
  }
  return { changed, maxDelta }
}

describe('算子目录', () => {
  it('只收录 canvas / opencv 两类，且分组有序', () => {
    const groups = pipelineCatalog()
    expect(groups.length).toBeGreaterThan(3)
    for (const g of groups) {
      expect(g.tools.length).toBeGreaterThan(0)
      for (const t of g.tools) {
        expect(['canvas', 'opencv']).toContain(t.kind)
        expect(t.needsSecondImage).toBeFalsy()
        expect(t.interactive).toBeFalsy()
        expect(t.planned).toBeFalsy()
      }
    }
    const pages = groups.map(g => g.page)
    expect(pages).toContain('color')
    expect(pages).toContain('edge')
    expect(new Set(pages).size).toBe(pages.length)
  })

  it('排除掉不产出新图 / 需要人工框选的算子', () => {
    const ids = pipelineCatalog().flatMap(g => g.tools.map(t => t.id))
    for (const bad of ['info', 'pixel-picker', 'pixel-grid', 'pixel-math', 'histogram', 'crop']) {
      expect(ids).not.toContain(bad)
    }
    for (const good of ['grayscale', 'denoise', 'enhance', 'unsharp-mask', 'sobel', 'adaptive-threshold']) {
      expect(ids).toContain(good)
    }
  })

  it('每个算子都能按 id 取回，并造出带默认参数的一步', () => {
    for (const group of pipelineCatalog()) {
      for (const tool of group.tools) {
        expect(pipelineTool(tool.id)?.id).toBe(tool.id)
        const step = buildStep(tool.id, 'zh')
        expect(step).not.toBeNull()
        expect(step?.enabled).toBe(true)
        for (const key of Object.keys(step?.params ?? {})) {
          expect(tool.params?.some(p => p.key === key)).toBe(true)
        }
      }
    }
    expect(buildStep('not-a-real-tool', 'zh')).toBeNull()
  })
})

describe('预设链', () => {
  it('所有预设引用的算子都存在（防止预设写错导致空链）', () => {
    for (const preset of pipelinePresets) {
      expect(preset.steps.length).toBeGreaterThan(0)
      for (const id of preset.steps) expect(pipelineTool(id), `${preset.id} → ${id}`).toBeDefined()
    }
  })

  it('默认预设造得出全部步骤，顺序与声明一致', () => {
    const steps = buildStepsFromPreset(defaultPreset, 'zh')
    expect(steps.map(s => s.toolId)).toEqual(defaultPreset.steps)
  })
})

describe('执行器', () => {
  it('按顺序产出原图 + 每步产物 + 结果，且每步都真的改变了像素', async () => {
    const input = makeImage()
    const steps = buildStepsFromPreset(defaultPreset, 'zh')
    const run = await runPipeline(input, steps, 'zh')

    // 原图 + 4 步 + 结果
    expect(run.stages).toHaveLength(steps.length + 2)
    expect(run.stages[0]?.id).toBe('input')
    expect(run.stages[run.stages.length - 1]?.id).toBe('result')
    expect(run.skipped).toEqual([])
    expect(run.totalMs).toBeGreaterThanOrEqual(0)

    // 每一步的产物都不同（链真的在流动，而不是某步恒等）
    let previous = input
    for (const stage of run.stages.slice(1, -1)) {
      const d = diff(previous, stage.image)
      expect(d.changed, `步骤 ${stage.toolId} 没有改变任何像素`).toBeGreaterThan(0)
      expect(stage.toolId).not.toBeNull()
      expect(stage.ms).toBeGreaterThanOrEqual(0)
      previous = stage.image
    }

    // 最终结果 = 最后一个步骤的产物
    expect(run.result).toBe(run.stages[run.stages.length - 2]?.image)
    expect(diff(input, run.result).changed).toBeGreaterThan(0)
  })

  it('第一步是灰度化：产物每个像素都满足 R=G=B', async () => {
    const steps = buildStepsFromPreset(defaultPreset, 'zh')
    const first = steps[0]
    expect(first?.toolId).toBe('grayscale')
    const run = await runPipeline(makeImage(), steps, 'zh')
    const gray = run.stages[1]
    expect(gray?.toolId).toBe('grayscale')
    for (let i = 0; i < (gray?.image.data.length ?? 0); i += 4) {
      expect(gray?.image.data[i]).toBe(gray?.image.data[i + 1])
      expect(gray?.image.data[i + 1]).toBe(gray?.image.data[i + 2])
    }
  })

  it('禁用的步骤被跳过，链从下一步继续', async () => {
    const steps = buildStepsFromPreset(defaultPreset, 'zh')
    if (steps[0]) steps[0].enabled = false
    const run = await runPipeline(makeImage(), steps, 'zh')
    expect(run.stages.map(s => s.toolId)).not.toContain('grayscale')
    expect(run.stages).toHaveLength(steps.length + 1) // 少一个步骤产物
    expect(run.stages[1]?.toolId).toBe(steps[1]?.toolId)
  })

  it('算子不存在时记进 skipped，不影响后面的步骤', async () => {
    const steps = buildStepsFromPreset(defaultPreset, 'zh')
    steps.splice(1, 0, { toolId: 'no-such-tool', enabled: true, params: {} })
    const run = await runPipeline(makeImage(), steps, 'zh')
    expect(run.skipped).toEqual(['no-such-tool'])
    expect(run.stages.map(s => s.toolId)).toContain('unsharp-mask')
  })

  it('同样输入跑两次结果完全一致（流水线是确定性的）', async () => {
    const steps = buildStepsFromPreset(defaultPreset, 'zh')
    const a = await runPipeline(makeImage(), steps, 'zh')
    const b = await runPipeline(makeImage(), steps, 'zh')
    expect(Array.from(a.result.data)).toEqual(Array.from(b.result.data))
  })

  it('参数真的透传到算子：改灰度方法会改变产物', async () => {
    const input = makeImage()
    const luminance = buildStep('grayscale', 'zh')!
    const average = buildStep('grayscale', 'zh')!
    average.params.method = 'average'
    const a = await runPipeline(input, [luminance], 'zh')
    const b = await runPipeline(input, [average], 'zh')
    expect(diff(a.result, b.result).changed).toBeGreaterThan(0)
  })
})
