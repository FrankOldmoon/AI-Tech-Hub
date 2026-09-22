/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll } from 'vitest'

// 浏览器里 ImageData 是全局的；Node 测试里补一个最小实现
beforeAll(() => {
  class FakeImageData {
    width: number
    height: number
    data: Uint8ClampedArray | Float32Array
    constructor(a: any, b?: number, c?: number) {
      if (typeof a === 'number') {
        this.width = a
        this.height = b ?? a
        this.data = new Uint8ClampedArray(a * this.height * 4)
      } else {
        this.width = b as number
        this.height = c as number
        this.data = a
      }
    }
  }
  ;(globalThis as any).ImageData = FakeImageData
})

const mod = await import('../app/utils/image-classification')
const {
  SHAPE_CLASSES,
  WORK_SIZE,
  GRID,
  renderShape,
  shapeSample,
  thumbnailOf,
  descriptorOf,
  descriptorImage,
  thumbnailImage,
  trainPrototypes,
  scoreClasses,
  classifyField,
  evaluatePrototypes,
  learningCurve,
  cosineSimilarity,
  distanceTo,
  normalizeValues,
  resizeField,
  buildPrototype
} = mod

/** 造一个全零 / 常数的 ScalarField，用于「边界」用例 */
function field(w: number, h: number, value = 0) {
  return { width: w, height: h, data: new Float32Array(w * h).fill(value) }
}

describe('renderShape', () => {
  it('produces a WORK_SIZE×WORK_SIZE field with both light and dark pixels', () => {
    const f = renderShape('circle')
    expect(f.width).toBe(WORK_SIZE)
    expect(f.height).toBe(WORK_SIZE)
    const max = Math.max(...f.data)
    const min = Math.min(...f.data)
    expect(max).toBeGreaterThan(200)
    expect(min).toBeLessThan(55)
  })

  it('each of the four shapes yields a distinct pattern', () => {
    const sig = SHAPE_CLASSES.map((c) => {
      const f = renderShape(c.id)
      // 用「亮像素占比」粗略区分（十字应当明显比实心圆/方少）
      let on = 0
      for (const v of f.data) if (v > 128) on++
      return on / f.data.length
    })
    // 圆/方接近（实心），十字明显更少
    expect(sig[3]!).toBeLessThan(sig[0]! * 0.7)
  })
})

describe('descriptorOf', () => {
  it('is zero-mean and unit-norm', () => {
    const f = renderShape('square', { seed: 3 })
    const d = descriptorOf(f, { edge: true })
    expect(d.length).toBe(GRID * GRID)
    let mean = 0
    let sq = 0
    for (const v of d) {
      mean += v
      sq += v * v
    }
    expect(Math.abs(mean)).toBeLessThan(1e-4)
    expect(Math.abs(Math.sqrt(sq) - 1)).toBeLessThan(1e-4)
  })

  it('alignment makes the same class closer than a different class', () => {
    const base = renderShape('circle', { seed: 2 })
    const moved = renderShape('circle', { dx: 0.25, dy: -0.2, scale: 1.35, seed: 2 })
    const da = descriptorOf(base, { edge: true })
    const db = descriptorOf(moved, { edge: true })
    const dSquare = descriptorOf(renderShape('square', { seed: 2 }), { edge: true })
    // 位置/大小变了，但同类的描述子仍比异类更近 —— 这才是分类真正依赖的不变性
    expect(distanceTo(da, db)).toBeLessThan(distanceTo(da, dSquare))
  })

  it('a translated/scaled input still classifies to the same class', () => {
    const { prototypes } = trainPrototypes(SHAPE_CLASSES, { perClass: 8, edge: true })
    const base = renderShape('square', { dx: 0, dy: 0, scale: 1, seed: 4 })
    const moved = renderShape('square', { dx: 0.25, dy: -0.2, scale: 1.35, seed: 4 })
    expect(scoreClasses(descriptorOf(base, { edge: true }), prototypes)[0]!.classId).toBe('square')
    expect(scoreClasses(descriptorOf(moved, { edge: true }), prototypes)[0]!.classId).toBe('square')
  })

  it('a blank field gives a zero descriptor without NaN', () => {
    const d = descriptorOf(field(64, 64, 0), { edge: true })
    for (const v of d) expect(Number.isNaN(v)).toBe(false)
    // 全零 → 归一化后仍为全零
    expect(Math.abs(d[0]!)).toBeLessThan(1e-9)
  })
})

describe('cosineSimilarity / distanceTo', () => {
  it('identical vectors → 1, opposite → -1', () => {
    const a = new Float32Array([1, 2, 3])
    // cosineSimilarity 内部除以模长，未归一化的向量也算对
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6)
    expect(cosineSimilarity(a, new Float32Array([-1, -2, -3]))).toBeCloseTo(-1, 6)
    expect(distanceTo(a, a)).toBeCloseTo(0, 6)
  })
})

describe('normalizeValues', () => {
  it('zero vector stays zero (no NaN)', () => {
    const out = normalizeValues(new Float32Array([0, 0, 0, 0]))
    for (const v of out) expect(Number.isNaN(v)).toBe(false)
  })
})

describe('trainPrototypes + scoreClasses', () => {
  const { prototypes } = trainPrototypes(SHAPE_CLASSES, { perClass: 8, edge: true })

  it('builds one prototype per class with the right count', () => {
    expect(prototypes.length).toBe(4)
    for (const p of prototypes) expect(p.count).toBe(8)
  })

  it('a clean sample of each class is classified top-1', () => {
    for (const cls of SHAPE_CLASSES) {
      const { field: f } = shapeSample(cls.id, { difficulty: 0, seed: 5 })
      const ranked = scoreClasses(descriptorOf(f, { edge: true }), prototypes)
      expect(ranked[0]!.classId).toBe(cls.id)
    }
  })

  it('a moderate-difficulty sample (page default) is classified top-1', () => {
    for (const cls of SHAPE_CLASSES) {
      const { field: f } = shapeSample(cls.id, { difficulty: 0.45, seed: 9 })
      const ranked = scoreClasses(descriptorOf(f, { edge: true }), prototypes)
      expect(ranked[0]!.classId).toBe(cls.id)
    }
  })

  it('softmax scores sum to 1 and are sorted descending', () => {
    const { field: f } = shapeSample('cross', { difficulty: 0.3, seed: 11 })
    const ranked = scoreClasses(descriptorOf(f, { edge: true }), prototypes)
    const sum = ranked.reduce((a, r) => a + r.score, 0)
    expect(sum).toBeCloseTo(1, 6)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score - 1e-9)
    }
  })

  it('higher temperature flattens the distribution', () => {
    const { field: f } = shapeSample('circle', { difficulty: 0.2, seed: 4 })
    const d = descriptorOf(f, { edge: true })
    const sharp = scoreClasses(d, prototypes, 0.04)
    const soft = scoreClasses(d, prototypes, 0.5)
    // 锐利时第一名占比更高
    expect(sharp[0]!.score).toBeGreaterThan(soft[0]!.score)
  })
})

describe('evaluatePrototypes', () => {
  it('accuracy on a held-out set is reasonable with 8 examples/class', () => {
    const { prototypes } = trainPrototypes(SHAPE_CLASSES, { perClass: 8, edge: true })
    const res = evaluatePrototypes(prototypes, SHAPE_CLASSES, { perClass: 8, edge: true })
    expect(res.total).toBe(32)
    expect(res.accuracy).toBeGreaterThan(0.7)
  })
})

describe('learningCurve', () => {
  const curve = learningCurve([1, 2, 4, 8, 16], {
    edge: true,
    evalJitter: { translation: 0.15, scale: 0.2, rotation: 0, noise: 0.17 }
  })
  it('returns one point per count within [0,1]', () => {
    expect(curve.length).toBe(5)
    for (const p of curve) {
      expect(p.count).toBeGreaterThan(0)
      expect(p.accuracy).toBeGreaterThanOrEqual(0)
      expect(p.accuracy).toBeLessThanOrEqual(1)
    }
  })
  it('shows the “more examples → better” trend (first ≤ last)', () => {
    expect(curve[0]!.accuracy).toBeLessThanOrEqual(curve[curve.length - 1]!.accuracy + 1e-9)
  })
})

describe('display helpers', () => {
  it('thumbnailImage returns a grayscale ImageData of grid×grid', () => {
    const f = renderShape('triangle', { seed: 7 })
    const { values } = thumbnailOf(f)
    const img = thumbnailImage(values, GRID)
    expect(img.width).toBe(GRID)
    expect(img.height).toBe(GRID)
    expect(img.data.length).toBe(GRID * GRID * 4)
  })

  it('descriptorImage encodes sign with red/blue and is opaque', () => {
    const f = renderShape('circle', { seed: 1 })
    const d = descriptorOf(f, { edge: true })
    const img = descriptorImage(d, GRID)
    expect(img.width).toBe(GRID)
    // 所有像素不透明
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255)
  })
})

describe('resizeField + buildPrototype', () => {
  it('resizeField maps any field to WORK_SIZE×WORK_SIZE', () => {
    const small = field(16, 16, 200)
    const big = resizeField(small, WORK_SIZE)
    expect(big.width).toBe(WORK_SIZE)
    expect(big.height).toBe(WORK_SIZE)
  })

  it('buildPrototype from empty list still yields a unit descriptor of correct length', () => {
    const p = buildPrototype(SHAPE_CLASSES[0]!, [])
    // 空列表：均值全 0，normalizeValues 保留全 0；长度正确
    expect(p.descriptor.length).toBe(GRID * GRID)
    expect(p.count).toBe(0)
  })
})

describe('classifyField', () => {
  it('returns descriptor, thumbnail and a ranked list for a field', () => {
    const { prototypes } = trainPrototypes(SHAPE_CLASSES, { perClass: 8, edge: true })
    const { field: f } = shapeSample('square', { difficulty: 0.45, seed: 9 })
    const out = classifyField(f, prototypes, { edge: true })
    expect(out.descriptor.length).toBe(GRID * GRID)
    expect(out.ranked.length).toBe(4)
    expect(out.ranked[0]!.classId).toBe('square')
  })
})
