/**
 * 人脸注册与识别（浏览器本地注册库 + Python insightface 嵌入）。
 *
 * - 注册：上传人脸照片 + 姓名 -> 后端提取 512 维嵌入 -> 存入 localStorage（本机隐私友好）
 * - 识别：上传待识别照片 -> 提取嵌入 -> 与注册库逐人算余弦相似度 -> 返回最佳匹配
 * - 依赖：/api/image/face-recognition 异步队列（insightface，venv 未就绪时优雅报错）
 */

export interface RegisteredFace {
  id: string
  name: string
  embedding: number[]
  thumb?: string
  createdAt: number
}

const STORAGE_KEY = 'imglab:faces:v1'
/** 低于该相似度视为"未识别" */
const MATCH_THRESHOLD = 0.4

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function toDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:(.*?);base64/.exec(head)?.[1] || 'image/png'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)
}

function makeThumb(imageData: ImageData): string {
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const src = document.createElement('canvas')
  src.width = imageData.width
  src.height = imageData.height
  src.getContext('2d')!.putImageData(imageData, 0, 0)
  // 居中裁剪为方形缩略图
  const side = Math.min(imageData.width, imageData.height)
  const sx = (imageData.width - side) / 2
  const sy = (imageData.height - side) / 2
  ctx.drawImage(src, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export function getRegisteredFaces(): RegisteredFace[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RegisteredFace[]) : []
  } catch {
    return []
  }
}

function saveFaces(faces: RegisteredFace[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(faces))
  } catch {
    /* ignore */
  }
}

/** 通过 Python 后端提取单张人脸的 512 维嵌入 */
export async function extractFaceEmbedding(imageData: ImageData): Promise<number[]> {
  const form = new FormData()
  form.append('file', dataUrlToBlob(toDataUrl(imageData)), 'face.png')
  form.append('mode', 'recognition')
  const res = await $fetch<any>('/api/image/face-recognition', { method: 'POST', body: form })
  if (!res?.ok) throw new Error(res?.error || '提交任务失败')
  const deadline = Date.now() + 10 * 60 * 1000
  let task: any = null
  while (Date.now() < deadline) {
    await sleep(1000)
    task = await $fetch<any>(`/api/image/face-recognition/${res.taskId}`)
    if (task && ['done', 'error', 'cancelled'].includes(task.status)) break
  }
  if (!task) throw new Error('任务超时')
  if (task.status !== 'done') throw new Error(task.error || task.message || task.status)
  const emb = task.result?.embeddings?.[0]
  if (!emb?.length) throw new Error('未检测到人脸')
  return emb
}

export async function registerFace(name: string, imageData: ImageData): Promise<RegisteredFace> {
  const embedding = await extractFaceEmbedding(imageData)
  const face: RegisteredFace = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: name.trim(),
    embedding,
    thumb: makeThumb(imageData),
    createdAt: Date.now()
  }
  const list = getRegisteredFaces().filter(f => f.name !== face.name)
  list.push(face)
  saveFaces(list)
  return face
}

export async function recognizeFace(imageData: ImageData): Promise<{ face: RegisteredFace; similarity: number } | null> {
  const embedding = await extractFaceEmbedding(imageData)
  const list = getRegisteredFaces()
  let best: RegisteredFace | null = null
  let bestSim = -1
  for (const f of list) {
    const sim = cosine(f.embedding, embedding)
    if (sim > bestSim) {
      bestSim = sim
      best = f
    }
  }
  if (!best || bestSim < MATCH_THRESHOLD) return null
  return { face: best, similarity: bestSim }
}

export function deleteFace(id: string): void {
  saveFaces(getRegisteredFaces().filter(f => f.id !== id))
}
