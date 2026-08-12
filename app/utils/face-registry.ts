/**
 * 人脸注册与识别（浏览器本地注册库 + Python insightface 嵌入）。
 *
 * - 注册：一人可上传多张照片（多样张），每张照片可指定用哪张脸（支持合影选脸），
 *   后端提取 512 维嵌入后以 samples[] 形式存入 localStorage；同名默认追加样张。
 * - 识别：上传照片 → 提取嵌入 → 与每人全部样张逐个算余弦相似度，取每人最高分，
 *   返回最佳匹配与 Top-N 候选。
 * - 依赖：/api/image/face-recognition 异步队列（insightface，venv 未就绪时优雅报错）。
 */

export interface FaceSample {
  id: string
  embedding: number[]
  thumb?: string
  createdAt: number
}

export interface RegisteredFace {
  id: string
  name: string
  samples: FaceSample[]
  createdAt: number
}

/** 单张图的分析结果（后端 recognition 模式返回全部人脸） */
export interface FaceAnalysis {
  faces: number
  embeddings: number[][]
  /** 每张脸的像素框 [x1, y1, x2, y2]（insightface 原图坐标） */
  bboxes: number[][]
  detScores?: number[]
}

export interface FaceCandidate {
  name: string
  similarity: number
  sampleId?: string
}

const STORAGE_KEY = 'imglab:faces:v2'
const LEGACY_KEY = 'imglab:faces:v1'
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

/** 整图居中裁剪为方形缩略图 */
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
  const side = Math.min(imageData.width, imageData.height)
  const sx = (imageData.width - side) / 2
  const sy = (imageData.height - side) / 2
  ctx.drawImage(src, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.8)
}

/** 按 bbox（带 padding）裁剪人脸缩略图 */
function makeFaceThumb(imageData: ImageData, bbox: number[]): string {
  const size = 96
  const [x1, y1, x2, y2] = bbox
  const w = x2 - x1
  const h = y2 - y1
  const padX = w * 0.3
  const padY = h * 0.3
  const sx = Math.max(0, x1 - padX)
  const sy = Math.max(0, y1 - padY)
  const sw = Math.min(imageData.width - sx, w + padX * 2)
  const sh = Math.min(imageData.height - sy, h + padY * 2)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const src = document.createElement('canvas')
  src.width = imageData.width
  src.height = imageData.height
  src.getContext('2d')!.putImageData(imageData, 0, 0)
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export function getRegisteredFaces(): RegisteredFace[] {
  if (import.meta.server) return []
  try {
    // 迁移 v1（单嵌入）→ v2（多样张）
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const old = JSON.parse(legacy) as Array<{ id: string; name: string; embedding: number[]; thumb?: string; createdAt: number }>
      const migrated: RegisteredFace[] = old.map(f => ({
        id: f.id,
        name: f.name,
        createdAt: f.createdAt,
        samples: [{
          id: `${f.id}-s0`,
          embedding: f.embedding,
          thumb: f.thumb,
          createdAt: f.createdAt
        }]
      }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_KEY)
      return migrated
    }
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

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)
}

/**
 * 提交单张图到后端并轮询，返回全部人脸分析结果。
 * 注意：GET 响应是 { ok, task }，这里必须解包，否则会无限轮询。
 */
export async function analyzeFace(
  imageData: ImageData,
  opts?: { onStatus?: (s: { status: string; message: string; progress: number }) => void }
): Promise<FaceAnalysis> {
  const form = new FormData()
  form.append('file', dataUrlToBlob(toDataUrl(imageData)), 'face.png')
  form.append('mode', 'recognition')
  const res = await $fetch<any>('/api/image/face-recognition', { method: 'POST', body: form })
  if (!res?.ok) throw new Error(res?.error || '提交任务失败')
  const deadline = Date.now() + 10 * 60 * 1000
  let task: any = null
  while (Date.now() < deadline) {
    await sleep(1000)
    const body = await $fetch<any>(`/api/image/face-recognition/${res.taskId}`)
    task = body?.task ?? body
    if (task && ['done', 'error', 'cancelled'].includes(task.status)) break
    opts?.onStatus?.({
      status: task?.status ?? 'queued',
      message: task?.message ?? '',
      progress: task?.progress ?? 0
    })
  }
  if (!task) throw new Error('任务超时')
  if (task.status !== 'done') throw new Error(task.error || task.message || task.status)
  const r = task.result || {}
  if (!Array.isArray(r.embeddings) || !r.embeddings.length) {
    throw new Error('未检测到人脸')
  }
  return {
    faces: r.faces ?? r.embeddings.length,
    embeddings: r.embeddings,
    bboxes: r.bboxes ?? [],
    detScores: r.det_scores
  }
}

/** 提取第 faceIndex 张脸的嵌入（analyzeFace 的便捷封装） */
export async function extractFaceEmbedding(imageData: ImageData, faceIndex = 0): Promise<number[]> {
  const a = await analyzeFace(imageData)
  if (faceIndex >= a.embeddings.length) throw new Error('人脸序号超出范围')
  return a.embeddings[faceIndex]
}

/**
 * 注册/追加样张：同名存在则追加 samples（不覆盖），否则新建。
 * 返回更新后的注册人记录。
 */
export function addFaceSamples(
  name: string,
  samples: Array<{ embedding: number[]; thumb?: string }>
): { person: RegisteredFace; appended: number; created: boolean } {
  const list = getRegisteredFaces()
  const trimmed = name.trim()
  let person = list.find(f => f.name === trimmed)
  const now = Date.now()
  const newSamples: FaceSample[] = samples.map(s => ({
    id: uid(),
    embedding: s.embedding,
    thumb: s.thumb,
    createdAt: now
  }))
  if (!person) {
    person = { id: uid(), name: trimmed, samples: [], createdAt: now }
    list.push(person)
  }
  person.samples.push(...newSamples)
  saveFaces(list)
  return { person, appended: newSamples.length, created: newSamples.length === person.samples.length }
}

/** 覆盖注册：清空该人已有样张后写入新样张 */
export function replaceFaceSamples(
  name: string,
  samples: Array<{ embedding: number[]; thumb?: string }>
): RegisteredFace {
  const { person } = addFaceSamples(name, [])
  person.samples = samples.map(s => ({
    id: uid(),
    embedding: s.embedding,
    thumb: s.thumb,
    createdAt: Date.now()
  }))
  saveFaces(getRegisteredFaces())
  return person
}

/**
 * 识别：probe 与每人全部样张逐一比对，取每人最高相似度；
 * 返回按相似度降序的候选列表；best 为最高分（低于阈值时为 null）。
 */
export function recognizeEmbeddings(embeddings: number[][]): { best: FaceCandidate | null; candidates: FaceCandidate[] } {
  const list = getRegisteredFaces()
  const candidates: FaceCandidate[] = list.map(person => {
    let bestSim = -1
    let bestSampleId: string | undefined
    for (const probe of embeddings) {
      for (const s of person.samples) {
        const sim = cosine(s.embedding, probe)
        if (sim > bestSim) {
          bestSim = sim
          bestSampleId = s.id
        }
      }
    }
    return { name: person.name, similarity: bestSim, sampleId: bestSampleId }
  }).sort((a, b) => b.similarity - a.similarity)
  const best = candidates[0] && candidates[0].similarity >= MATCH_THRESHOLD ? candidates[0] : null
  return { best, candidates }
}

/** 识别：先分析单张图，再与注册库比对 */
export async function recognizeFace(
  imageData: ImageData,
  faceIndex = 0
): Promise<{ best: FaceCandidate | null; candidates: FaceCandidate[] }> {
  const embedding = await extractFaceEmbedding(imageData, faceIndex)
  return recognizeEmbeddings([embedding])
}

export function deleteFace(id: string): void {
  saveFaces(getRegisteredFaces().filter(f => f.id !== id))
}

export function deleteFaceSample(personId: string, sampleId: string): void {
  const list = getRegisteredFaces()
  const person = list.find(f => f.id === personId)
  if (!person) return
  person.samples = person.samples.filter(s => s.id !== sampleId)
  saveFaces(list)
}

export { MATCH_THRESHOLD, makeFaceThumb, makeThumb, toDataUrl, dataUrlToBlob }
