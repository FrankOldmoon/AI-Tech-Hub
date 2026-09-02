/**
 * 纯浏览器端人脸注册 / 识别（face-api，基于 TF.js）。
 * 所有模型在 /model/faceapi 本地运行，数据不出浏览器，无需后端。
 * - 人脸检测 + 关键点 + 128 维人脸嵌入（faceRecognitionNet）
 * - localStorage 注册库（多样张：同名追加 sample，识别时取该人最高相似度）
 * 注意：所有函数只在浏览器端使用；模块顶层不做任何 window/document 访问（SSR 安全）。
 */

declare global {
  interface Window {
    faceapi?: any
  }
}

export interface FaceResult {
  descriptor: number[]      // 128 维人脸嵌入
  box: { x: number, y: number, width: number, height: number }
  score: number
}

export interface RegistrySample {
  id: string
  descriptor: number[]
  thumb?: string
  createdAt: number
}

export interface RegisteredFace {
  id: string
  name: string
  samples: RegistrySample[]
  createdAt: number
}

export interface RecognizeHit {
  name: string
  similarity: number
  sample: RegistrySample
}

const STORAGE_KEY = 'aihub.faceRegistrants.v1'
const RECOGNITION_THRESHOLD = 0.5

let modelsPromise: Promise<any> | null = null

/** 懒加载一次 face-api 并加载本地模型（tiny 检测 / 68 关键点 / 识别）。 */
export async function ensureFaceApiLoaded(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('仅可在浏览器端运行')
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api')
      const base = '/model/faceapi'
      await faceapi.nets.tinyFaceDetector.loadFromUri(base)
      await faceapi.nets.faceLandmark68Net.loadFromUri(base)
      await faceapi.nets.faceRecognitionNet.loadFromUri(base)
      return faceapi
    })()
  }
  return modelsPromise
}

/** 提取图片中所有人脸的人脸嵌入与位置。 */
export async function extractFaces(input: HTMLImageElement | HTMLCanvasElement): Promise<FaceResult[]> {
  const faceapi = await ensureFaceApiLoaded()
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })
  const results = await faceapi.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors()
  return results.map((r: any) => ({
    descriptor: Array.from(r.descriptor as Float32Array),
    box: {
      x: Math.round(r.detection.box.x),
      y: Math.round(r.detection.box.y),
      width: Math.round(r.detection.box.width),
      height: Math.round(r.detection.box.height)
    },
    score: r.detection.score
  }))
}

/** 余弦相似度（向量已单位化，等价于 face-api 的欧氏距离比对）。 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function descriptorDistanceThreshold(): number {
  return RECOGNITION_THRESHOLD
}

// ============================================================
// localStorage 注册库
// ============================================================

function loadRegistry(): RegisteredFace[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as RegisteredFace[] : []
  } catch {
    return []
  }
}

function saveRegistry(list: RegisteredFace[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function getRegistry(): RegisteredFace[] {
  return loadRegistry()
}

/** 注册一个样本：同名则追加 sample（多样张），否则新建 per。 */
export function registerFace(name: string, descriptor: number[], thumb?: string): RegisteredFace[] {
  const list = loadRegistry()
  const trimmed = name.trim()
  const sample: RegistrySample = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, descriptor, thumb, createdAt: Date.now() }
  const existing = list.find(f => f.name === trimmed)
  if (existing) {
    existing.samples.push(sample)
  } else {
    list.push({ id: sample.id, name: trimmed, samples: [sample], createdAt: Date.now() })
  }
  saveRegistry(list)
  return list
}

export function removeFace(id: string): RegisteredFace[] {
  const list = loadRegistry().filter(f => f.id !== id)
  saveRegistry(list)
  return list
}

export function clearRegistry(): RegisteredFace[] {
  saveRegistry([])
  return []
}

/** 用 probe 嵌入在注册库中比对，返回该人最高相似度命中（低于阈值返回 null）。 */
export function recognizeDescriptor(descriptor: number[], registry: RegisteredFace[]): RecognizeHit | null {
  let best: RecognizeHit | null = null
  for (const face of registry) {
    for (const sample of face.samples) {
      const sim = cosineSimilarity(descriptor, sample.descriptor)
      if (!best || sim > best.similarity) best = { name: face.name, similarity: sim, sample }
    }
  }
  return best && best.similarity >= RECOGNITION_THRESHOLD ? best : null
}

// ============================================================
// 图片工具（浏览器端）
// ============================================================

/** File -> HTMLImageElement（用于 face-api 检测）。 */
export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

/** 生成整图缩略图 dataURL（用于注册库展示）。 */
export function imageThumbDataUrl(img: HTMLImageElement | HTMLCanvasElement, max = 120): string {
  const w = img.width
  const h = img.height
  const scale = Math.min(1, max / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(img, 0, 0, cw, ch)
  return canvas.toDataURL('image/jpeg', 0.7)
}