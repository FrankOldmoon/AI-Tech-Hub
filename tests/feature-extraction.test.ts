/**
 * 「特征提取入门」执行层的测试。
 *
 * 这页最容易悄悄坏掉的地方不是画布，而是**数学**：核填错、归一化把负响应吃掉、
 * 池化写成平均……现象都是「图看起来还行」，但讲的道理已经不成立了。
 * 所以这里对着两张**构造图**逐条断言，值都可以手算复核：
 *
 * 1) 三色带图（黑 | 白 | 黑，竖直分界）—— 图像在竖直方向完全不变，于是：
 *    - 竖直边缘核只在两条分界线上响应（左边界强正、右边界强负），平坦区严格为 0；
 *    - 同一条分界线，水平边缘核处处为 0 —— 「换核 = 换看什么」的硬证据；
 *    - 最强的响应落在伪彩色带顶端（红），响应为 0 的地方落在底端（深蓝）。
 * 2) 亮边图（最左一列白，其余黑）—— 用来区分边界补零与复制边缘：
 *    补零会在画框外凭空造出一条假边，复制边缘不会。
 *
 * 另外量化对比「边缘核 vs 平滑核」的响应集中度：平滑核处处都在响应，
 * 集中度必然低于只在轮廓上响应的边缘核 —— 这正是页面上那个徽章的依据。
 *
 * Node 没有 ImageData，这里补一个最小实现（与 image-pipeline.test.ts 同一套路）。
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
} = await import('../app/utils/feature-extraction')

const SIZE = 24

/** 三色带图：x < 8 黑、8 ≤ x < 16 白、x ≥ 16 黑（竖直方向完全不变） */
function bandsImage(size = SIZE): ImageData {
  const img = new FakeImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const v = x >= size / 3 && x < (size * 2) / 3 ? 255 : 0
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
    }
  }
  return img as unknown as ImageData
}

/** 亮边图：最左一列白（画框本身就是亮边），其余黑（竖直方向不变） */
function brightColumnImage(size = 8): ImageData {
  const img = new FakeImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const v = x === 0 ? 255 : 0
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
    }
  }
  return img as unknown as ImageData
}

const at = (field: { data: Float32Array, width: number }, x: number, y: number) =>
  field.data[y * field.width + x] ?? 0

const kernelOf = (id: string) => FEATURE_KERNELS.find(k => k.id === id)!.matrix
const grayOf = (img: ImageData) => toGrayFloat(img)
const bands = () => grayOf(bandsImage())

describe('灰度化', () => {
  it('彩色图压成单通道：三通道按亮度加权', () => {
    const img = new FakeImageData(4, 4)
    for (let i = 0; i < img.data.length; i += 4) img.data[i] = 255 // 纯红
    const field = toGrayFloat(img as unknown as ImageData)
    expect(field.width).toBe(4)
    expect(field.height).toBe(4)
    expect(at(field, 1, 1)).toBeCloseTo(0.299 * 255, 4)
  })
})

describe('卷积响应', () => {
  it('竖直边缘核：只在两条分界线上响应，且左右边界符号相反', () => {
    const field = convolveField(bands(), kernelOf('edge-v'))
    // 左边界（暗→亮）与右边界（亮→暗）各有一条强响应，方向相反
    const left = Math.abs(at(field, 7, 12))
    const right = Math.abs(at(field, 15, 12))
    expect(left).toBeGreaterThan(500)
    expect(right).toBeGreaterThan(500)
    expect(at(field, 7, 12) * at(field, 15, 12)).toBeLessThan(0)
    // 平坦区严格为 0（黑区、白区内部都一样）
    for (const x of [1, 3, 11, 20, 22]) {
      expect(Math.abs(at(field, x, 12)), `x=${x} 平坦区不该有响应`).toBeLessThan(1e-6)
    }
    // 每条分界线上，整列响应一致（图像竖直方向不变）
    expect(at(field, 7, 3)).toBeCloseTo(at(field, 7, 20), 5)
  })

  it('水平边缘核：对同一条竖直分界线处处无反应（换核 = 换「看什么」）', () => {
    const field = convolveField(bands(), kernelOf('edge-h'))
    for (let x = 0; x < field.width; x++) {
      expect(Math.abs(at(field, x, 12)), `x=${x}`).toBeLessThan(1e-6)
    }
  })

  it('平滑核（反例）：处处都在响应，响应集中度明显低于边缘核', () => {
    const edge = statsOf(convolveField(bands(), kernelOf('edge-v')))
    const blur = statsOf(convolveField(bands(), kernelOf('blur')))
    expect(edge.focus).toBeGreaterThan(0.8)
    expect(blur.focus).toBeLessThan(0.7)
    expect(edge.focus).toBeGreaterThan(blur.focus + 0.1)
  })

  it('每个教学核都正好是 3×3，讲解文案中英齐全', () => {
    for (const kernel of FEATURE_KERNELS) {
      expect(kernel.matrix, kernel.id).toHaveLength(3)
      for (const row of kernel.matrix) expect(row).toHaveLength(3)
      expect(kernel.responds.zh.length).toBeGreaterThan(0)
      expect(kernel.responds.en.length).toBeGreaterThan(0)
    }
  })

  it('权重和决定输出性质：边缘核为 0（只剩变化），锐化/平滑为 1（保住亮度）', () => {
    expect(matrixSum(kernelOf('edge-v'))).toBeCloseTo(0, 10)
    expect(matrixSum(kernelOf('edge-h'))).toBeCloseTo(0, 10)
    expect(matrixSum(kernelOf('sharpen'))).toBeCloseTo(1, 10)
    expect(matrixSum(kernelOf('blur'))).toBeCloseTo(1, 10)
  })

  it('自定义核的默认权重与「竖直边缘」预设一致（一上手就能看出反应）', () => {
    const preset = KERNEL_PRESETS.find(p => p.id === 'edge-v')!
    expect(preset.matrix).toEqual(CUSTOM_KERNEL_DEFAULT)
  })

  it('边界处理：复制边缘不会在画框外造出假边，补零会', () => {
    const gray = grayOf(brightColumnImage())
    const edge = convolveField(gray, kernelOf('edge-v'), 'edge')
    const zero = convolveField(gray, kernelOf('edge-v'), 'zero')
    // 最左一列本身就是亮边：复制边缘（左边还是亮的）→ 负响应；补零（左边变黑）→ 无响应
    expect(at(edge, 0, 4)).toBeLessThan(-500)
    expect(Math.abs(at(zero, 0, 4))).toBeLessThan(1e-6)
  })

  it('空核不炸：原样返回', () => {
    const src = bands()
    const out = convolveField(src, [])
    expect(out.width).toBe(src.width)
    expect(Array.from(out.data)).toEqual(Array.from(src.data))
  })
})

describe('特征图后处理', () => {
  const response = () => convolveField(bands(), kernelOf('edge-v'))

  it('ReLU 把负响应清零，取模保留（两者只在符号上不同）', () => {
    const src = response()
    const relu = reluField(src)
    const abs = absField(src)
    let negatives = 0
    for (let i = 0; i < src.data.length; i++) {
      const v = src.data[i] ?? 0
      if (v < 0) {
        negatives++
        expect(relu.data[i]).toBe(0)
        expect(abs.data[i]).toBeCloseTo(-v, 5)
      } else {
        expect(relu.data[i]).toBeCloseTo(v, 5)
        expect(abs.data[i]).toBeCloseTo(v, 5)
      }
    }
    expect(negatives).toBeGreaterThan(0)
  })

  it('最大池化：尺寸按倍数缩小，每格取窗口内最强响应', () => {
    const src = absField(response())
    const pooled = poolField(src, 4)
    expect(pooled.width).toBe(Math.ceil(src.width / 4))
    expect(pooled.height).toBe(Math.ceil(src.height / 4))

    let max = 0
    for (const v of src.data) if (v > max) max = v
    let pooledMax = 0
    for (const v of pooled.data) if (v > pooledMax) pooledMax = v
    // 池化不该造出比原图更强的响应（也不是平均那种「全都变弱」）
    expect(pooledMax).toBeLessThanOrEqual(max + 1e-6)
    expect(pooledMax).toBeGreaterThan(max * 0.5)
  })

  it('池化 1×1 是恒等：不复制、不改尺寸', () => {
    const src = absField(response())
    expect(poolField(src, 1)).toBe(src)
  })

  it('响应集中度定义：峰值 / 平均 / 1 − 平均÷峰值', () => {
    const stats = statsOf(absField(response()))
    expect(stats.maxAbs).toBeGreaterThan(0)
    expect(stats.meanAbs).toBeGreaterThan(0)
    expect(stats.focus).toBeCloseTo(1 - stats.meanAbs / stats.maxAbs, 6)
  })
})

describe('响应图渲染', () => {
  const field = () => absField(convolveField(bands(), kernelOf('edge-v')))

  it('灰度模式 R=G=B，伪彩模式真的上了色，且都不透明', () => {
    const src = field()
    const gray = fieldToImageData(src)
    const heat = fieldToImageData(src, { colorize: true })

    let colored = 0
    for (let i = 0; i < gray.data.length; i += 4) {
      expect(gray.data[i + 3]).toBe(255)
      expect(gray.data[i]).toBe(gray.data[i + 1])
      expect(gray.data[i + 1]).toBe(gray.data[i + 2])
      if (heat.data[i] !== heat.data[i + 1] || heat.data[i + 1] !== heat.data[i + 2]) colored++
    }
    expect(colored).toBeGreaterThan(src.width * src.height / 10)
  })

  it('按本图峰值拉满：最强响应落在色带顶端（红），响应为 0 处落在底端（深蓝）', () => {
    const src = field()
    const heat = fieldToImageData(src, { colorize: true })

    let maxIdx = 0
    for (let i = 1; i < src.data.length; i++) {
      if ((src.data[i] ?? 0) > (src.data[maxIdx] ?? 0)) maxIdx = i
    }
    expect(heat.data[maxIdx * 4]).toBeGreaterThan(200) // R 高
    expect(heat.data[maxIdx * 4 + 2]).toBeLessThan(120) // B 低

    // 平坦区响应为 0 → 色带底端：R 低、B 高
    const flat = (5 * src.width + 2) * 4
    expect(src.data[5 * src.width + 2]).toBe(0)
    expect(heat.data[flat]).toBeLessThan(60)
    expect(heat.data[flat + 2]).toBeGreaterThan(60)
  })

  it('全零响应图不除零（返回色带底端，不产生 NaN）', () => {
    const empty = { width: 4, height: 4, data: new Float32Array(16) }
    const img = fieldToImageData(empty, { colorize: true })
    for (let i = 0; i < img.data.length; i += 4) {
      expect(Number.isNaN(img.data[i])).toBe(false)
      expect(img.data[i]).toBeLessThan(60)
    }
  })
})
