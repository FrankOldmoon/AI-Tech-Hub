/**
 * 「图像分类入门」教学页的执行层。
 *
 * 教学图讲五步：输入图像 → 特征提取 → 学习与模式 → 分类 → 输出。
 * 前两步在 pipeline / feature-extraction / edge-detection 三页已经拆开讲过，
 * 这页真正要补上的是**后三步**：
 *
 *   3 学习与模式   给每一类若干带噪声、位置/大小/角度都不同的例子，
 *                 把它们对齐、归一化后**平均**成一张「原型」—— 这就是最简单的「学习」：
 *                 学习的结果不是一串神秘参数，而是一张能看见的模板。
 *   4 分类         把输入也变成同一个描述子，与每个原型比「像不像」（余弦距离），
 *                 再用 softmax 变成百分比 —— 95% / 3% / 1% / 1% 是这么来的。
 *   5 输出         取分数最高的那个当答案。分高不等于对，所以页面还要把「前二名差距」摆出来。
 *
 * 为什么用形状而不是猫狗照片：只有四类形状时，学生能**自己画出输入**、能肉眼看懂原型、
 * 也能自己心算「像不像」。分类器一旦变成黑箱，这五步就讲不下去了。
 * （真实照片交给站内的「图像分类（能力对比）」页，那里跑真正的预训练模型。）
 *
 * 全部是纯运算，不碰 canvas / DOM，可在 Node 里跑测试。
 */
import type { ScalarField } from '~/utils/feature-extraction'
import { fieldToImageData } from '~/utils/feature-extraction'

/** 页面内的双语文案（教学文案跟着页面走，不进 i18n 词表，与同组教学页一致） */
export interface Localized {
  zh: string
  en: string
}

/** 工作尺寸：所有输入（内置样本 / 手绘 / 上传图）最后都落到这个边长的方形灰度图上 */
export const WORK_SIZE = 64

/** 描述子边长：64 → 16，于是每张图变成 256 个数字 —— 就是 CNN 里「一层特征向量」的迷你版 */
export const GRID = 16
export const DESCRIPTOR_LEN = GRID * GRID

/** 原型里「形状的散开程度」占多少个格子：固定它 = 把大小归一化 */
const SPREAD_CELLS = 4.2

// ===== 类别与形状 =====

export interface ShapeClass {
  id: string
  name: Localized
  icon: string
}

/** 四类形状：视觉差异足够大（环 / 方框 / 三角 / 十字），学生也能手画 */
export const SHAPE_CLASSES: ShapeClass[] = [
  { id: 'circle', name: { zh: '圆形', en: 'Circle' }, icon: 'i-lucide-circle' },
  { id: 'square', name: { zh: '正方形', en: 'Square' }, icon: 'i-lucide-square' },
  { id: 'triangle', name: { zh: '三角形', en: 'Triangle' }, icon: 'i-lucide-triangle' },
  { id: 'cross', name: { zh: '十字形', en: 'Cross' }, icon: 'i-lucide-plus' }
]

export interface ShapeOptions {
  /** 平移（归一化单位，±1 = 图的一半） */
  dx?: number
  dy?: number
  /** 缩放：1 = 标准大小 */
  scale?: number
  /** 旋转（弧度） */
  rotation?: number
  /** 噪声强度：0~1，乘 255 后加到像素上 */
  noise?: number
  seed?: number
}

/** 线性同余伪随机：同一个种子永远给出同一批「样子」，测试与验收脚本才能对得上 */
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * 四个形状的「带符号距离」：< 0 在形状内部，> 0 在外部（单位是归一化半径，1 = 图的一半）。
 * 凸形状（圆/方/三角）用「最违例的那个半平面」；十字是两块矩形的并集，取两者距离的最小值。
 */
function shapeDistance(id: string, u: number, v: number): number {
  switch (id) {
    case 'circle':
      return Math.hypot(u, v) - 0.62
    case 'square':
      return Math.max(Math.abs(u), Math.abs(v)) - 0.52
    case 'triangle': {
      // 顶点朝上：A(0,-0.5) B(-0.62,0.5) C(0.62,0.5)；三个半平面取最违例的那个
      const bottom = (v - 0.5) / 1
      const left = -(u + 0.62 * v + 0.31) / 1.1766
      const right = -(-u + 0.62 * v + 0.31) / 1.1766
      return Math.max(bottom, left, right)
    }
    case 'cross': {
      const hv = Math.max(Math.abs(u) - 0.62, Math.abs(v) - 0.2)
      const vv = Math.max(Math.abs(v) - 0.62, Math.abs(u) - 0.2)
      return Math.min(hv, vv)
    }
    default:
      return 1
  }
}

/**
 * 把一类形状画成 size×size 的灰度图（0~255）。
 * 边缘用 smoothstep 做一点抗锯齿 —— 不然 64×64 上会出现硬台阶，描述子全是锯齿噪声。
 * 逆变换顺序：先平移回来、再按 scale 放大、再旋转回去，于是 dx/dy/scale/rotation 描述「形状画成什么样」。
 */
export function renderShape(classId: string, opts: ShapeOptions = {}, size = WORK_SIZE): ScalarField {
  const dx = opts.dx ?? 0
  const dy = opts.dy ?? 0
  const scale = opts.scale ?? 1
  const rot = opts.rotation ?? 0
  const noise = opts.noise ?? 0
  const rng = makeRng(opts.seed ?? 1)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const data = new Float32Array(size * size)
  const px = 2 / size // 一个像素在归一化坐标里的边长
  const aa = px * 1.2 // 抗锯齿带宽：略大于一个像素
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let u = ((x + 0.5) / size) * 2 - 1
      let v = ((y + 0.5) / size) * 2 - 1
      u = (u - dx) / scale
      v = (v - dy) / scale
      const ru = u * cos + v * sin
      const rv = -u * sin + v * cos
      const d = shapeDistance(classId, ru, rv)
      const coverage = Math.max(0, Math.min(1, 0.5 - d / aa))
      data[y * size + x] = coverage * 255
    }
  }
  if (noise > 0) {
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + (rng() * 2 - 1) * noise * 255))
    }
  }
  return { width: size, height: size, data }
}

/** 造一个「待分类的输入」：同类形状 + 可调的变化强度（位置/大小/角度/噪声一起变） */
export interface SampleOptions {
  /** 变化强度 0~1：0 = 干干净净的样本，1 = 位置/大小/角度/噪声都很大 */
  difficulty?: number
  seed?: number
}
export function shapeSample(classId: string, opts: SampleOptions = {}) {
  const difficulty = Math.max(0, Math.min(1, opts.difficulty ?? 0.45))
  const rng = makeRng(opts.seed ?? 1)
  const d = difficulty
  const options: Required<Omit<ShapeOptions, 'seed'>> & { seed: number } = {
    dx: (rng() * 2 - 1) * 0.3 * d,
    dy: (rng() * 2 - 1) * 0.3 * d,
    scale: 1 + (rng() * 2 - 1) * 0.35 * d,
    rotation: (rng() * 2 - 1) * 0.5 * d,
    noise: 0.28 * d,
    seed: Math.floor(rng() * 1e9) + 1
  }
  return { options, field: renderShape(classId, options) }
}

// ===== 几何与重采样 =====

/** 双线性采样：越界的坐标按边缘复制（和卷积的 border 策略一致） */
function sampleBilinear(field: ScalarField, x: number, y: number): number {
  const { width, height, data } = field
  const cx = Math.min(width - 1, Math.max(0, x))
  const cy = Math.min(height - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const a = data[y0 * width + x0] ?? 0
  const b = data[y0 * width + x1] ?? 0
  const c = data[y1 * width + x0] ?? 0
  const dd = data[y1 * width + x1] ?? 0
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + dd * fx * fy
}

/** 亮度重心：形状画在哪儿都无所谓，先把它挪到正中 */
export function centroidOf(field: ScalarField): { x: number, y: number, mass: number } {
  const { width, height, data } = field
  let sum = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = data[y * width + x] ?? 0
      if (w <= 0) continue
      sum += w
      sx += w * x
      sy += w * y
    }
  }
  if (sum <= 1e-6) return { x: width / 2, y: height / 2, mass: 0 }
  return { x: sx / sum, y: sy / sum, mass: sum }
}

/** 亮度散开程度（到重心的均方距离开根，单位：像素）—— 用它把「画得大 / 画得小」抹平 */
export function spreadOf(field: ScalarField, centroid = centroidOf(field)): number {
  const { width, height, data } = field
  let sum = 0
  let acc = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = data[y * width + x] ?? 0
      if (w <= 0) continue
      const ddx = x - centroid.x
      const ddy = y - centroid.y
      sum += w
      acc += w * (ddx * ddx + ddy * ddy)
    }
  }
  if (sum <= 1e-6) return 0
  return Math.sqrt(acc / sum)
}

/** 把任意尺寸的灰度图重采样成 size×size（分类器的输入尺寸是固定的） */
export function resizeField(field: ScalarField, size = WORK_SIZE): ScalarField {
  const out = new Float32Array(size * size)
  const sx = field.width / size
  const sy = field.height / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = sampleBilinear(field, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5)
    }
  }
  return { width: size, height: size, data: out }
}

// ===== 特征提取：缩略图 + 描述子 =====

export interface DescriptorOptions {
  grid?: number
  /** 把亮度重心挪到正中（位置归一化） */
  align?: boolean
  /** 把散开程度缩放成固定值（大小归一化） */
  normalizeScale?: boolean
  /**
   * 把缩略图再变成「边缘图」再提描述子。
   * 不取边缘时，四类形状共享一大块「中间实心」，区分度被稀释；
   * 取边缘后，圆是环、十字是加号、三角是三角框 —— 轮廓才是真·有判别力的特征。
   * （这也正好接上上一页「边缘检测」：特征提取抽的其实就是轮廓。）
   */
  edge?: boolean
}

/** 一张缩略图 → 边缘图（简单邻域差分取幅值，边界复制）；轮廓才是区分不同形状的关键 */
function edgeMap(values: Float32Array, grid: number): Float32Array {
  const out = new Float32Array(grid * grid)
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const xm = x > 0 ? values[y * grid + (x - 1)]! : values[y * grid + x]!
      const xp = x < grid - 1 ? values[y * grid + (x + 1)]! : values[y * grid + x]!
      const ym = y > 0 ? values[(y - 1) * grid + x]! : values[y * grid + x]!
      const yp = y < grid - 1 ? values[(y + 1) * grid + x]! : values[y * grid + x]!
      const gx = xp - xm
      const gy = yp - ym
      out[y * grid + x] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return out
}

/**
 * 特征提取：把 64×64 的图缩成 grid×grid 的小图。
 *
 * 缩之前先做两件「预处理」——它们才是分类器能跨位置、跨大小工作的关键：
 *   align          亮度重心移到正中        → 画在左上角还是右下角，结果一样
 *   normalizeScale 散开程度缩到固定值      → 画得大还是小，结果一样
 * 不归一化的话，原型会被「位置和大小」冲淡，分类全靠运气。
 */
export function thumbnailOf(field: ScalarField, opts: DescriptorOptions = {}): { values: Float32Array, grid: number } {
  const grid = Math.max(2, Math.round(opts.grid ?? GRID))
  const align = opts.align ?? true
  const normalizeScale = opts.normalizeScale ?? true
  const c = centroidOf(field)
  const spread = spreadOf(field, c)
  const pixelPerCell = (normalizeScale && spread > 1e-6)
    ? spread / SPREAD_CELLS
    : field.width / grid
  const values = new Float32Array(grid * grid)
  const SUB = 2 // 每格取 2×2 个采样点平均，减少混叠
  const ox = align ? c.x : field.width / 2
  const oy = align ? c.y : field.height / 2
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let acc = 0
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const fu = gx + (sx + 0.5) / SUB
          const fv = gy + (sy + 0.5) / SUB
          const px = ox + (fu - grid / 2) * pixelPerCell
          const py = oy + (fv - grid / 2) * pixelPerCell
          acc += sampleBilinear(field, px, py)
        }
      }
      values[gy * grid + gx] = acc / (SUB * SUB)
    }
  }
  return { values, grid }
}

/** 去均值 + 单位化；全零向量原样返回（避免 NaN） */
export function normalizeValues(values: Float32Array): Float32Array {
  const n = values.length
  const out = new Float32Array(n)
  if (!n) return out
  let mean = 0
  for (let i = 0; i < n; i++) mean += values[i] ?? 0
  mean /= n
  let sq = 0
  for (let i = 0; i < n; i++) {
    const v = (values[i] ?? 0) - mean
    out[i] = v
    sq += v * v
  }
  const norm = Math.sqrt(sq)
  if (norm > 1e-9) for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) / norm
  return out
}

/**
 * 描述子：把缩略图拉平成向量，再做**去均值 + 单位化**（zero-mean, unit-norm）。
 *
 * 去掉均值 = 亮度基线无关（灯亮一点暗一点不影响）；
 * 单位化   = 对比度无关（图整体更白或更黑不影响）。
 * 于是剩下的只有「形状本身」—— 余弦相似度也才有意义。
 *
 * 取边缘（edge）时，先把缩略图变成边缘图：四类形状的差异集中在轮廓上，
 * 提取轮廓后区分度远高于直接比对「中间实心」那块共享成分。
 */
export function descriptorOf(field: ScalarField, opts: DescriptorOptions = {}): Float32Array {
  const { values } = thumbnailOf(field, opts)
  const base = opts.edge ? edgeMap(values, opts.grid ?? GRID) : values
  return normalizeValues(base)
}

/** 余弦相似度：1 = 完全同向，0 = 无关，-1 = 完全相反。内部除以模长，所以即便传入未单位化的向量也算对（描述子本身是单位向量，这里只是更稳健）。 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 1e-9 ? dot / denom : 0
}

/** 「不像」的程度：1 − 余弦。0 = 一模一样 */
export function distanceTo(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b)
}

// ===== 学习：原型（最近类均值） =====

export interface TrainingExample {
  classId: string
  index: number
  options: { dx: number, dy: number, scale: number, rotation: number, seed: number }
  field: ScalarField
  descriptor: Float32Array
}

export interface Prototype {
  classId: string
  name: Localized
  icon: string
  /** 平均出来的原型描述子（单位向量） */
  descriptor: Float32Array
  /** 原型缩略图 —— 学习的结果，可以直视 */
  thumbnail: Float32Array
  grid: number
  /** 这一类用了几个例子 */
  count: number
}

/**
 * 训练时给例子加的变化：位置、大小、噪声都变一变，原型才不会「只会认一模一样的那张」。
 * 注意故意**不加旋转**——本页的对齐只做平移 + 缩放归一化，分类器本身并不旋转不变，
 * 加了旋转只会把三角形这种非 4 重对称的形状「平均成一团糊」，反而分不清。
 */
export const TRAIN_JITTER = { translation: 0.12, scale: 0.13, rotation: 0, noise: 0.08 }

export interface TrainOptions {
  perClass?: number
  seed?: number
  grid?: number
  jitter?: typeof TRAIN_JITTER
  edge?: boolean
}

/**
 * 「学习」：给每一类造 perClass 个带变化的例子，把它们对齐归一化后**平均**成一张原型。
 *
 * 这是最简单的一种学习（最近类均值 / nearest class mean）。它和真实 CNN 的差别在
 * 特征是自己定的、类别是给好的；但「用一堆例子求出一个代表」这件事是一模一样的，
 * 而且这一版的「学习结果」能直接画出来看。
 */
export function trainPrototypes(classes: ShapeClass[] = SHAPE_CLASSES, opts: TrainOptions = {}) {
  const perClass = Math.max(1, Math.round(opts.perClass ?? 6))
  const seed = opts.seed ?? 20260922
  const jitter = opts.jitter ?? TRAIN_JITTER
  const rng = makeRng(seed)
  const examples: Record<string, TrainingExample[]> = {}
  const prototypes: Prototype[] = []
  for (const cls of classes) {
    const list: TrainingExample[] = []
    for (let i = 0; i < perClass; i++) {
      const options = {
        dx: (rng() * 2 - 1) * jitter.translation,
        dy: (rng() * 2 - 1) * jitter.translation,
        scale: 1 + (rng() * 2 - 1) * jitter.scale,
        rotation: (rng() * 2 - 1) * jitter.rotation,
        seed: Math.floor(rng() * 1e9) + 1
      }
      const field = renderShape(cls.id, { ...options, noise: jitter.noise })
      list.push({ classId: cls.id, index: i, options, field, descriptor: descriptorOf(field, { grid: opts.grid, edge: opts.edge }) })
    }
    examples[cls.id] = list
    prototypes.push(buildPrototype(cls, list, opts.grid))
  }
  return { examples, prototypes, perClass }
}

/** 把一类的例子平均成原型：描述子逐维取平均后再单位化；缩略图同理（直接展示「学习的产物」） */
export function buildPrototype(cls: ShapeClass, list: TrainingExample[], grid?: number): Prototype {
  const g = Math.max(2, Math.round(grid ?? GRID))
  const len = g * g
  const thumbSum = new Float32Array(len)
  const descSum = new Float32Array(len)
  const count = Math.max(1, list.length)
  for (const ex of list) {
    const thumb = thumbnailOf(ex.field, { grid: g }).values
    for (let i = 0; i < len; i++) thumbSum[i] = (thumbSum[i] ?? 0) + (thumb[i] ?? 0)
    for (let i = 0; i < len; i++) descSum[i] = (descSum[i] ?? 0) + (ex.descriptor[i] ?? 0)
  }
  const thumbnail = new Float32Array(len)
  const desc = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    thumbnail[i] = (thumbSum[i] ?? 0) / count
    desc[i] = (descSum[i] ?? 0) / count
  }
  return {
    classId: cls.id,
    name: cls.name,
    icon: cls.icon,
    descriptor: normalizeValues(desc),
    thumbnail,
    grid: g,
    count: list.length
  }
}

// ===== 分类：打分 =====

export interface ClassScore {
  classId: string
  name: Localized
  icon: string
  /** 余弦相似度（-1 ~ 1） */
  similarity: number
  /** 与原型「不像」的程度：1 − 相似度 */
  distance: number
  /** softmax 之后的百分比，全部加起来 = 1 */
  score: number
}

export const DEFAULT_TEMPERATURE = 0.12
export const TEMPERATURE_MIN = 0.04
export const TEMPERATURE_MAX = 0.5

/**
 * 「分类」：把输入的描述子跟每个原型比一比，再把「不像的程度」变成百分比。
 *
 * softmax 的输入取 **−距离**：越不像的 → 分数越低。温度 temperature 控制「果断程度」：
 * 温度小 → 差距被放大、第一名吃掉几乎所有概率；温度大 → 大家平分、谁都不确定。
 * 真实模型的「置信度」也是这么算出来的（只不过 logits 来自网络而不是距离）。
 */
export function scoreClasses(descriptor: Float32Array, prototypes: Prototype[], temperature = DEFAULT_TEMPERATURE): ClassScore[] {
  const t = Math.max(1e-3, temperature)
  const rows = prototypes.map((p) => {
    const similarity = cosineSimilarity(descriptor, p.descriptor)
    return { classId: p.classId, name: p.name, icon: p.icon, similarity, distance: 1 - similarity }
  })
  if (!rows.length) return []
  let maxLogit = -Infinity
  for (const r of rows) maxLogit = Math.max(maxLogit, -r.distance / t)
  let sum = 0
  const exps = rows.map((r) => {
    const e = Math.exp(-r.distance / t - maxLogit)
    sum += e
    return e
  })
  return rows
    .map((r, i) => ({ ...r, score: sum > 0 ? (exps[i] ?? 0) / sum : 1 / rows.length }))
    .sort((a, b) => b.score - a.score || a.classId.localeCompare(b.classId))
}

/**
 * 直接对一张图打分：内部先提描述子。
 * `edge` 必须和训练原型时用的一致 —— 否则输入描述子与原型描述子不同源，分数全是错的。
 */
export function classifyField(
  field: ScalarField,
  prototypes: Prototype[],
  opts: { temperature?: number, grid?: number, edge?: boolean } = {}
) {
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE
  const grid = opts.grid ?? GRID
  const descriptor = descriptorOf(field, { grid, edge: opts.edge })
  return { descriptor, thumbnail: thumbnailOf(field, { grid }), ranked: scoreClasses(descriptor, prototypes, temperature) }
}

// ===== 评估 =====

export interface EvalResult {
  total: number
  correct: number
  accuracy: number
  /** 每类的正确率，用于「哪一类最容易认错」 */
  perClass: Array<{ classId: string, correct: number, total: number, accuracy: number }>
  /** 混淆对计数（真实分类 → 被认成） */
  mistakes: Array<{ actual: string, predicted: string, count: number }>
}

/**
 * 拿一批**没参与训练**的新样本考一遍原型 —— 这就是「准确率」的定义。
 * 样本用另一个种子生成，所以是真·测试集，不是把训练题背出来的成绩。
 */
export function evaluatePrototypes(
  prototypes: Prototype[],
  classes: ShapeClass[] = SHAPE_CLASSES,
  opts: { perClass?: number, seed?: number, temperature?: number, jitter?: typeof TRAIN_JITTER, grid?: number, edge?: boolean } = {}
): EvalResult {
  const perClass = Math.max(1, Math.round(opts.perClass ?? 8))
  const seed = opts.seed ?? 987654
  const jitter = opts.jitter ?? TRAIN_JITTER
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE
  const rng = makeRng(seed)
  let total = 0
  let correct = 0
  const per = classes.map(c => ({ classId: c.id, correct: 0, total: 0, accuracy: 0 }))
  const mistakeMap = new Map<string, number>()
  for (const cls of classes) {
    for (let i = 0; i < perClass; i++) {
      const field = renderShape(cls.id, {
        dx: (rng() * 2 - 1) * jitter.translation,
        dy: (rng() * 2 - 1) * jitter.translation,
        scale: 1 + (rng() * 2 - 1) * jitter.scale,
        rotation: (rng() * 2 - 1) * jitter.rotation,
        noise: jitter.noise,
        seed: Math.floor(rng() * 1e9) + 1
      })
      const descriptor = descriptorOf(field, { grid: opts.grid, edge: opts.edge })
      const top = scoreClasses(descriptor, prototypes, temperature)[0]
      const bucket = per.find(p => p.classId === cls.id)!
      bucket.total += 1
      total += 1
      if (top?.classId === cls.id) {
        correct += 1
        bucket.correct += 1
      } else if (top) {
        const key = `${cls.id}->${top.classId}`
        mistakeMap.set(key, (mistakeMap.get(key) ?? 0) + 1)
      }
    }
  }
  for (const b of per) b.accuracy = b.total > 0 ? b.correct / b.total : 0
  const mistakes = [...mistakeMap.entries()]
    .map(([key, count]) => {
      const [actual, predicted] = key.split('->') as [string, string]
      return { actual, predicted, count }
    })
    .sort((a, b) => b.count - a.count || a.actual.localeCompare(b.actual))
  return { total, correct, accuracy: total > 0 ? correct / total : 0, perClass: per, mistakes }
}

/** 学习曲线：每类只给 1/2/4/8… 个例子时，准确率分别是多少 —— 「例子越多越准」要能被量出来 */
export function learningCurve(
  counts: number[] = [1, 2, 4, 8, 16],
  opts: { classes?: ShapeClass[], seed?: number, perClass?: number, evalSeed?: number, temperature?: number, grid?: number, edge?: boolean, evalJitter?: typeof TRAIN_JITTER } = {}
) {
  const classes = opts.classes ?? SHAPE_CLASSES
  return counts.map((count) => {
    const { prototypes } = trainPrototypes(classes, { perClass: count, seed: opts.seed ?? 20260922, grid: opts.grid, edge: opts.edge })
    const result = evaluatePrototypes(prototypes, classes, {
      perClass: opts.perClass ?? 8,
      seed: opts.evalSeed ?? 987654,
      temperature: opts.temperature,
      grid: opts.grid,
      edge: opts.edge,
      jitter: opts.evalJitter
    })
    return { count, accuracy: result.accuracy, correct: result.correct, total: result.total }
  })
}

// ===== 显示辅助 =====

/**
 * 缩略图（未归一化的灰度值）画成图：直接复用 feature-extraction 的 fieldToImageData，
 * 按本图峰值归一化。
 */
export function thumbnailImage(values: Float32Array, grid: number): ImageData {
  return fieldToImageData({ width: grid, height: grid, data: values })
}

/**
 * 描述子（256 个数字）画成图：正数偏红、负数偏蓝 —— 「特征」不再是玄学，就是这些数。
 * 直接看它比看 256 个小数直观得多，而且能看出「圆形是一圈红环、十字是一横一竖」。
 */
export function descriptorImage(values: Float32Array, grid: number): ImageData {
  const img = new ImageData(grid, grid)
  const px = img.data
  let max = 0
  for (let i = 0; i < values.length; i++) max = Math.max(max, Math.abs(values[i] ?? 0))
  max = max || 1
  const base = 248
  const red: [number, number, number] = [214, 40, 40]
  const blue: [number, number, number] = [40, 92, 214]
  for (let i = 0, p = 0; i < grid * grid; i++, p += 4) {
    const t = Math.max(-1, Math.min(1, (values[i] ?? 0) / max))
    const a = Math.abs(t)
    const c = t > 0 ? red : blue
    px[p] = Math.round(base + (c[0] - base) * a)
    px[p + 1] = Math.round(base + (c[1] - base) * a)
    px[p + 2] = Math.round(base + (c[2] - base) * a)
    px[p + 3] = 255
  }
  return img
}
