// YOLO26n 浏览器端推理核心：ORT session 管理（WebGPU / WASM 回退）+ 图像预处理
// 模型文件在 public/models/，onnxruntime wasm 自托管到 public/vendor/onnx/
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import type { YoloModel } from '~/utils/yolo/models'
import type { PreprocessRect } from '~/utils/yolo/postprocess'

type OrtModule = typeof import('onnxruntime-web')
type Session = { session: any, backend: string }

const sessions = new Map<string, Session>()
// 同一 ORT 模块只初始化一次
let ortPromise: Promise<OrtModule> | null = null

async function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = await import('onnxruntime-web')
      if (typeof window !== 'undefined') {
        ort.env.wasm.wasmPaths = '/vendor/onnx/'
        ort.env.wasm.numThreads = 1
      }
      return ort
    })()
  }
  return ortPromise
}

function withTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${tag} 加载超时(${ms}ms)`)), ms))
  ])
}

/** 加载（或复用）指定模型的 InferenceSession，优先 WebGPU，失败回退 WASM */
export async function getYoloSession(model: YoloModel): Promise<Session> {
  if (sessions.has(model.id)) return sessions.get(model.id)!
  const ort = await getOrt()
  let session: any
  let backend: string
  try {
    if ((navigator as { gpu?: unknown }).gpu) {
      session = await withTimeout(
        ort.InferenceSession.create(model.file, { executionProviders: ['webgpu'] }),
        8000, 'WebGPU'
      )
      backend = 'WebGPU'
    } else {
      throw new Error('无 navigator.gpu')
    }
  } catch {
    session = await withTimeout(
      ort.InferenceSession.create(model.file, { executionProviders: ['wasm'] }),
      60000, 'WASM'
    )
    backend = 'WASM (CPU)'
  }
  const entry = { session, backend }
  sessions.set(model.id, entry)
  return entry
}

export function disposeYoloSessions() {
  sessions.forEach(({ session }) => { try { session.release?.() } catch { /* ignore */ } })
  sessions.clear()
}

/**
 * 视频帧预处理：
 * - cls：短边缩放到 imgsz*256/224 再中心裁剪 imgsz
 * - 其余：等比缩放 + 灰边（letterbox）
 * 返回张量 + 视频坐标→模型坐标的 scale/dx/dy（用于后处理还原）
 */
export async function preprocess(video: HTMLVideoElement, imgsz: number, centerCrop: boolean):
Promise<{ tensor: any, scale: number, dx: number, dy: number } & PreprocessRect> {
  const ort = await getOrt()
  const vw = video.videoWidth, vh = video.videoHeight
  const tmp = new OffscreenCanvas(imgsz, imgsz)
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!
  let scale: number, dx: number, dy: number
  if (centerCrop) {
    const rs = (imgsz * 256) / 224 / Math.min(vw, vh)
    const sw = vw * rs, sh = vh * rs
    dx = (sw - imgsz) / 2; dy = (sh - imgsz) / 2
    scale = rs
    tctx.fillStyle = '#000'
    tctx.fillRect(0, 0, imgsz, imgsz)
    tctx.drawImage(video, -dx / rs, -dy / rs, sw / rs, sh / rs)
    dx = -dx; dy = -dy // 视频坐标 -> 模型坐标偏移
  } else {
    scale = Math.min(imgsz / vw, imgsz / vh)
    const nw = vw * scale, nh = vh * scale
    dx = (imgsz - nw) / 2; dy = (imgsz - nh) / 2
    tctx.fillStyle = '#808080'
    tctx.fillRect(0, 0, imgsz, imgsz)
    tctx.drawImage(video, dx, dy, nw, nh)
  }
  const data = tctx.getImageData(0, 0, imgsz, imgsz).data
  const plane = imgsz * imgsz
  const chw = new Float32Array(3 * plane)
  for (let i = 0, j = 0; i < plane; i++) {
    chw[i] = (data[j++] as number) / 255
    chw[i + plane] = (data[j++] as number) / 255
    chw[i + plane * 2] = (data[j++] as number) / 255
    j++
  }
  return { tensor: new ort.Tensor('float32', chw, [1, 3, imgsz, imgsz]), scale, dx, dy }
}
