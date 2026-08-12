/**
 * 图像工坊（Image Lab）核心算法库。
 *
 * 全部为纯函数：输入 ImageData，输出 ImageData（或颜色信息）。
 * 不依赖 Nuxt 上下文，可在浏览器端直接调用；与 python/image/** 的 OpenCV 实现一一对应，
 * 便于教学对照（浏览器 Canvas 结果 ≈ Python cv2 结果）。
 */

export interface RGB {
  r: number
  g: number
  b: number
}

export type ChannelKey = 'r' | 'g' | 'b' | 'a' | 'h' | 's' | 'v' | 'l' | 'la' | 'lb'

export type PixelOp = (r: number, g: number, b: number, a: number, x: number, y: number) => [number, number, number, number]

/** 复制 ImageData（深拷贝像素缓冲） */
export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

export function newImageData(width: number, height: number): ImageData {
  return new ImageData(width, height)
}

/** 逐像素映射（r/g/b/a 输出自动取整并 clamp 到 0-255） */
export function applyPixelOp(src: ImageData, fn: PixelOp): ImageData {
  const out = cloneImageData(src)
  const d = out.data
  const { width, height } = src
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b, a] = fn(d[i], d[i + 1], d[i + 2], d[i + 3], x, y)
      d[i] = clamp(Math.round(r))
      d[i + 1] = clamp(Math.round(g))
      d[i + 2] = clamp(Math.round(b))
      d[i + 3] = clamp(Math.round(a))
    }
  }
  return out
}

export function clamp(v: number, min = 0, max = 255): number {
  return v < min ? min : v > max ? max : v
}

// ===== 色彩空间转换 =====

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (hh < 60) { r = c; g = x }
  else if (hh < 120) { r = x; g = c }
  else if (hh < 180) { g = c; b = x }
  else if (hh < 240) { g = x; b = c }
  else if (hh < 300) { r = x; b = c }
  else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  const d = max - min
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hh * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hh < 1 / 6) { r = c; g = x }
  else if (hh < 2 / 6) { r = x; g = c }
  else if (hh < 3 / 6) { g = c; b = x }
  else if (hh < 4 / 6) { g = x; b = c }
  else if (hh < 5 / 6) { r = x; b = c }
  else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** sRGB (0-255) -> CIE Lab（D65 白点），返回 [L(0-100), a, b] */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (t: number) => {
    const v = t / 255
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92
  }
  const rr = f(r)
  const gg = f(g)
  const bb = f(b)
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047
  let y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175
  let z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) / 1.08883
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  x = g2(x)
  y = g2(y)
  z = g2(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp(Math.round(v)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// ===== 基础像素处理（01-05 页共用） =====

export type GrayMethod = 'average' | 'luminance' | 'desaturate'

export function grayscale(src: ImageData, method: GrayMethod = 'luminance'): ImageData {
  return applyPixelOp(src, (r, g, b, a) => {
    let v: number
    if (method === 'luminance') v = 0.299 * r + 0.587 * g + 0.114 * b
    else if (method === 'desaturate') v = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
    else v = (r + g + b) / 3
    return [v, v, v, a]
  })
}

/** 提取指定通道，并以灰度图可视化（HSV/HSL/LAB 通道做归一化映射） */
export function channelExtract(src: ImageData, ch: ChannelKey): ImageData {
  return applyPixelOp(src, (r, g, b, a) => {
    let v = 0
    if (ch === 'r') v = r
    else if (ch === 'g') v = g
    else if (ch === 'b') v = b
    else if (ch === 'a') v = a
    else if (ch === 'h') v = (rgbToHsv(r, g, b)[0] / 360) * 255
    else if (ch === 's') v = rgbToHsv(r, g, b)[1] * 255
    else if (ch === 'v') v = rgbToHsv(r, g, b)[2] * 255
    else if (ch === 'l') v = rgbToHsl(r, g, b)[2] * 255
    else if (ch === 'la') v = clamp(rgbToLab(r, g, b)[0] * 2.55)
    else if (ch === 'lb') v = clamp(rgbToLab(r, g, b)[1] + 128)
    return [v, v, v, a]
  })
}

/** 通道重排：R/G/B 分别从指定源通道取值（channel shuffle / merge） */
export function channelMerge(src: ImageData, rSrc: ChannelKey, gSrc: ChannelKey, bSrc: ChannelKey): ImageData {
  const get = (r: number, g: number, b: number, a: number, ch: ChannelKey): number => {
    switch (ch) {
      case 'r': return r
      case 'g': return g
      case 'b': return b
      case 'a': return a
      case 'h': return (rgbToHsv(r, g, b)[0] / 360) * 255
      case 's': return rgbToHsv(r, g, b)[1] * 255
      case 'v': return rgbToHsv(r, g, b)[2] * 255
      case 'l': return rgbToHsl(r, g, b)[2] * 255
      case 'la': return clamp(rgbToLab(r, g, b)[0] * 2.55)
      case 'lb': return clamp(rgbToLab(r, g, b)[1] + 128)
    }
  }
  return applyPixelOp(src, (r, g, b, a) => [get(r, g, b, a, rSrc), get(r, g, b, a, gSrc), get(r, g, b, a, bSrc), a])
}

/** 颜色替换：距目标色欧氏距离 <= tolerance（0-255）的像素替换为 replacement */
export function colorReplace(src: ImageData, target: RGB, tolerance: number, replacement: RGB): ImageData {
  return applyPixelOp(src, (r, g, b, a) => {
    const d = Math.sqrt((r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2)
    return d <= tolerance ? [replacement.r, replacement.g, replacement.b, a] : [r, g, b, a]
  })
}

/** 颜色量化：对 RGB 做 K-Means 聚类（采样加速），输出 k 色图像 */
export function colorQuantize(src: ImageData, k: number, iterations = 8): ImageData {
  const kk = Math.max(2, Math.min(32, Math.round(k)))
  const n = src.width * src.height
  const maxSamples = 4096
  const step = Math.max(1, Math.floor(n / maxSamples))
  const indices: number[] = []
  for (let i = 0; i < n; i += step) indices.push(i)

  // 初始化：均匀采样
  const cents: [number, number, number][] = []
  for (let i = 0; i < kk; i++) {
    const j = Math.min(indices.length - 1, Math.floor(((i + 0.5) / kk) * indices.length))
    const p = indices[j] * 4
    cents.push([src.data[p], src.data[p + 1], src.data[p + 2]])
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sums: [number, number, number, number][] = Array.from({ length: kk }, () => [0, 0, 0, 0])
    for (const idx of indices) {
      const p = idx * 4
      const r = src.data[p]
      const g = src.data[p + 1]
      const b = src.data[p + 2]
      let best = 0
      let bd = Infinity
      for (let c = 0; c < kk; c++) {
        const d = (r - cents[c][0]) ** 2 + (g - cents[c][1]) ** 2 + (b - cents[c][2]) ** 2
        if (d < bd) { bd = d; best = c }
      }
      sums[best][0] += r
      sums[best][1] += g
      sums[best][2] += b
      sums[best][3] += 1
    }
    for (let c = 0; c < kk; c++) {
      if (sums[c][3] > 0) {
        cents[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
      }
    }
  }

  return applyPixelOp(src, (r, g, b, a) => {
    let best = 0
    let bd = Infinity
    for (let c = 0; c < kk; c++) {
      const d = (r - cents[c][0]) ** 2 + (g - cents[c][1]) ** 2 + (b - cents[c][2]) ** 2
      if (d < bd) { bd = d; best = c }
    }
    return [cents[best][0], cents[best][1], cents[best][2], a]
  })
}

// ===== 图像调整（05） =====

export function adjustBrightness(src: ImageData, delta: number): ImageData {
  return applyPixelOp(src, (r, g, b, a) => [r + delta, g + delta, b + delta, a])
}

export function adjustContrast(src: ImageData, factor: number): ImageData {
  return applyPixelOp(src, (r, g, b, a) => [(r - 128) * factor + 128, (g - 128) * factor + 128, (b - 128) * factor + 128, a])
}

export function adjustGamma(src: ImageData, gamma: number): ImageData {
  const inv = 1 / Math.max(0.05, gamma)
  return applyPixelOp(src, (r, g, b, a) => [255 * Math.pow(r / 255, inv), 255 * Math.pow(g / 255, inv), 255 * Math.pow(b / 255, inv), a])
}

export function adjustSaturation(src: ImageData, factor: number): ImageData {
  return applyPixelOp(src, (r, g, b, a) => {
    const [h, s, v] = rgbToHsv(r, g, b)
    const [nr, ng, nb] = hsvToRgb(h, clamp(s * factor, 0, 1), v)
    return [nr, ng, nb, a]
  })
}

export function adjustHue(src: ImageData, shiftDeg: number): ImageData {
  return applyPixelOp(src, (r, g, b, a) => {
    const [h, s, v] = rgbToHsv(r, g, b)
    const [nr, ng, nb] = hsvToRgb(h + shiftDeg, s, v)
    return [nr, ng, nb, a]
  })
}

export function adjustExposure(src: ImageData, ev: number): ImageData {
  const m = Math.pow(2, ev)
  return applyPixelOp(src, (r, g, b, a) => [r * m, g * m, b * m, a])
}

/** 白平衡：temp > 0 偏暖（R 升 B 降），tint > 0 偏洋红（G 降） */
export function adjustWhiteBalance(src: ImageData, temp: number, tint: number): ImageData {
  const rMul = 1 + temp / 200
  const bMul = 1 - temp / 200
  const gMul = 1 - tint / 200
  return applyPixelOp(src, (r, g, b, a) => [r * rMul, g * gMul, b * bMul, a])
}

/** 自动对比度：按亮度百分位拉伸（low/high 为百分位 0-100） */
export function autoContrast(src: ImageData, low = 1, high = 99): ImageData {
  const lum: number[] = []
  const d = src.data
  for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  const sorted = lum.slice().sort((a, b) => a - b)
  const lo = sorted[Math.floor((low / 100) * (sorted.length - 1))]
  const hi = sorted[Math.floor((high / 100) * (sorted.length - 1))]
  const range = Math.max(1, hi - lo)
  const scale = 255 / range
  return applyPixelOp(src, (r, g, b, a) => [(r - lo) * scale, (g - lo) * scale, (b - lo) * scale, a])
}

/** 自动亮度：把平均亮度移到 128 */
export function autoBrightness(src: ImageData): ImageData {
  const d = src.data
  let sum = 0
  let count = 0
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    count++
  }
  const mean = count ? sum / count : 128
  return adjustBrightness(src, 128 - mean)
}

// ===== 几何变换（02） =====

function toCanvas(src: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(src, 0, 0)
  return canvas
}

function fromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function resize(src: ImageData, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(toCanvas(src), 0, 0, canvas.width, canvas.height)
  return fromCanvas(canvas)
}

export function crop(src: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(toCanvas(src), Math.round(x), Math.round(y), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  return fromCanvas(canvas)
}

/** 任意角度旋转（输出为旋转后的外接矩形，黑/透明背景可选） */
export function rotate(src: ImageData, angleDeg: number, bg: RGB | null = null): ImageData {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.max(1, Math.round(src.width * cos + src.height * sin))
  const h = Math.max(1, Math.round(src.width * sin + src.height * cos))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (bg) {
    ctx.fillStyle = `rgb(${clamp(Math.round(bg.r))},${clamp(Math.round(bg.g))},${clamp(Math.round(bg.b))})`
    ctx.fillRect(0, 0, w, h)
  }
  ctx.translate(w / 2, h / 2)
  ctx.rotate(rad)
  ctx.drawImage(toCanvas(src), -src.width / 2, -src.height / 2)
  return fromCanvas(canvas)
}

export type FlipDir = 'horizontal' | 'vertical' | 'both'

export function flip(src: ImageData, dir: FlipDir): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.translate(dir === 'horizontal' || dir === 'both' ? src.width : 0, dir === 'vertical' || dir === 'both' ? src.height : 0)
  ctx.scale(dir === 'horizontal' || dir === 'both' ? -1 : 1, dir === 'vertical' || dir === 'both' ? -1 : 1)
  ctx.drawImage(toCanvas(src), 0, 0)
  return fromCanvas(canvas)
}

export function scale(src: ImageData, factor: number): ImageData {
  return resize(src, src.width * factor, src.height * factor)
}

export type PadColor = 'black' | 'white' | 'gray' | 'transparent'

export function pad(src: ImageData, top: number, right: number, bottom: number, left: number, color: PadColor): ImageData {
  const w = src.width + Math.round(left) + Math.round(right)
  const h = src.height + Math.round(top) + Math.round(bottom)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, w)
  canvas.height = Math.max(1, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  if (color === 'black') ctx.fillStyle = '#000'
  else if (color === 'white') ctx.fillStyle = '#fff'
  else if (color === 'gray') ctx.fillStyle = '#808080'
  if (color !== 'transparent') ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(toCanvas(src), Math.round(left), Math.round(top))
  return fromCanvas(canvas)
}

/** 仿射变换：旋转 + 缩放 + 错切 + 平移（输出为变换后外接矩形） */
export function affineWarp(
  src: ImageData,
  params: { rotateDeg: number; scaleX: number; scaleY: number; shearX: number; shearY: number; tx: number; ty: number }
): ImageData {
  const rad = (params.rotateDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const a = cos * params.scaleX + sin * params.shearY
  const b = -sin * params.scaleX + cos * params.shearY
  const c = sin * params.scaleY + cos * params.shearX
  const d = cos * params.scaleY - sin * params.shearX

  const corners: [number, number][] = [
    [0, 0],
    [src.width, 0],
    [src.width, src.height],
    [0, src.height]
  ]
  const tx = (x: number, y: number) => a * x + c * y
  const ty = (x: number, y: number) => b * x + d * y
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of corners) {
    minX = Math.min(minX, tx(x, y))
    maxX = Math.max(maxX, tx(x, y))
    minY = Math.min(minY, ty(x, y))
    maxY = Math.max(maxY, ty(x, y))
  }
  const w = Math.max(1, Math.ceil(maxX - minX))
  const h = Math.max(1, Math.ceil(maxY - minY))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(a, b, c, d, -minX + params.tx * src.width, -minY + params.ty * src.height)
  ctx.drawImage(toCanvas(src), 0, 0)
  return fromCanvas(canvas)
}

/** 透视变换：srcQuad 与 dstQuad 各 4 个点 [x, y]，计算单应矩阵并重投影 */
export function perspectiveWarp(src: ImageData, srcQuad: [number, number][], dstQuad: [number, number][]): ImageData {
  // 解 8x8 线性方程组求单应矩阵 H（h22 = 1）
  const A: number[][] = []
  const B: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcQuad[i]
    const [u, v] = dstQuad[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    B.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    B.push(v)
  }
  const h = solveLinear(A, B) // [h00..h21]
  const H = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
  const invH = invert3x3(H)

  // 目标尺寸 = dstQuad 包围盒
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of dstQuad) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const w = Math.max(1, Math.ceil(maxX - minX))
  const hh = Math.max(1, Math.ceil(maxY - minY))

  const out = new ImageData(w, hh)
  const od = out.data
  const sd = src.data
  const sw = src.width
  const sh = src.height
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const u = x + minX
      const v = y + minY
      // 逆变换到源坐标（齐次）
      const denom = invH[6] * u + invH[7] * v + invH[8]
      const sx = (invH[0] * u + invH[1] * v + invH[2]) / denom
      const sy = (invH[3] * u + invH[4] * v + invH[5]) / denom
      const oi = (y * w + x) * 4
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        od[oi] = 0
        od[oi + 1] = 0
        od[oi + 2] = 0
        od[oi + 3] = 0
        continue
      }
      // 双线性插值
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      for (let c = 0; c < 4; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx
        const bottom = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx
        od[oi + c] = clamp(Math.round(top * (1 - fy) + bottom * fy))
      }
    }
  }
  return out
}

/** 高斯消元解 8 元线性方程组 Ax = B */
function solveLinear(A: number[][], B: number[]): number[] {
  const n = B.length
  const m: number[][] = A.map((row, i) => [...row, B[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    }
    if (Math.abs(m[pivot][col]) < 1e-12) continue
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const pv = m[col][col]
    for (let j = col; j <= n; j++) m[col][j] /= pv
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (Math.abs(f) < 1e-12) continue
      for (let j = col; j <= n; j++) m[r][j] -= f * m[col][j]
    }
  }
  return m.map(row => row[n])
}

/** 3x3 矩阵求逆（行主序数组） */
function invert3x3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inv = 1 / det
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv
  ]
}

// ===== 像素网格放大（03） =====

/** 以 (cx, cy) 为中心放大 patch×patch 个像素为 cell×cell 大小，可叠加网格线 */
export function pixelGrid(src: ImageData, cx: number, cy: number, zoom: number, showGrid = true, patch = 12): ImageData {
  const cell = Math.max(2, Math.round(zoom))
  const w = patch * cell
  const h = patch * cell
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = false
  const srcCanvas = toCanvas(src)
  ctx.drawImage(srcCanvas, cx - patch / 2, cy - patch / 2, patch, patch, 0, 0, w, h)
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    for (let i = 0; i <= patch; i++) {
      ctx.beginPath()
      ctx.moveTo(i * cell, 0)
      ctx.lineTo(i * cell, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * cell)
      ctx.lineTo(w, i * cell)
      ctx.stroke()
    }
  }
  return fromCanvas(canvas)
}

// ===== 像素信息（01/03/04 取色共用） =====

export interface PixelInfo {
  x: number
  y: number
  r: number
  g: number
  b: number
  a: number
  hex: string
  hsv: [number, number, number]
  hsl: [number, number, number]
  lab: [number, number, number]
}

export function pixelInfo(src: ImageData, x: number, y: number): PixelInfo {
  const xx = clamp(Math.round(x), 0, src.width - 1)
  const yy = clamp(Math.round(y), 0, src.height - 1)
  const i = (yy * src.width + xx) * 4
  const r = src.data[i]
  const g = src.data[i + 1]
  const b = src.data[i + 2]
  const a = src.data[i + 3]
  return {
    x: xx,
    y: yy,
    r,
    g,
    b,
    a,
    hex: rgbToHex(r, g, b),
    hsv: rgbToHsv(r, g, b),
    hsl: rgbToHsl(r, g, b),
    lab: rgbToLab(r, g, b)
  }
}

/** 把 PixelInfo 格式化为 info 行（label 已本地化） */
export function pixelInfoRows(p: PixelInfo, lang: 'zh' | 'en'): { label: string; value: string }[] {
  const L = lang === 'zh'
  return [
    { label: L ? '坐标' : 'Position', value: `(${p.x}, ${p.y})` },
    { label: 'RGBA', value: `(${p.r}, ${p.g}, ${p.b}, ${p.a})` },
    { label: 'HEX', value: p.hex },
    { label: 'HSV', value: `${p.hsv[0].toFixed(1)}°, ${(p.hsv[1] * 100).toFixed(1)}%, ${(p.hsv[2] * 100).toFixed(1)}%` },
    { label: 'HSL', value: `${p.hsl[0].toFixed(1)}°, ${(p.hsl[1] * 100).toFixed(1)}%, ${(p.hsl[2] * 100).toFixed(1)}%` },
    { label: 'Lab', value: `L${p.lab[0].toFixed(1)} a${p.lab[1].toFixed(1)} b${p.lab[2].toFixed(1)}` }
  ]
}

// ===== 通用 =====

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 判断是否含透明通道（存在 alpha < 255 的像素） */
export function hasAlpha(src: ImageData): boolean {
  const d = src.data
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 255) return true
  }
  return false
}

// ===== 卷积与滤波（06 Filters / 07 Enhancement） =====

export interface ConvolveOptions {
  /** 归一化除数（默认 = 核元素之和，和为 0 时取 1） */
  divisor?: number
  /** 输出偏移 */
  offset?: number
  /** 边界处理：edge = 边缘复制（默认），zero = 补零 */
  border?: 'edge' | 'zero'
}

/** 2D 卷积（对 RGBA 四通道分别卷积；负值直接保留，由调用方决定是否截断） */
export function convolve(src: ImageData, kernel: number[][], opts: ConvolveOptions = {}): ImageData {
  const { divisor: div, offset = 0, border = 'edge' } = opts
  const kh = kernel.length
  const kw = kernel[0].length
  const cx = Math.floor(kw / 2)
  const cy = Math.floor(kh / 2)
  const sum = kernel.flat().reduce((a, b) => a + b, 0)
  const divisor = div ?? (Math.abs(sum) < 1e-9 ? 1 : sum)
  const out = cloneImageData(src)
  const d = out.data
  const sd = src.data
  const { width, height } = src
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oi = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let ky = 0; ky < kh; ky++) {
          const sy = y + ky - cy
          const yy = border === 'zero' ? sy : clamp(sy, 0, height - 1)
          if (border === 'zero' && (sy < 0 || sy >= height)) continue
          for (let kx = 0; kx < kw; kx++) {
            const sx = x + kx - cx
            const xx = border === 'zero' ? sx : clamp(sx, 0, width - 1)
            if (border === 'zero' && (sx < 0 || sx >= width)) continue
            acc += kernel[ky][kx] * sd[(yy * width + xx) * 4 + c]
          }
        }
        d[oi + c] = clamp(Math.round(acc / divisor + offset))
      }
    }
  }
  return out
}

export function boxKernel(radius: number): number[][] {
  const size = Math.max(1, Math.round(radius)) * 2 + 1
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 1))
}

export function gaussianKernel(radius: number, sigma?: number): number[][] {
  const r = Math.max(1, Math.round(radius))
  const size = r * 2 + 1
  const s = sigma ?? r / 2
  const k: number[][] = []
  let sum = 0
  for (let y = -r; y <= r; y++) {
    const row: number[] = []
    for (let x = -r; x <= r; x++) {
      const v = Math.exp(-(x * x + y * y) / (2 * s * s))
      row.push(v)
      sum += v
    }
    k.push(row)
  }
  return k.map(row => row.map(v => v / sum))
}

/** 运动模糊核：length 个点沿 angle 度方向的线段 */
export function motionKernel(length: number, angleDeg: number): number[][] {
  const len = Math.max(2, Math.round(length))
  const rad = (angleDeg * Math.PI) / 180
  const size = len
  const k: number[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
  const cx = (size - 1) / 2
  for (let i = 0; i < len; i++) {
    const t = i - (len - 1) / 2
    const x = Math.round(cx + t * Math.cos(rad))
    const y = Math.round(cx + t * Math.sin(rad))
    if (x >= 0 && x < size && y >= 0 && y < size) k[y][x] = 1
  }
  return k
}

export function boxBlur(src: ImageData, radius: number): ImageData {
  return convolve(src, boxKernel(radius))
}

export function gaussianBlur(src: ImageData, radius: number, sigma?: number): ImageData {
  return convolve(src, gaussianKernel(radius, sigma))
}

export function medianBlur(src: ImageData, size: number): ImageData {
  const s = Math.max(3, Math.round(size) % 2 === 0 ? Math.round(size) + 1 : Math.round(size))
  const r = Math.floor(s / 2)
  const out = cloneImageData(src)
  const d = out.data
  const sd = src.data
  const { width, height } = src
  const buf = new Float32Array(s * s)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oi = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        let n = 0
        for (let ky = -r; ky <= r; ky++) {
          const yy = clamp(y + ky, 0, height - 1)
          for (let kx = -r; kx <= r; kx++) {
            const xx = clamp(x + kx, 0, width - 1)
            buf[n++] = sd[(yy * width + xx) * 4 + c]
          }
        }
        buf.subarray(0, n).sort()
        d[oi + c] = Math.round(buf[Math.floor(n / 2)])
      }
    }
  }
  return out
}

/** 拉普拉斯锐化：out = src + amount * laplacian(src) */
export function sharpen(src: ImageData, amount: number): ImageData {
  const lap = convolve(src, [[0, -1, 0], [-1, 4, -1], [0, -1, 0]], { divisor: 1, border: 'edge' })
  return applyPixelOp(src, (r, g, b, a, x, y) => {
    const i = (y * src.width + x) * 4
    return [r + amount * (lap.data[i] - 128), g + amount * (lap.data[i + 1] - 128), b + amount * (lap.data[i + 2] - 128), a]
  })
}

/** USM：out = src + amount * (src - gaussianBlur(src)) */
export function unsharpMask(src: ImageData, radius: number, amount: number): ImageData {
  const blur = gaussianBlur(src, radius)
  return applyPixelOp(src, (r, g, b, a, x, y) => {
    const i = (y * src.width + x) * 4
    return [r + amount * (r - blur.data[i]), g + amount * (g - blur.data[i + 1]), b + amount * (b - blur.data[i + 2]), a]
  })
}

/** 浮雕：按方向生成 Sobel 风格核 */
export function emboss(src: ImageData, angleDeg: number): ImageData {
  const rad = (angleDeg * Math.PI) / 180
  const k: number[][] = []
  for (let dy = -1; dy <= 1; dy++) {
    const row: number[] = []
    for (let dx = -1; dx <= 1; dx++) {
      row.push(Math.round(Math.cos(rad) * dx + Math.sin(rad) * dy))
    }
    k.push(row)
  }
  return convolve(src, k, { divisor: 1, offset: 128 })
}

/** 高通滤波（拉普拉斯核） */
export function highPass(src: ImageData): ImageData {
  return convolve(src, [[0, -1, 0], [-1, 4, -1], [0, -1, 0]], { divisor: 1 })
}

// ===== 噪声（07） =====

function gaussRandom(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function addGaussianNoise(src: ImageData, sigma: number): ImageData {
  return applyPixelOp(src, (r, g, b, a) => [r + gaussRandom() * sigma, g + gaussRandom() * sigma, b + gaussRandom() * sigma, a])
}

export function addSaltPepperNoise(src: ImageData, amount: number): ImageData {
  const out = cloneImageData(src)
  const d = out.data
  const n = src.width * src.height
  const count = Math.round(n * Math.min(1, Math.max(0, amount)) / 100)
  for (let i = 0; i < count; i++) {
    const p = Math.floor(Math.random() * n) * 4
    const v = Math.random() < 0.5 ? 0 : 255
    d[p] = v
    d[p + 1] = v
    d[p + 2] = v
  }
  return out
}

// ===== 直方图与均衡化（07） =====

export function luminanceHistogram(src: ImageData): number[] {
  const hist = new Array(256).fill(0)
  const d = src.data
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    hist[clamp(l)]++
  }
  return hist
}

/** 把直方图渲染成图表 ImageData（条形图 + 折线） */
export function renderHistogram(hist: number[], width = 256, height = 128): ImageData {
  const max = Math.max(1, ...hist)
  const out = new ImageData(width, height)
  const d = out.data
  const barW = width / hist.length
  const prev: number[] = []
  for (let i = 0; i < hist.length; i++) {
    const h = Math.max(1, Math.round((hist[i] / max) * (height - 4)))
    for (let y = height - 1; y >= height - 1 - h && y >= 0; y--) {
      for (let x = Math.floor(i * barW); x < Math.floor((i + 1) * barW); x++) {
        const p = (y * width + x) * 4
        d[p] = 96
        d[p + 1] = 165
        d[p + 2] = 250
        d[p + 3] = 255
      }
    }
    prev.push(height - 1 - h)
  }
  // 折线
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx) {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const cctx = c.getContext('2d')!
    cctx.putImageData(out, 0, 0)
    cctx.strokeStyle = 'rgba(255,255,255,0.85)'
    cctx.lineWidth = 1.5
    cctx.beginPath()
    prev.forEach((v, i) => {
      const x = (i + 0.5) * barW
      if (i === 0) cctx.moveTo(x, v)
      else cctx.lineTo(x, v)
    })
    cctx.stroke()
    return cctx.getImageData(0, 0, width, height)
  }
  return out
}

/** 直方图均衡化（亮度通道 CDF，保持颜色比例） */
export function histogramEqualization(src: ImageData): ImageData {
  const hist = luminanceHistogram(src)
  const cdf = new Array(256).fill(0)
  let acc = 0
  const n = src.width * src.height
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    cdf[i] = Math.round((acc / n) * 255)
  }
  return applyPixelOp(src, (r, g, b, a) => {
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    const nl = cdf[clamp(l)]
    const s = l === 0 ? 1 : nl / l
    return [r * s, g * s, b * s, a]
  })
}

/** 综合增强：自动亮度 + 自动对比度 */
export function enhance(src: ImageData): ImageData {
  return autoContrast(autoBrightness(src))
}

// ===== 阈值与形态学（08） =====

/** 固定阈值二值化（亮度 >= thresh → 白，否则黑） */
export function thresholdBinary(src: ImageData, thresh: number): ImageData {
  return applyPixelOp(src, (r, g, b, a) => {
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    const v = l >= thresh ? 255 : 0
    return [v, v, v, a]
  })
}

/** 自适应阈值：局部均值/高斯加权均值 - C */
export function thresholdAdaptive(src: ImageData, blockSize: number, C: number, method: 'mean' | 'gaussian'): ImageData {
  const gray = grayscale(src, 'luminance')
  const r = Math.max(1, Math.round(blockSize) / 2)
  const mean = method === 'gaussian' ? gaussianBlur(gray, r) : boxBlur(gray, r)
  return applyPixelOp(gray, (r2, g2, b2, a, x, y) => {
    const i = (y * src.width + x) * 4
    const m = mean.data[i]
    const v = r2 >= m - C ? 255 : 0
    return [v, v, v, a]
  })
}

/** Otsu 阈值：返回 [阈值, 二值化结果] */
export function thresholdOtsu(src: ImageData): { threshold: number; imageData: ImageData } {
  const hist = luminanceHistogram(src)
  const n = src.width * src.height
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let maxVar = -1
  let thresh = 128
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) {
      maxVar = between
      thresh = i
    }
  }
  return { threshold: thresh, imageData: thresholdBinary(src, thresh) }
}

/** 最小值滤波（腐蚀），size 为窗口边长（奇数） */
export function erode(src: ImageData, size: number): ImageData {
  const s = Math.max(3, Math.round(size) % 2 === 0 ? Math.round(size) + 1 : Math.round(size))
  const r = Math.floor(s / 2)
  const out = cloneImageData(src)
  const d = out.data
  const sd = src.data
  const { width, height } = src
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oi = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        let m = 255
        for (let ky = -r; ky <= r; ky++) {
          const yy = clamp(y + ky, 0, height - 1)
          for (let kx = -r; kx <= r; kx++) {
            const xx = clamp(x + kx, 0, width - 1)
            m = Math.min(m, sd[(yy * width + xx) * 4 + c])
          }
        }
        d[oi + c] = m
      }
    }
  }
  return out
}

/** 最大值滤波（膨胀） */
export function dilate(src: ImageData, size: number): ImageData {
  const s = Math.max(3, Math.round(size) % 2 === 0 ? Math.round(size) + 1 : Math.round(size))
  const r = Math.floor(s / 2)
  const out = cloneImageData(src)
  const d = out.data
  const sd = src.data
  const { width, height } = src
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oi = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        let m = 0
        for (let ky = -r; ky <= r; ky++) {
          const yy = clamp(y + ky, 0, height - 1)
          for (let kx = -r; kx <= r; kx++) {
            const xx = clamp(x + kx, 0, width - 1)
            m = Math.max(m, sd[(yy * width + xx) * 4 + c])
          }
        }
        d[oi + c] = m
      }
    }
  }
  return out
}

export function opening(src: ImageData, size: number): ImageData {
  return dilate(erode(src, size), size)
}

export function closing(src: ImageData, size: number): ImageData {
  return erode(dilate(src, size), size)
}

export function morphGradient(src: ImageData, size: number): ImageData {
  const dil = dilate(src, size)
  const er = erode(src, size)
  return applyPixelOp(dil, (r, g, b, a, x, y) => {
    const i = (y * src.width + x) * 4
    return [r - er.data[i], g - er.data[i + 1], b - er.data[i + 2], a]
  })
}
