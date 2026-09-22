/**
 * 「特征提取入门」教学页的执行层。
 *
 * 这一页只讲一件事：AI 不是直接拿像素做判断，而是先让一组**卷积核**在图上滑一遍，
 * 每个核只对一种结构「有反应」——有反应的地方就是特征，把响应值排成一张图就是**特征图**。
 * 所以这里只需要四件工具，全部是纯运算（不碰 canvas / DOM，可在 Node 里跑测试）：
 *
 * 1. `toGrayFloat`      彩色图 → 单通道浮点（卷积对单通道做，省 3 倍计算）
 * 2. `convolveField`    核滑窗 → **带符号**响应（负响应不能丢，它表示明暗反转的方向）
 * 3. `reluField` / `absField` / `poolField` / `statsOf`  特征图的后处理
 *    （激活、取模、池化、响应强度统计 —— 就是 CNN 里那几个名词）
 * 4. `fieldToImageData` 响应值 → 灰度图或伪彩热力图（教学图里那张蓝→黄的热度图）
 *
 * 为什么不复用 image-algorithms 的 `convolve`：它输出的是 8 位图（clamp 到 0-255），
 * 负响应会被截成 0 —— 而负响应正好携带「边缘往哪边亮」的信息，是特征的一半。
 * 特征提取要的是原始响应值，所以这里另写一个浮点版；后处理也统一在浮点上做，
 * 最后一步才落到 8 位图交给 canvas 显示。
 */

/** 页面内的双语文案（与 image-pipeline 一致：教学文案跟着页面走，不进 i18n 词表） */
export interface Localized {
  zh: string
  en: string
}

/** 一张单通道浮点图：卷积的输入与输出都是它 */
export interface ScalarField {
  width: number
  height: number
  /** 长度 = width × height 的响应值（可为负） */
  data: Float32Array
}

/** 一个教学用的卷积核 */
export interface FeatureKernel {
  id: string
  name: Localized
  /** 3 × 3 权重，行优先 */
  matrix: number[][]
  /** 这个核「对什么有反应」—— 页面上的讲解文案 */
  responds: Localized
  /** 是不是反例（对任何结构都没反应，用来对比「不是所有核都在提特征」） */
  counterExample?: boolean
}

/**
 * 六个教学用核，顺序即讲解顺序：
 * 先三个方向的边缘（同一张图、不同方向的核 → 看到不同的结构），
 * 再斑点（全向边缘，角点/纹理靠它），再「原图 + 边缘」的锐化（说明核的权重和决定了输出性质），
 * 最后一个平滑核当反例（它不提任何特征，只是把图糊了）。
 *
 * 与卷积无关的知识点也藏在核里：权重之和 = 0 的核只看「变化」（纯边缘，整体亮度消失）；
 * 之和 = 1 的核保留亮度（锐化）；平滑核的对角线没有权重，所以它响应的是局部平均亮度。
 */
export const FEATURE_KERNELS: FeatureKernel[] = [
  {
    id: 'edge-v',
    name: { zh: '竖直边缘', en: 'Vertical edge' },
    matrix: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
    responds: {
      zh: '只看左右方向的明暗变化：桌子边缘、栏杆、柱子的轮廓会整条亮起来，天空和平地一片黑。',
      en: 'Looks only at left–right brightness changes: table edges, railings and pillars light up along their whole length, while sky and flat ground stay black.'
    }
  },
  {
    id: 'edge-h',
    name: { zh: '水平边缘', en: 'Horizontal edge' },
    matrix: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
    responds: {
      zh: '同一个核转 90°，反应的东西就完全换了：地平线、眉毛、书页的横线亮起来，竖栏杆消失。',
      en: 'Rotate the same kernel 90° and it reacts to something else entirely: horizon, eyebrows and text lines light up while vertical rails vanish.'
    }
  },
  {
    id: 'edge-d',
    name: { zh: '对角边缘', en: 'Diagonal edge' },
    matrix: [[0, 1, 2], [-1, 0, 1], [-2, -1, 0]],
    responds: {
      zh: '45° 方向的轮廓：倾斜的屋檐、斜挎的带子、叶片的尖角。想覆盖所有方向，就得有多个核 —— 这正是 CNN 里通道数一堆的原因。',
      en: 'Contours at 45°: slanted roofs, straps, leaf tips. Covering every direction requires several kernels — which is exactly why a CNN stacks so many channels.'
    }
  },
  {
    id: 'spot',
    name: { zh: '斑点 / 角点', en: 'Blob / corner' },
    matrix: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]],
    responds: {
      zh: '中心与四周的差：孤立亮点（眼睛高光、鸟的眼睛、雨滴）和角点最亮，直线上的点反而不亮 —— 因为它只看「和周围都不一样」。',
      en: 'Centre versus surroundings: isolated bright spots (eye highlights, a bird’s eye, raindrops) and corners peak, while points on a straight line stay dim — it only fires where the point differs from everything around it.'
    }
  },
  {
    id: 'sharpen',
    name: { zh: '锐化 = 原图 + 边缘', en: 'Sharpen = image + edges' },
    matrix: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
    responds: {
      zh: '权重之和 = 1，所以它保住了整体亮度，只把边缘叠回原图 —— 输出还像照片，只是更「脆」。对比前四个（和为 0，输出只剩轮廓）。',
      en: 'Its weights sum to 1, so overall brightness is preserved and edges are added back: the output still looks like a photo, just crisper. Compare with the four above (sum = 0) whose output keeps only contours.'
    }
  },
  {
    id: 'blur',
    name: { zh: '平滑（反例）', en: 'Smoothing (counter-example)' },
    matrix: [[1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9]],
    responds: {
      zh: '同样在滑窗，但它对任何结构都没反应，只是把邻域平均一下：响应图糊成一团、哪里都差不多。所以「卷积」不等于「提特征」—— 只有对结构有选择性的核才算。',
      en: 'It also slides a window, yet reacts to no structure at all — it just averages the neighbourhood, so its response map is a uniform blur. Convolution is not the same as feature extraction: only kernels that are selective about structure count.'
    },
    counterExample: true
  }
]

/** 自定义核的预设（点一下就把权重填进 3×3 编辑器） */
export const KERNEL_PRESETS: Array<{ id: string, name: Localized, matrix: number[][] }> = [
  { id: 'identity', name: { zh: '恒等（什么都不改）', en: 'Identity (no change)' }, matrix: [[0, 0, 0], [0, 1, 0], [0, 0, 0]] },
  { id: 'edge-v', name: { zh: '竖直边缘', en: 'Vertical edge' }, matrix: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]] },
  { id: 'sharpen', name: { zh: '锐化', en: 'Sharpen' }, matrix: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]] },
  { id: 'blur', name: { zh: '平滑', en: 'Smoothing' }, matrix: [[1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9]] }
]

/** 3×3 编辑器的初始权重（默认给「竖直边缘」，一上手就能看出反应） */
export const CUSTOM_KERNEL_DEFAULT: number[][] = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]

/** 权重和：= 0 只输出变化（纯边缘），= 1 保留亮度（锐化） */
export function matrixSum(matrix: number[][]): number {
  let sum = 0
  for (const row of matrix) for (const v of row) sum += Number(v) || 0
  return sum
}

/** 彩色图 → 单通道浮点（亮度加权 0.299/0.587/0.114，与灰度化的 luminance 一致） */
export function toGrayFloat(src: ImageData): ScalarField {
  const { width, height, data } = src
  const out = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
  }
  return { width, height, data: out }
}

/**
 * 卷积核滑窗：out(x,y) = Σ kernel(ky,kx) × field(y+ky-cy, x+kx-cx)。
 * 不做除法和偏移 —— 保留**原始带符号响应**，负值表示结构与核的方向相反。
 * 边界默认复制边缘（edge），与工坊里的卷积一致。
 */
export function convolveField(field: ScalarField, kernel: number[][], border: 'edge' | 'zero' = 'edge'): ScalarField {
  const { width, height, data } = field
  const kh = kernel.length
  const kw = kernel[0]?.length ?? 0
  if (!kh || !kw) return { width, height, data: new Float32Array(data) }
  const cx = Math.floor(kw / 2)
  const cy = Math.floor(kh / 2)
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let ky = 0; ky < kh; ky++) {
        const sy = y + ky - cy
        if (border === 'zero' && (sy < 0 || sy >= height)) continue
        const yy = border === 'zero' ? sy : Math.min(height - 1, Math.max(0, sy))
        for (let kx = 0; kx < kw; kx++) {
          const sx = x + kx - cx
          if (border === 'zero' && (sx < 0 || sx >= width)) continue
          const xx = border === 'zero' ? sx : Math.min(width - 1, Math.max(0, sx))
          acc += (kernel[ky]?.[kx] ?? 0) * (data[yy * width + xx] ?? 0)
        }
      }
      out[y * width + x] = acc
    }
  }
  return { width, height, data: out }
}

/** 取绝对值：只关心「回应了多少」，不关心方向（梯度幅值的做法） */
export function absField(field: ScalarField): ScalarField {
  const out = new Float32Array(field.data.length)
  for (let i = 0; i < field.data.length; i++) out[i] = Math.abs(field.data[i] ?? 0)
  return { width: field.width, height: field.height, data: out }
}

/** ReLU：负响应清零（CNN 里的激活函数，作用是让特征图更稀疏、只留最确定的结构） */
export function reluField(field: ScalarField): ScalarField {
  const out = new Float32Array(field.data.length)
  for (let i = 0; i < field.data.length; i++) out[i] = Math.max(0, field.data[i] ?? 0)
  return { width: field.width, height: field.height, data: out }
}

/**
 * 最大池化：把图按 size × size 缩小，每格取窗口内**绝对值最大**的响应。
 * 教学点：池化把「特征在哪一个像素」放宽成「特征在这一片」，图变小、位置更稳
 * —— 这也是 CNN 里通道越深图越小的原因。
 */
export function poolField(field: ScalarField, size: number): ScalarField {
  const s = Math.max(1, Math.round(size))
  if (s === 1) return field
  const { width, height, data } = field
  const outW = Math.max(1, Math.ceil(width / s))
  const outH = Math.max(1, Math.ceil(height / s))
  const out = new Float32Array(outW * outH)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let best = 0
      for (let dy = 0; dy < s; dy++) {
        const sy = y * s + dy
        if (sy >= height) break
        for (let dx = 0; dx < s; dx++) {
          const sx = x * s + dx
          if (sx >= width) break
          const v = Math.abs(data[sy * width + sx] ?? 0)
          if (v > best) best = v
        }
      }
      out[y * outW + x] = best
    }
  }
  return { width: outW, height: outH, data: out }
}

export interface ResponseStats {
  /** 最强响应 */
  maxAbs: number
  /** 平均响应强度 */
  meanAbs: number
  /**
   * 响应集中度（0~1）：1 - 平均 / 峰值。
   * 边缘核只在轮廓上响应，平均远小于峰值 → 集中度高（结构被挑出来了）；
   * 平滑核处处都在响应，平均接近峰值 → 集中度低（它只是把图糊了）。
   */
  focus: number
}

export function statsOf(field: ScalarField): ResponseStats {
  let maxAbs = 0
  let sum = 0
  const n = field.data.length || 1
  for (let i = 0; i < field.data.length; i++) {
    const v = Math.abs(field.data[i] ?? 0)
    if (v > maxAbs) maxAbs = v
    sum += v
  }
  const meanAbs = sum / n
  const focus = maxAbs > 1e-6 ? Math.max(0, Math.min(1, 1 - meanAbs / maxAbs)) : 0
  return { maxAbs, meanAbs, focus }
}

/** 热力图色带：蓝 → 青 → 黄绿 → 黄 → 红（教学图里那张特征图用的就是这套） */
const HEAT_STOPS: Array<[number, [number, number, number]]> = [
  [0, [8, 8, 96]],
  [0.2, [0, 150, 255]],
  [0.4, [0, 246, 190]],
  [0.6, [176, 255, 0]],
  [0.8, [255, 186, 0]],
  [1, [255, 40, 30]]
]

function heatColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i] as [number, [number, number, number]]
    const [p0, c0] = HEAT_STOPS[i - 1] as [number, [number, number, number]]
    if (x <= p1) {
      const k = (x - p0) / (p1 - p0 || 1)
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k
      ]
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1]?.[1] ?? [255, 255, 255]
}

/**
 * 响应值 → 可显示的 8 位图。
 *
 * 默认按这张图自己的峰值归一化（把最强响应当成满格），所以每张特征图的对比度都是满的 ——
 * 这正是教学需要：学生看的是「响应分布在哪」，而不是不同核之间的绝对值差异。
 */
export function fieldToImageData(field: ScalarField, opts: { colorize?: boolean } = {}): ImageData {
  const { width, height, data } = field
  const max = statsOf(field).maxAbs || 1
  const img = new ImageData(width, height)
  const px = img.data
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const t = Math.min(1, Math.abs(data[i] ?? 0) / max)
    if (opts.colorize) {
      const [r, g, b] = heatColor(t)
      px[p] = r
      px[p + 1] = g
      px[p + 2] = b
    } else {
      const v = t * 255
      px[p] = v
      px[p + 1] = v
      px[p + 2] = v
    }
    px[p + 3] = 255
  }
  return img
}
