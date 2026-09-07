// YOLO 各任务输出后处理 + 绘制：把 ONNX 原始输出转成统一绘制描述
// 移植自 /Users/oldmoon/Documents/ubuntu/nuxt_init_vision/public/lib/yolo/{postprocess.js,main.js}
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import { COCO, CITYSCAPES, IMAGENET, SKELETON } from './labels'
import type { YoloTask } from './models'

const toVideo = (v: number, p: PreprocessRect, d: number) => (v - d) / p.scale

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)) }

/** 检测框配色（按类别名哈希） */
export function hueOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export interface Kpt { x: number, y: number, v: number }

export interface Detection {
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
  label: string
  kpts?: Kpt[]
  angle?: number
  mask?: Uint8Array
  maskSize?: number
  hasMask?: boolean
}

export interface SemRes {
  type: 'sem'
  idx: Uint8Array
  w: number
  h: number
}

export interface DepthRes {
  type: 'depth'
  norm: Uint8Array
  w: number
  h: number
}

export interface BoxRes {
  type: 'boxes' | 'pose' | 'obb' | 'seg'
  dets: Detection[]
}

export interface ClsRes {
  type: 'cls'
  label: string
  score: number
  top5: Array<{ label: string, score: number }>
}

export type Result = BoxRes | SemRes | DepthRes | ClsRes

interface PreprocessRect { scale: number, dx: number, dy: number }

export type OutputTensor = { data: any, dims?: number[] }

interface ObbResLike {
  x1: number
  y1: number
  x2: number
  y2: number
  angle: number
}

function postDetect(out: OutputTensor, p: PreprocessRect, conf: number): BoxRes {
  const dets: Detection[] = []
  const d = out.data
  for (let i = 0; i < 300; i++) {
    const o = i * 6
    if (d[o + 4] < conf) continue
    dets.push({
      x1: toVideo(d[o], p, p.dx), y1: toVideo(d[o + 1], p, p.dy),
      x2: toVideo(d[o + 2], p, p.dx), y2: toVideo(d[o + 3], p, p.dy),
      score: d[o + 4], label: COCO[d[o + 5]] || 'unknown'
    })
  }
  return { type: 'boxes', dets }
}

function postPose(out: OutputTensor, p: PreprocessRect, conf: number): BoxRes {
  const dets: Detection[] = []
  const d = out.data
  for (let i = 0; i < 300; i++) {
    const o = i * 57
    if (d[o + 4] < conf) continue
    const kpts: Kpt[] = []
    for (let k = 0; k < 17; k++) {
      const ko = o + 6 + k * 3
      kpts.push({ x: toVideo(d[ko], p, p.dx), y: toVideo(d[ko + 1], p, p.dy), v: d[ko + 2] })
    }
    dets.push({
      x1: toVideo(d[o], p, p.dx), y1: toVideo(d[o + 1], p, p.dy),
      x2: toVideo(d[o + 2], p, p.dx), y2: toVideo(d[o + 3], p, p.dy),
      score: d[o + 4], label: COCO[d[o + 5]] || 'person', kpts
    })
  }
  return { type: 'pose', dets }
}

function postObb(out: OutputTensor, p: PreprocessRect, conf: number): BoxRes {
  const dets: Detection[] = []
  const d = out.data
  for (let i = 0; i < 300; i++) {
    const o = i * 7
    if (d[o + 4] < conf) continue
    const c = { x1: toVideo(d[o], p, p.dx), y1: toVideo(d[o + 1], p, p.dy), x2: toVideo(d[o + 2], p, p.dx), y2: toVideo(d[o + 3], p, p.dy), angle: d[o + 6] } as ObbResLike
    const box: Detection = { ...c, score: d[o + 4], label: COCO[d[o + 5]] || 'unknown', angle: c.angle }
    dets.push(box)
  }
  return { type: 'obb', dets }
}

function postSeg(out0: OutputTensor, out1: OutputTensor, p: PreprocessRect, conf: number): BoxRes {
  const proto = out1.data
  const PM = 160
  const dets: Detection[] = []
  const d = out0.data
  for (let i = 0; i < 300; i++) {
    const o = i * 38
    if (d[o + 4] < conf) continue
    const mask = new Uint8Array(PM * PM)
    let any = false
    for (let y = 0; y < PM; y++) {
      for (let x = 0; x < PM; x++) {
        let sum = 0
        for (let c = 0; c < 32; c++) sum += d[o + 6 + c] * proto[c * PM * PM + y * PM + x]
        if (sum > 0) { mask[y * PM + x] = 1; any = true }
      }
    }
    dets.push({
      x1: toVideo(d[o], p, p.dx), y1: toVideo(d[o + 1], p, p.dy),
      x2: toVideo(d[o + 2], p, p.dx), y2: toVideo(d[o + 3], p, p.dy),
      score: d[o + 4], label: COCO[d[o + 5]] || 'unknown',
      mask, maskSize: PM, hasMask: any
    })
  }
  return { type: 'seg', dets }
}

function postSem(out: OutputTensor): SemRes {
  return { type: 'sem', idx: out.data, w: 1024, h: 1024 }
}

function postDepth(out: OutputTensor): DepthRes {
  const d = out.data
  let min = Infinity, max = -Infinity
  for (let i = 0; i < d.length; i++) {
    if (d[i] < min) min = d[i]
    if (d[i] > max) max = d[i]
  }
  const range = max - min || 1
  const norm = new Uint8Array(d.length)
  for (let i = 0; i < d.length; i++) norm[i] = ((d[i] - min) / range) * 255
  return { type: 'depth', norm, w: 768, h: 768 }
}

function postCls(out: OutputTensor): ClsRes {
  const d = out.data
  const idx = Array.from(d.keys()) as number[]
  idx.sort((a, b) => d[b] - d[a])
  const maxLogit = d[idx[0]!]
  const exps = idx.map(i => Math.exp(d[i] - maxLogit))
  const sumExp = exps.reduce((a, b) => a + b, 0)
  const top5 = idx.slice(0, 5).map((ci, k) => ({
    label: IMAGENET[ci] || String(ci), score: (exps[k] ?? 0) / sumExp
  }))
  const first = top5[0]
  return { type: 'cls', label: first?.label ?? 'unknown', score: first?.score ?? 0, top5 }
}

export function postprocess(task: YoloTask, outputs: OutputTensor[], p: PreprocessRect, conf: number): Result {
  const head = outputs[0]
  if (!head) return { type: 'boxes', dets: [] }
  switch (task) {
    case 'detect': return postDetect(head, p, conf)
    case 'pose': return postPose(head, p, conf)
    case 'obb': return postObb(head, p, conf)
    case 'seg': return postSeg(head, outputs[1]!, p, conf)
    case 'sem': return postSem(head)
    case 'depth': return postDepth(head)
    case 'cls': return postCls(head)
  }
}

// ---------- 绘制 ----------

function drawLabel(ctx: CanvasRenderingContext2D, label: string, score: number, x: number, y: number, color: string) {
  const text = `${label} ${Math.round(score * 100)}%`
  ctx.font = '13px -apple-system, sans-serif'
  const tw = ctx.measureText(text).width
  const ly = y > 20 ? y - 6 : y + 18
  ctx.fillStyle = color
  ctx.fillRect(x, ly - 14, tw + 10, 18)
  ctx.fillStyle = '#000'
  ctx.fillText(text, x + 5, ly)
}

export function drawBoxes(ctx: CanvasRenderingContext2D, dets: Detection[]) {
  for (const d of dets) {
    const color = `hsl(${hueOf(d.label)}, 90%, 60%)`
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1)
    drawLabel(ctx, d.label, d.score, d.x1, d.y1, color)
  }
}

export function drawPose(ctx: CanvasRenderingContext2D, dets: Detection[]) {
  for (const d of dets) {
    const color = `hsl(${hueOf(d.label)}, 90%, 60%)`
    ctx.lineWidth = 3
    ctx.strokeStyle = '#4ade80'
    if (d.kpts) {
      for (const [a, b] of SKELETON) {
        const ka = d.kpts[a], kb = d.kpts[b]
        if (!ka || !kb) continue
        if (ka.v > 0.3 && kb.v > 0.3) {
          ctx.beginPath()
          ctx.moveTo(ka.x, ka.y)
          ctx.lineTo(kb.x, kb.y)
          ctx.stroke()
        }
      }
      ctx.fillStyle = '#facc15'
      for (const k of d.kpts) {
        if (k.v > 0.3) {
          ctx.beginPath()
          ctx.arc(k.x, k.y, 4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1)
    drawLabel(ctx, d.label, d.score, d.x1, d.y1, color)
  }
}

export function drawObb(ctx: CanvasRenderingContext2D, dets: Detection[]) {
  for (const d of dets) {
    const color = `hsl(${hueOf(d.label)}, 90%, 60%)`
    const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2
    const w = d.x2 - d.x1, h = d.y2 - d.y1
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(d.angle || 0)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.restore()
    drawLabel(ctx, d.label, d.score, d.x1, d.y1, color)
  }
}

const maskCanvasRef: { c: OffscreenCanvas | null } = { c: null }
function getMaskCanvas(): OffscreenCanvas {
  if (!maskCanvasRef.c) maskCanvasRef.c = new OffscreenCanvas(160, 160)
  return maskCanvasRef.c
}

export function drawSeg(ctx: CanvasRenderingContext2D, dets: Detection[]) {
  const mctx = getMaskCanvas().getContext('2d')!
  for (const d of dets) {
    if (d.hasMask && d.mask && d.maskSize) {
      const img = mctx.createImageData(d.maskSize, d.maskSize)
      const hue = hueOf(d.label)
      const [r, g, b] = hslToRgb(hue / 360, 0.9, 0.6)
      for (let i = 0; i < d.mask.length; i++) {
        if (d.mask[i]) {
          img.data[i * 4] = r; img.data[i * 4 + 1] = g
          img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 115
        }
      }
      mctx.putImageData(img, 0, 0)
      ctx.save()
      ctx.beginPath()
      ctx.rect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1)
      ctx.clip()
      ctx.drawImage(getMaskCanvas(), d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1)
      ctx.restore()
    }
    const color = `hsl(${hueOf(d.label)}, 90%, 60%)`
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1)
    drawLabel(ctx, d.label, d.score, d.x1, d.y1, color)
  }
}

const semCanvasRef: { c: OffscreenCanvas | null } = { c: null }
function getSemCanvas(): OffscreenCanvas {
  if (!semCanvasRef.c) semCanvasRef.c = new OffscreenCanvas(1024, 1024)
  return semCanvasRef.c
}

export function drawSem(ctx: CanvasRenderingContext2D, res: SemRes, w: number, h: number) {
  const { idx } = res
  const palette = CITYSCAPES
  const semCanvas = getSemCanvas()
  semCanvas.width = res.w; semCanvas.height = res.h
  const mctx = semCanvas.getContext('2d')!
  const img = mctx.createImageData(res.w, res.h)
  for (let i = 0; i < idx.length; i++) {
    const cls = palette[Math.min(idx[i]!, palette.length - 1)]
    const col: [number, number, number] = cls ? cls.color : [0, 0, 0]
    img.data[i * 4] = col[0]
    img.data[i * 4 + 1] = col[1]
    img.data[i * 4 + 2] = col[2]
    img.data[i * 4 + 3] = 255
  }
  mctx.putImageData(img, 0, 0)
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(semCanvas, 0, 0, w, h)
  ctx.restore()
}

const depthCanvasRef: { c: OffscreenCanvas | null } = { c: null }
function getDepthCanvas(): OffscreenCanvas {
  if (!depthCanvasRef.c) depthCanvasRef.c = new OffscreenCanvas(768, 768)
  return depthCanvasRef.c
}

function heatColor(t: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [[0, [30, 60, 180]], [0.35, [30, 180, 220]], [0.6, [80, 220, 80]], [0.8, [250, 200, 40]], [1, [240, 40, 40]]]
  for (let i = 1; i < stops.length; i++) {
    const cur = stops[i]
    if (!cur) continue
    if (t <= cur[0]) {
      const prev = stops[i - 1]
      if (!prev) continue
      const [t0, c0] = prev
      const [t1, c1] = cur
      const k = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k)
      ]
    }
  }
  return stops[stops.length - 1]![1]
}

export function drawDepth(ctx: CanvasRenderingContext2D, res: DepthRes, w: number, h: number) {
  const { norm } = res
  const depthCanvas = getDepthCanvas()
  depthCanvas.width = res.w; depthCanvas.height = res.h
  const mctx = depthCanvas.getContext('2d')!
  const img = mctx.createImageData(res.w, res.h)
  for (let i = 0; i < norm.length; i++) {
    const [r, g, b] = heatColor((norm[i] ?? 0) / 255)
    img.data[i * 4] = r; img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255
  }
  mctx.putImageData(img, 0, 0)
  ctx.save()
  ctx.globalAlpha = 0.65
  ctx.drawImage(depthCanvas, 0, 0, w, h)
  ctx.restore()
}

export { sigmoid, CITYSCAPES }

export type { PreprocessRect }
export type { YoloTask as PostYoloTask }
