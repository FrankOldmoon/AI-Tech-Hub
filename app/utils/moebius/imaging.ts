// Moebius 图像 <-> 张量工具（移植自 simonw/moebius-web，Apache-2.0）
// 固定 512x512 图像 / 64x64 latent（模型 rel_pos_emb 绑定训练分辨率）
export const IMG = 512
export const LAT = 64

/** 可复现 PRNG（mulberry32）+ Box-Muller 高斯噪声 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randn(n: number, seed: number): Float32Array {
  const rng = mulberry32(seed)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let u = 0
    let v = 0
    while (u === 0) u = rng()
    while (v === 0) v = rng()
    out[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  }
  return out
}

export interface Fitted {
  canvas: HTMLCanvasElement
  rect: { x: number, y: number, w: number, h: number }
}

/** 源图按 contain 放入 512x512 画布（letterbox），返回画布 + 内容矩形 */
export function toSquareCanvas(src: CanvasImageSource, srcW: number, srcH: number): Fitted {
  const c = document.createElement('canvas')
  c.width = IMG
  c.height = IMG
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, IMG, IMG)

  const scale = Math.min(IMG / srcW, IMG / srcH)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  const x = Math.floor((IMG - w) / 2)
  const y = Math.floor((IMG - h) / 2)
  ctx.drawImage(src, x, y, w, h)
  return { canvas: c, rect: { x, y, w, h } }
}

/** RGB 画布 -> CHW Float32Array（[-1,1]，1,3,512,512） */
export function canvasToCHW(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, IMG, IMG)
  const out = new Float32Array(3 * IMG * IMG)
  const plane = IMG * IMG
  for (let p = 0; p < plane; p++) {
    out[p] = (data[p * 4] / 255) * 2 - 1
    out[plane + p] = (data[p * 4 + 1] / 255) * 2 - 1
    out[2 * plane + p] = (data[p * 4 + 2] / 255) * 2 - 1
  }
  return out
}

/** 蒙版画布 -> 二值 Float32Array（alpha>=128 视为涂抹区=1） */
export function maskCanvasToBinary(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, IMG, IMG)
  const out = new Float32Array(IMG * IMG)
  for (let p = 0; p < IMG * IMG; p++) {
    out[p] = data[p * 4 + 3] >= 128 ? 1 : 0
  }
  return out
}

/** masked image = image * (1 - mask)，CHW 输入输出 */
export function makeMaskedCHW(imgCHW: Float32Array, maskBin: Float32Array): Float32Array {
  const out = new Float32Array(imgCHW.length)
  const plane = IMG * IMG
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < plane; p++) {
      out[c * plane + p] = imgCHW[c * plane + p] * (1 - maskBin[p])
    }
  }
  return out
}

/** 512x512 二值蒙版 -> 64x64（PyTorch 最近邻：取每 8x8 块左上角） */
export function maskToLatent(maskBin: Float32Array): Float32Array {
  const out = new Float32Array(LAT * LAT)
  const ratio = IMG / LAT
  for (let y = 0; y < LAT; y++) {
    for (let x = 0; x < LAT; x++) {
      out[y * LAT + x] = maskBin[y * ratio * IMG + x * ratio]
    }
  }
  return out
}

/** 解码输出（[-1,1] CHW）-> ImageData */
export function chwToImageData(chw: Float32Array): ImageData {
  const plane = IMG * IMG
  const out = new ImageData(IMG, IMG)
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      let v = (chw[c * plane + p] + 1) / 2
      v = v < 0 ? 0 : v > 1 ? 1 : v
      out.data[p * 4 + c] = Math.round(v * 255)
    }
    out.data[p * 4 + 3] = 255
  }
  return out
}

/** 回贴：result*blur(mask) + (1-blur(mask))*original，蒙版 3px 高斯模糊 */
export function pasteBack(
  resultData: ImageData,
  originalCanvas: HTMLCanvasElement,
  maskBin: Float32Array,
): HTMLCanvasElement {
  const mc = document.createElement('canvas')
  mc.width = IMG
  mc.height = IMG
  const mctx = mc.getContext('2d')!
  const mdata = new ImageData(IMG, IMG)
  for (let p = 0; p < IMG * IMG; p++) {
    const v = maskBin[p] * 255
    mdata.data[p * 4] = v
    mdata.data[p * 4 + 1] = v
    mdata.data[p * 4 + 2] = v
    mdata.data[p * 4 + 3] = 255
  }
  mctx.putImageData(mdata, 0, 0)

  const blur = document.createElement('canvas')
  blur.width = IMG
  blur.height = IMG
  const bctx = blur.getContext('2d')!
  bctx.filter = 'blur(3px)'
  bctx.drawImage(mc, 0, 0)
  const blurMask = bctx.getImageData(0, 0, IMG, IMG).data

  const orig = originalCanvas.getContext('2d')!.getImageData(0, 0, IMG, IMG).data

  const out = document.createElement('canvas')
  out.width = IMG
  out.height = IMG
  const octx = out.getContext('2d')!
  const blended = new ImageData(IMG, IMG)
  for (let p = 0; p < IMG * IMG; p++) {
    const m = blurMask[p * 4] / 255
    for (let c = 0; c < 3; c++) {
      blended.data[p * 4 + c] = Math.round(resultData.data[p * 4 + c] * m + orig[p * 4 + c] * (1 - m))
    }
    blended.data[p * 4 + 3] = 255
  }
  octx.putImageData(blended, 0, 0)
  return out
}
