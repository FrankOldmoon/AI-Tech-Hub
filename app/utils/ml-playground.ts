/**
 * 神经网络游乐场算法库（纯 TS，无外部依赖）：
 * - 2D 分类数据生成（circle / xor / gaussian / spiral）
 * - 手写小型多层感知机（BP 反向传播，二分类 sigmoid + BCE）
 */

export type Activation = 'tanh' | 'relu' | 'sigmoid'
export type DatasetKind = 'circle' | 'xor' | 'gaussian' | 'spiral'

export interface TrainSample {
  x: number[]  // [x, y]
  y: number    // 0 | 1
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: () => number): number {
  // Box-Muller
  const u = Math.max(rng(), 1e-9)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function generateData(kind: DatasetKind, n = 240, noise = 0.1, seed = 42): TrainSample[] {
  const rng = mulberry32(seed)
  const samples: TrainSample[] = []
  for (let i = 0; i < n; i++) {
    let x: number
    let y: number
    let label: number
    if (kind === 'circle') {
      const angle = rng() * Math.PI * 2
      const radius = rng() < 0.5 ? 1 + rng() * 1.5 : 3.5 + rng() * 1.5
      x = Math.cos(angle) * radius + gaussian(rng) * noise
      y = Math.sin(angle) * radius + gaussian(rng) * noise
      label = radius < 2.5 ? 1 : 0
    } else if (kind === 'xor') {
      const qx = rng() < 0.5 ? -1 : 1
      const qy = rng() < 0.5 ? -1 : 1
      x = qx * (1 + Math.abs(gaussian(rng)) * 0.8) + gaussian(rng) * noise * 2
      y = qy * (1 + Math.abs(gaussian(rng)) * 0.8) + gaussian(rng) * noise * 2
      label = (qx * qy < 0) ? 1 : 0
    } else if (kind === 'gaussian') {
      const cx = rng() < 0.5 ? -2 : 2
      x = cx + gaussian(rng) * 1.2
      y = gaussian(rng) * 1.2
      label = cx < 0 ? 1 : 0
    } else {
      // spiral
      const t = i / n
      const angle = t * Math.PI * 4
      const radius = 1 + t * 4
      const side = i % 2 === 0 ? 1 : -1
      x = Math.cos(angle) * radius * side * 0.9 + gaussian(rng) * noise * 1.5
      y = Math.sin(angle) * radius * side * 0.9 + gaussian(rng) * noise * 1.5
      label = i % 2 === 0 ? 1 : 0
    }
    samples.push({ x: [x, y], y: label })
  }
  return samples
}

function act(z: number, kind: Activation): number {
  if (kind === 'relu') return Math.max(0, z)
  if (kind === 'sigmoid') return 1 / (1 + Math.exp(-z))
  return Math.tanh(z)
}

function actDeriv(a: number, kind: Activation): number {
  if (kind === 'relu') return a > 0 ? 1 : 0
  if (kind === 'sigmoid') return a * (1 - a)
  return 1 - a * a
}

export class MLP {
  private sizes: number[]
  private W: number[][][] = []
  private b: number[][] = []
  private actKind: Activation

  constructor(inputSize: number, hidden: number[], activation: Activation) {
    this.actKind = activation
    this.sizes = [inputSize, ...hidden, 1]
    this.init()
  }

  private init() {
    this.W = []
    this.b = []
    for (let l = 1; l < this.sizes.length; l++) {
      const fanIn = this.sizes[l - 1]
      const Wl: number[][] = []
      const bl: number[] = []
      for (let j = 0; j < this.sizes[l]; j++) {
        const row: number[] = []
        for (let i = 0; i < fanIn; i++) {
          row.push((Math.random() * 2 - 1) * Math.sqrt(2 / fanIn))
        }
        Wl.push(row)
        bl.push(0)
      }
      this.W.push(Wl)
      this.b.push(bl)
    }
  }

  /** 二分类输出概率（sigmoid） */
  predict(x: number[]): number {
    let a = x
    for (let l = 0; l < this.W.length; l++) {
      const z: number[] = []
      for (let j = 0; j < this.W[l].length; j++) {
        let s = this.b[l][j]
        const row = this.W[l][j]
        for (let i = 0; i < a.length; i++) s += row[i] * a[i]
        z.push(s)
      }
      a = l === this.W.length - 1 ? z.map(v => act(v, 'sigmoid')) : z.map(v => act(v, this.actKind))
    }
    return a[0]
  }

  /** 单样本训练步，返回 BCE 损失 */
  trainStep(x: number[], y: number, lr: number): number {
    const acts: number[][] = [x]
    const zs: number[][] = []
    let a = x
    for (let l = 0; l < this.W.length; l++) {
      const z: number[] = []
      for (let j = 0; j < this.W[l].length; j++) {
        let s = this.b[l][j]
        const row = this.W[l][j]
        for (let i = 0; i < a.length; i++) s += row[i] * a[i]
        z.push(s)
      }
      zs.push(z)
      a = l === this.W.length - 1 ? z.map(v => act(v, 'sigmoid')) : z.map(v => act(v, this.actKind))
      acts.push(a)
    }
    const out = a[0]
    const eps = 1e-8
    const loss = -(y * Math.log(out + eps) + (1 - y) * Math.log(1 - out + eps))
    // 输出层 delta = p - y
    let delta: number[] = [out - y]
    for (let l = this.W.length - 1; l >= 0; l--) {
      const prevAct = acts[l]
      const nextDelta = delta
      const layerSize = this.W[l].length
      const newDelta: number[] = []
      for (let j = 0; j < layerSize; j++) {
        const isLast = l === this.W.length - 1
        let d = 0
        if (isLast) {
          d = nextDelta[0]
        } else {
          for (let k = 0; k < nextDelta.length; k++) {
            d += nextDelta[k] * this.W[l + 1][k][j]
          }
          d *= actDeriv(acts[l + 1][j], this.actKind)
        }
        const row = this.W[l][j]
        for (let i = 0; i < prevAct.length; i++) {
          row[i] -= lr * d * prevAct[i]
        }
        this.b[l][j] -= lr * d
        newDelta.push(d)
      }
      delta = newDelta
    }
    return loss
  }

  reset() {
    this.init()
  }

  /** 展平全部权重（用于神经进化遗传操作） */
  getWeights(): number[] {
    const out: number[] = []
    for (const layer of this.W) {
      for (const row of layer) out.push(...row)
    }
    for (const layer of this.b) out.push(...layer)
    return out
  }

  setWeights(w: number[]): void {
    let idx = 0
    for (const layer of this.W) {
      for (const row of layer) {
        for (let i = 0; i < row.length; i++) row[i] = w[idx++] ?? 0
      }
    }
    for (const layer of this.b) {
      for (let j = 0; j < layer.length; j++) layer[j] = w[idx++] ?? 0
    }
  }

  clone(): MLP {
    const m = new MLP(this.sizes[0], this.sizes.slice(1, -1), this.actKind)
    m.setWeights(this.getWeights())
    return m
  }

  /** 以概率 rate 扰动权重（幅度 amount） */
  mutate(rate: number, amount: number): void {
    const w = this.getWeights()
    for (let i = 0; i < w.length; i++) {
      if (Math.random() < rate) w[i] += (Math.random() * 2 - 1) * amount
    }
    this.setWeights(w)
  }
}
