/**
 * 「边缘检测入门」执行层的测试。
 *
 * 这页最容易悄悄坏掉的地方不是画布，而是**数学**：差分核填反（正负颠倒）、
 * 合成强度写成简单相加、阈值语义漂了、叠图把非边缘也算成边缘……
 * 现象都是「图看起来还行」，但讲的道理已经不成立了。所以这里对着构造图逐条断言：
 *
 * 1) 三色带图（黑 | 白 | 黑，竖直分界）—— 图像在竖直方向完全不变，于是：
 *    - 纵向变化 Gy 处处为 0（同一列上下完全一样，没有「上下差」）；
 *    - 横向变化 Gx 只在两条分界线上非零，且左边界为正、右边界为负（方向相反）；
 *    - 合成强度在分界线上最大，在平坦区严格为 0。
 * 2) 横条图（黑 | 白 | 黑，水平分界）—— 与上面互为镜像：Gx ≈ 0、Gy 在分界线最强。
 * 3) 线性斜坡图 —— 手算复核三个算子的权重差异：Sobel 4、Prewitt 3、Scharr 16（正权重和）。
 * 4) 棋盘格（高频噪声）—— 验证「先降噪」不是摆设：平滑后梯度峰值必须大幅下降。
 * 5) 孤立亮点（噪点）—— 平滑把它摊开，峰值同样下降。
 *
 * Node 没有 ImageData，这里补一个最小实现（与 feature-extraction.test.ts 同一套路）。
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
  BOX_BLUR,
  EDGE_OPERATORS,
  edgeRatio,
  gradientAt,
  gradientFields,
  magnitudeField,
  maskToImageData,
  neighborhood,
  normalizeField,
  operatorById,
  overlayImageData,
  smoothField,
  strongestPixel,
  thresholdMask
} = await import('../app/utils/edge-detection')

const { statsOf } = await import('../app/utils/feature-extraction')

/** 直接造一张单通道浮点图（不需要 ImageData） */
function field(width: number, height: number, value: (x: number, y: number) => number) {
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = value(x, y)
  }
  return { width, height, data }
}

const at = (f: { width: number, data: Float32Array }, x: number, y: number) => f.data[y * f.width + x] ?? 0

/** 竖直分界：x < 7 → 20，7 ≤ x < 14 → 230，其余 → 20（沿 y 完全不变） */
function verticalBands() {
  return field(20, 12, x => (x >= 7 && x < 14 ? 230 : 20))
}

/** 水平分界：y < 7 → 20，7 ≤ y < 14 → 230，其余 → 20（沿 x 完全不变） */
function horizontalBands() {
  return field(12, 20, (_x, y) => (y >= 7 && y < 14 ? 230 : 20))
}

/** 线性斜坡：每向右一格 +12（沿 y 不变）→ 差分响应处处相同，可以手算 */
function ramp() {
  return field(20, 5, x => x * 12)
}

const magOf = (f: { width: number, height: number, data: Float32Array }, opId = 'sobel') => {
  const { gx, gy } = gradientFields(f, opId)
  return { gx, gy, mag: magnitudeField(gx, gy) }
}

describe('gradientFields / magnitudeField —— 横向看左右、纵向看上下', () => {
  it('竖直分界：Gy 处处为 0，Gx 只在分界线上非零且左右符号相反', () => {
    const { gx, gy } = gradientFields(verticalBands(), 'sobel')

    // 同一列上下完全一样 → 没有任何「上下差」
    for (let y = 0; y < 12; y++) {
      expect(Math.abs(at(gy, 8, y))).toBeLessThan(1e-6)
    }

    // 平坦区（x = 2）没有左右差
    expect(Math.abs(at(gx, 2, 5))).toBeLessThan(1e-6)

    // 左分界：左暗右亮 → 正响应；右分界：左亮右暗 → 负响应（方向恰好相反）
    const leftBoundary = Math.max(at(gx, 6, 5), at(gx, 7, 5))
    const rightBoundary = Math.min(at(gx, 13, 5), at(gx, 14, 5))
    expect(leftBoundary).toBeGreaterThan(800)
    expect(rightBoundary).toBeLessThan(-800)
  })

  it('横条图与竖条图互为镜像：Gx ≈ 0，Gy 在分界线最强', () => {
    const { gx, gy } = gradientFields(horizontalBands(), 'sobel')
    for (let x = 0; x < 12; x++) {
      expect(Math.abs(at(gx, x, 10))).toBeLessThan(1e-6)
    }
    const boundary = Math.max(at(gy, 5, 6), at(gy, 5, 7))
    expect(boundary).toBeGreaterThan(800)
    expect(Math.abs(at(gy, 5, 2))).toBeLessThan(1e-6)
  })

  it('合成强度 = √(Gx² + Gy²)，平坦区严格为 0', () => {
    const gx = field(3, 1, x => [3, 0, 1][x] ?? 0)
    const gy = field(3, 1, x => [4, 0, 0][x] ?? 0)
    const mag = magnitudeField(gx, gy)
    expect(at(mag, 0, 0)).toBeCloseTo(5, 6) // 3-4-5
    expect(at(mag, 1, 0)).toBe(0)

    const { mag: bandMag } = magOf(verticalBands())
    expect(at(bandMag, 2, 5)).toBeLessThan(1e-6)
    expect(at(bandMag, 6, 5)).toBeGreaterThan(800)
  })

  it('找不到的算子回落到第一个（不抛错）', () => {
    expect(operatorById('nope').id).toBe(EDGE_OPERATORS[0]!.id)
  })
})

describe('三个算子的区别 —— 结构一样，只差权重', () => {
  it('线性斜坡上的响应等于「正权重之和 × 每格增量」', () => {
    // 每格 +12，中心点左右各差一格 → 右 − 左 = 24
    const step = 24
    const sobel = gradientFields(ramp(), 'sobel').gx
    const prewitt = gradientFields(ramp(), 'prewitt').gx
    const scharr = gradientFields(ramp(), 'scharr').gx

    // 正权重和：Sobel 1+2+1 = 4，Prewitt 1+1+1 = 3，Scharr 3+10+3 = 16
    expect(at(sobel, 10, 2)).toBeCloseTo(4 * step, 3)
    expect(at(prewitt, 10, 2)).toBeCloseTo(3 * step, 3)
    expect(at(scharr, 10, 2)).toBeCloseTo(16 * step, 3)
  })

  it('同一点上 Scharr 比 Sobel 强 4 倍，Prewitt 弱一点', () => {
    const sobel = at(gradientFields(ramp(), 'sobel').gx, 10, 2)
    const scharr = at(gradientFields(ramp(), 'scharr').gx, 10, 2)
    const prewitt = at(gradientFields(ramp(), 'prewitt').gx, 10, 2)
    expect(scharr / sobel).toBeCloseTo(4, 3)
    expect(prewitt / sobel).toBeCloseTo(0.75, 3)
  })
})

describe('降噪 —— 不是摆设，高频噪声必须被压下去', () => {
  it('随机噪点（高频）平滑后梯度峰值大幅下降', () => {
    // 确定性伪随机（LCG）：不用 Math.random，测试可复现
    let seed = 12345
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return (seed / 4294967296) * 255
    }
    const noisy = field(64, 64, () => rnd())

    const before = statsOf(magOf(noisy).mag).maxAbs
    const after = statsOf(magOf(smoothField(noisy)).mag).maxAbs
    expect(before).toBeGreaterThan(400)
    // 均值核把 9 个邻居一平均，噪点之间的「抖动」就被抹平了 → 梯度峰值明显下降
    expect(after).toBeLessThan(before * 0.5)
  })

  it('孤立亮点（噪点）平滑后峰值同样下降', () => {
    const spike = field(16, 16, () => 128)
    spike.data[8 * 16 + 8] = 255
    const before = statsOf(magOf(spike).mag).maxAbs
    const after = statsOf(magOf(smoothField(spike)).mag).maxAbs
    expect(after).toBeLessThan(before)
  })

  it('BOX_BLUR 是归一化的 3×3 均值核（权重和 = 1）', () => {
    const sum = BOX_BLUR.flat().reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(BOX_BLUR.length).toBe(3)
  })
})

describe('阈值与边缘图', () => {
  const sample = field(3, 1, x => [0, 5, 10][x] ?? 0)

  it('阈值按峰值比例切：门槛之上才算边', () => {
    expect(thresholdMask(sample, 0.5).count).toBe(2) // ≥ 5
    expect(thresholdMask(sample, 1).count).toBe(1) // ≥ 10
    expect(thresholdMask(sample, 0).count).toBe(3) // 全部
    expect(edgeRatio(sample, 0.5)).toBeCloseTo(2 / 3, 6)
  })

  it('阈值越高，留下的边缘只减不增（对学生是真看得见的现象）', () => {
    const { mag } = magOf(verticalBands())
    let prev = Number.POSITIVE_INFINITY
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const count = thresholdMask(mag, t).count
      expect(count).toBeLessThanOrEqual(prev)
      prev = count
    }
  })

  it('边缘图只有黑白两色且完全不透明', () => {
    const { mag } = magOf(verticalBands())
    const img = maskToImageData(mag, 0.5) as unknown as { width: number, height: number, data: Uint8ClampedArray }
    expect(img.width).toBe(20)
    expect(img.height).toBe(12)
    for (let p = 0; p < img.data.length; p += 4) {
      expect(img.data[p + 3]).toBe(255)
      expect([0, 255]).toContain(img.data[p])
      expect(img.data[p]).toBe(img.data[p + 1])
      expect(img.data[p]).toBe(img.data[p + 2])
    }
    // 分界线上确实有白线
    expect(img.data[(5 * 20 + 6) * 4]).toBe(255)
    // 平坦区确实是黑的
    expect(img.data[(5 * 20 + 2) * 4]).toBe(0)
  })

  it('全零图不产生 NaN（阈值 0 时退化成「全是边」，但不崩）', () => {
    const empty = field(8, 8, () => 0)
    const { mag } = magOf(empty)
    expect(Array.from(mag.data).every(Number.isFinite)).toBe(true)
    expect(statsOf(mag).maxAbs).toBe(0)
    expect(thresholdMask(mag, 0.5).count).toBe(0)
    expect(normalizeField(mag).data.every(v => Number.isFinite(v))).toBe(true)
    expect(strongestPixel(mag)).toEqual({ x: 0, y: 0, value: 0 })
  })

  it('归一化按本图峰值（最强响应满格）', () => {
    const f = field(3, 1, x => [0, 5, 10][x] ?? 0)
    const n = normalizeField(f)
    expect(at(n, 0, 0)).toBeCloseTo(0, 6)
    expect(at(n, 1, 0)).toBeCloseTo(0.5, 6)
    expect(at(n, 2, 0)).toBeCloseTo(1, 6)
  })
})

describe('叠回原图（第 4 步）', () => {
  /** 4×1 的原图：四个像素各给一个可分辨的颜色 */
  function srcRow() {
    const img = new FakeImageData(4, 1)
    const colors = [[200, 100, 50], [200, 100, 50], [200, 100, 50], [200, 100, 50]]
    colors.forEach((c, i) => {
      img.data[i * 4] = c[0]!
      img.data[i * 4 + 1] = c[1]!
      img.data[i * 4 + 2] = c[2]!
      img.data[i * 4 + 3] = 255
    })
    return img as unknown as ImageData
  }

  it('shape 模式：非边缘全黑，边缘点亮成暖色', () => {
    const src = srcRow()
    const mag = field(4, 1, x => (x < 2 ? 0 : 10))
    const out = overlayImageData(src, mag, 0.5, { mode: 'shape' }) as unknown as { data: Uint8ClampedArray }
    // 非边缘 → 全黑
    expect(out.data[0]).toBe(0)
    expect(out.data[1]).toBe(0)
    expect(out.data[2]).toBe(0)
    // 边缘 → 暖色（红通道拉满，且绿 > 蓝 = 暖色系）
    expect(out.data[8]).toBe(255)
    expect(out.data[9]).toBeGreaterThan(140)
    expect(out.data[9]).toBeGreaterThan(out.data[10] ?? 0)
    // 全部不透明
    for (let p = 3; p < out.data.length; p += 4) expect(out.data[p]).toBe(255)
  })

  it('overlay 模式：非边缘保留一点点原图（压暗），边缘仍点亮', () => {
    const src = srcRow()
    const mag = field(4, 1, x => (x < 2 ? 0 : 10))
    const out = overlayImageData(src, mag, 0.5, { mode: 'overlay' }) as unknown as { data: Uint8ClampedArray }
    // 非边缘：原图 200 → 压暗到 200 × 0.18 = 36
    expect(out.data[0]).toBe(36)
    expect(out.data[0]).toBeLessThan(60)
    // 边缘：红通道拉满
    expect(out.data[8]).toBe(255)
  })

  it('更陡的边更亮（同一阈值带内按强度提亮）', () => {
    const src = srcRow()
    const mag = field(4, 1, x => [0, 0, 10, 100][x] ?? 0)
    const out = overlayImageData(src, mag, 0.05, { mode: 'overlay' }) as unknown as { data: Uint8ClampedArray }
    // 索引 3 比索引 2 更陡 → 绿通道更高（更接近白）
    expect(out.data[3 * 4 + 1]).toBeGreaterThan(out.data[2 * 4 + 1] ?? 0)
  })
})

describe('邻居亮度表与读数', () => {
  const f = field(5, 5, (x, y) => (y * 5 + x) * 10)

  it('5×5 表：中心格就是被选中的那个像素', () => {
    const n = neighborhood(f, 2, 2, 5)
    expect(n.length).toBe(5)
    expect(n[0]!.length).toBe(5)
    expect(n[2]![2]).toBe(at(f, 2, 2))
  })

  it('越界时复制边缘（不凭空造出黑边）', () => {
    const n = neighborhood(f, 0, 0, 3)
    // 左上角：左上那一格越界 → 复制 (0,0)
    expect(n[0]![0]).toBe(at(f, 0, 0))
    expect(n[1]![1]).toBe(at(f, 0, 0))
  })

  it('读数取自算好的 Gx / Gy 图，方向角随之确定', () => {
    const gx = field(3, 3, () => 3)
    const gy = field(3, 3, () => 4)
    const r = gradientAt(gx, gy, 1, 1)
    expect(r.gx).toBeCloseTo(3, 6)
    expect(r.gy).toBeCloseTo(4, 6)
    expect(r.magnitude).toBeCloseTo(5, 6)
    expect(r.angle).toBeCloseTo(53.13, 1) // atan2(4, 3)

    // 纯横向变化 → 0°；纯纵向 → ±90°
    const onlyX = gradientAt(field(3, 3, () => 1), field(3, 3, () => 0), 1, 1)
    expect(Math.abs(onlyX.angle)).toBeLessThan(1e-6)
    const onlyY = gradientAt(field(3, 3, () => 0), field(3, 3, () => 1), 1, 1)
    expect(Math.abs(onlyY.angle)).toBeCloseTo(90, 6)
  })

  it('最陡的点落在分界线上（默认指针的位置）', () => {
    const { mag } = magOf(verticalBands())
    const s = strongestPixel(mag)
    expect([6, 7]).toContain(s.x)
    expect(s.value).toBeGreaterThan(800)
  })
})
