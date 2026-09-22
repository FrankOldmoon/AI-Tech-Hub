/**
 * 「边缘检测入门」教学页的执行层。
 *
 * 一句话：**边缘 = 亮度变化剧烈的地方**。所以整页只做四件事：
 *   1. 彩图 → 单通道灰度（边缘只看亮度，不看颜色）
 *   2. 用「差分核」量出每个像素的横向变化 Gx 与纵向变化 Gy
 *   3. 合成强度 |∇| = √(Gx² + Gy²)，再用阈值决定「多陡才算一条边」
 *   4. 把边缘叠回原图 —— AI 从此看到的是形状，而不是一堆像素
 *
 * 复用 feature-extraction 的**浮点卷积**：差分核的响应有正有负，
 * 正表示「往右（下）变亮」、负表示「往左（上）变亮」，方向信息不能丢 ——
 * 而 8 位卷积会把负响应截成 0，正好把一半方向信息丢掉，所以这里不用它。
 *
 * 全部是纯运算，不碰 canvas / DOM，可在 Node 里跑测试。
 */
import type { ScalarField } from '~/utils/feature-extraction'
import { convolveField, statsOf } from '~/utils/feature-extraction'

/** 页面内的双语文案（与 image-pipeline / feature-extraction 一致：教学文案跟着页面走） */
export interface Localized {
  zh: string
  en: string
}

/** 一个「差分算子」：一对核，分别量横向与纵向的变化 */
export interface EdgeOperator {
  id: string
  name: Localized
  /** 横向差分核：左边取负、右边取正 → 量「左 → 右」的变化 */
  gx: number[][]
  /** 纵向差分核：上边取负、下边取正 → 量「上 → 下」的变化 */
  gy: number[][]
  /** 讲解：这几个算子到底差在哪 */
  note: Localized
}

/**
 * 三个经典算子，顺序即讲解顺序：Sobel（默认）→ Prewitt（把权重拉平）→ Scharr（把中间权重加大）。
 * 教学点：它们结构完全一样，只差几个权重 —— 响应强弱、抗噪能力就变了。
 * 这也是「算子是可以设计出来的」最直观的例子。
 */
export const EDGE_OPERATORS: EdgeOperator[] = [
  {
    id: 'sobel',
    name: { zh: 'Sobel', en: 'Sobel' },
    gx: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
    gy: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
    note: {
      zh: '最常用的默认算子：中间一行（列）的权重加到 2，相当于先做一点平滑再差分，所以对噪点没那么敏感。',
      en: 'The usual default: the middle row/column is weighted 2, which is like smoothing a little before differencing — so it tolerates noise better.'
    }
  },
  {
    id: 'prewitt',
    name: { zh: 'Prewitt', en: 'Prewitt' },
    gx: [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]],
    gy: [[-1, -1, -1], [0, 0, 0], [1, 1, 1]],
    note: {
      zh: '把 Sobel 的权重全部拉平成 1：结构完全一样，但没有那道「中行加权」的平滑，所以对噪点更敏感 —— 区别只在那个 2 和 1。',
      en: 'Flattens Sobel’s weights to 1: the structure is identical, but without the middle-row smoothing it is more sensitive to noise — the only difference is that 2 versus 1.'
    }
  },
  {
    id: 'scharr',
    name: { zh: 'Scharr', en: 'Scharr' },
    gx: [[-3, 0, 3], [-10, 0, 10], [-3, 0, 3]],
    gy: [[-3, -10, -3], [0, 0, 0], [3, 10, 3]],
    note: {
      zh: '把中行权重加到 10：对缓缓倾斜的坡面响应更强、方向也更准，代价是噪点一起被放大。',
      en: 'Raises the middle weight to 10: stronger and more accurate on gently slanted ramps, at the cost of amplifying noise too.'
    }
  }
]

export function operatorById(id: string): EdgeOperator {
  return EDGE_OPERATORS.find(o => o.id === id) ?? (EDGE_OPERATORS[0] as EdgeOperator)
}

/** 3×3 均值核：做差分之前的降噪前置步骤 */
export const BOX_BLUR: number[][] = [
  [1 / 9, 1 / 9, 1 / 9],
  [1 / 9, 1 / 9, 1 / 9],
  [1 / 9, 1 / 9, 1 / 9]
]

/**
 * 降噪：先糊一下再做差分。
 * 这是真实边缘检测的固定前置步骤 —— 噪点本身就是一处「亮度突变」，
 * 不先压掉它，它会一路变成一堆假边缘。教学上这个开关很有说服力。
 */
export function smoothField(field: ScalarField, kernel: number[][] = BOX_BLUR): ScalarField {
  return convolveField(field, kernel)
}

/** 横向 / 纵向差分：两张带符号的响应图 */
export function gradientFields(gray: ScalarField, opId: string): { gx: ScalarField, gy: ScalarField } {
  const op = operatorById(opId)
  return { gx: convolveField(gray, op.gx), gy: convolveField(gray, op.gy) }
}

/**
 * 合成梯度强度 |∇| = √(Gx² + Gy²)。
 * 为什么要合成：Gx 只看得见竖边、Gy 只看得见横边，
 * 合成之后「不管哪个方向的边」都在同一张图上亮起来 —— 这才是我们想要的边缘图。
 */
export function magnitudeField(gx: ScalarField, gy: ScalarField): ScalarField {
  const n = Math.min(gx.data.length, gy.data.length)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = gx.data[i] ?? 0
    const b = gy.data[i] ?? 0
    out[i] = Math.hypot(a, b)
  }
  return { width: gx.width, height: gx.height, data: out }
}

/** 按本图峰值归一到 0~1：阈值才有统一的含义（1 = 本图最陡处） */
export function normalizeField(field: ScalarField): ScalarField {
  const max = statsOf(field).maxAbs || 1
  const out = new Float32Array(field.data.length)
  for (let i = 0; i < field.data.length; i++) out[i] = Math.abs(field.data[i] ?? 0) / max
  return { width: field.width, height: field.height, data: out }
}

/** 全图响应最强的那一点：默认就拿它当「指着一条边」的示例点 */
export function strongestPixel(field: ScalarField): { x: number, y: number, value: number } {
  let best = 0
  let idx = 0
  for (let i = 0; i < field.data.length; i++) {
    const v = Math.abs(field.data[i] ?? 0)
    if (v > best) {
      best = v
      idx = i
    }
  }
  return { x: idx % (field.width || 1), y: Math.floor(idx / (field.width || 1)), value: best }
}

/** 读某个像素的横向 / 纵向变化与强度、方向（用于「指一个像素看好坏」的读数卡） */
export function gradientAt(gx: ScalarField, gy: ScalarField, x: number, y: number): { gx: number, gy: number, magnitude: number, angle: number } {
  const cx = Math.min(gx.width - 1, Math.max(0, Math.round(x)))
  const cy = Math.min(gx.height - 1, Math.max(0, Math.round(y)))
  const i = cy * gx.width + cx
  const a = gx.data[i] ?? 0
  const b = gy.data[i] ?? 0
  return { gx: a, gy: b, magnitude: Math.hypot(a, b), angle: (Math.atan2(b, a) * 180) / Math.PI }
}

/**
 * 阈值：强度 ≥ t 的像素才算「一条边」。
 * t 是归一化后的比例（0~1），所以换图之后这个参数的含义不变。
 */
export function thresholdMask(field: ScalarField, t: number): { mask: Uint8Array, count: number } {
  const max = statsOf(field).maxAbs || 1
  const cut = Math.max(0, Math.min(1, t)) * max
  const mask = new Uint8Array(field.data.length)
  let count = 0
  for (let i = 0; i < field.data.length; i++) {
    if (Math.abs(field.data[i] ?? 0) >= cut) {
      mask[i] = 1
      count++
    }
  }
  return { mask, count }
}

/** 边缘像素占比：阈值越高，剩下的边缘越少 —— 这个数字就是最好的证据 */
export function edgeRatio(field: ScalarField, t: number): number {
  const total = field.data.length || 1
  return thresholdMask(field, t).count / total
}

/** 二值边缘图：白线（边缘）压在黑底上，就是教学图第 3 步那张 */
export function maskToImageData(field: ScalarField, t: number): ImageData {
  const { width, height } = field
  const { mask } = thresholdMask(field, t)
  const img = new ImageData(width, height)
  const px = img.data
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const v = mask[i] ? 255 : 0
    px[p] = v
    px[p + 1] = v
    px[p + 2] = v
    px[p + 3] = 255
  }
  return img
}

/**
 * 教学图第 4 步：把边缘**叠回原图**。
 *
 *  - `overlay`：非边缘压暗成背景（保留一点点原图，能看出是什么物体），
 *    边缘按强度点亮成暖色 —— 一眼就能看出「AI 现在只盯着这些轮廓」。
 *  - `shape`  ：只留形状，非边缘全黑 —— 说明「丢掉细节之后，形状反而更清楚了」。
 *
 * 两种模式都只用到边缘强度，不改动原图本身，方便来回切换对比。
 */
export function overlayImageData(
  src: ImageData,
  magnitude: ScalarField,
  t: number,
  opts: { mode?: 'overlay' | 'shape' } = {}
): ImageData {
  const mode = opts.mode ?? 'overlay'
  const width = Math.min(src.width, magnitude.width)
  const height = Math.min(src.height, magnitude.height)
  const img = new ImageData(width, height)
  const out = img.data
  const s = src.data
  const max = statsOf(magnitude).maxAbs || 1
  const cut = Math.max(0, Math.min(1, t)) * max
  const band = Math.max(1e-6, max - cut)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const p = i * 4
      const m = Math.abs(magnitude.data[i] ?? 0)
      if (m >= cut) {
        // 边缘：暖色，越陡越亮（从琥珀到近白）
        const k = 0.5 + 0.5 * Math.min(1, (m - cut) / band)
        out[p] = 255
        out[p + 1] = Math.round(140 + 100 * k)
        out[p + 2] = Math.round(20 + 140 * k)
      } else if (mode === 'shape') {
        out[p] = 0
        out[p + 1] = 0
        out[p + 2] = 0
      } else {
        // 非边缘：压暗成背景（保留结构轮廓，看得出是什么物体）
        out[p] = Math.round((s[p] ?? 0) * 0.18)
        out[p + 1] = Math.round((s[p + 1] ?? 0) * 0.18)
        out[p + 2] = Math.round((s[p + 2] ?? 0) * 0.24)
      }
      out[p + 3] = 255
    }
  }
  return img
}

/**
 * 取某点周围 size × size 的亮度数字（0~255 整数），越界复制边缘。
 * 这张数字表就是教学图第 2 步 —— 让学生直接看见「相邻像素差了多少」。
 */
export function neighborhood(field: ScalarField, x: number, y: number, size = 5): number[][] {
  const s = Math.max(1, Math.round(size))
  const half = Math.floor(s / 2)
  const rows: number[][] = []
  for (let dy = 0; dy < s; dy++) {
    const row: number[] = []
    const sy = Math.min(field.height - 1, Math.max(0, y + dy - half))
    for (let dx = 0; dx < s; dx++) {
      const sx = Math.min(field.width - 1, Math.max(0, x + dx - half))
      row.push(Math.round(field.data[sy * field.width + sx] ?? 0))
    }
    rows.push(row)
  }
  return rows
}
