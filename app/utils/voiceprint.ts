/**
 * 纯浏览器端声纹注册 / 识别（WavLMForXVector，transformers.js）。
 * 模型在 /model/transformers/Xenova/wavlm-base-plus-sv 本地运行，数据不出浏览器，无需后端。
 * - 输入 16kHz 单声道 → 512 维说话人向量（x-vector）
 * - localStorage 注册库（多样张：同名追加 sample，识别时取该人最高相似度）
 * - 阈值可调：调高更严格（少误认、多认不出），调低更宽松
 * 与 app/utils/face-studio.ts 结构对称，区别是「人脸嵌入」换成「说话人嵌入」。
 * 注意：所有函数只在浏览器端使用；模块顶层不做任何 window/localStorage 访问（SSR 安全）。
 */
import { preferredDevice, setupTransformersEnv } from './transformers'

export interface VoiceSample {
  id: string
  /** x-vector（wavlm-base-plus-sv 为 512 维） */
  embedding: number[]
  /** 参考音频时长（秒），便于回溯样本质量 */
  seconds: number
  createdAt: number
}

export interface VoicePrint {
  id: string
  name: string
  samples: VoiceSample[]
  createdAt: number
}

export interface VoiceRank {
  name: string
  similarity: number
  /** 是否达到阈值 */
  accepted: boolean
}

export interface VoiceMatch {
  name: string
  similarity: number
  sample: VoiceSample
}

export type VoiceDtype = 'q8' | 'fp32'

const MODEL_ID = 'Xenova/wavlm-base-plus-sv'
const STORAGE_KEY = 'aihub.voiceprints.v1'

/** 默认判定阈值：同一人通常 >0.6，不同人通常 <0.3，0.5 是常用分界 */
export const DEFAULT_THRESHOLD = 0.5
/** 参考音最短时长（秒）：太短则嵌入不稳 */
export const MIN_AUDIO_SECONDS = 1

/** 按 dtype 缓存已加载模型（切换 q8 / fp32 时互不干扰） */
const modelCache = new Map<VoiceDtype, Promise<VoiceprintModel>>()

interface VoiceprintModel {
  processor: (audio: Float32Array) => Promise<unknown>
  model: (inputs: unknown) => Promise<{ embeddings?: { data: Float32Array | number[] } }>
  device: string
}

export interface VoiceLoadProgress {
  status: string
  file?: string
  progress?: number
}

/**
 * 懒加载声纹模型（processor + WavLMForXVector）。
 * 默认 q8（约 97MB）；fp32 更精确但约 384MB。两份都已随 `pnpm models:fetch voiceprint` 预取。
 */
export async function ensureVoiceprintModelLoaded(
  dtype: VoiceDtype = 'q8',
  onProgress?: (p: VoiceLoadProgress) => void
): Promise<VoiceprintModel> {
  if (typeof window === 'undefined') throw new Error('仅可在浏览器端运行')
  const cached = modelCache.get(dtype)
  if (cached) return cached

  const promise = (async () => {
    await setupTransformersEnv()
    const { AutoProcessor, WavLMForXVector } = await import('@huggingface/transformers')
    const processor = await AutoProcessor.from_pretrained(MODEL_ID) as unknown as VoiceprintModel['processor']
    const device = preferredDevice()
    let usedDevice = device
    console.info(`[voiceprint] 加载说话人模型 ${MODEL_ID} · dtype=${dtype} · device=${device}`)
    const opts = { dtype, device, progress_callback: onProgress }
    let model: VoiceprintModel['model']
    try {
      model = await WavLMForXVector.from_pretrained(MODEL_ID, opts as never) as unknown as VoiceprintModel['model']
    } catch (e) {
      // WebGPU 个别算子不支持时回退 WASM
      if (device === 'webgpu') {
        usedDevice = 'wasm'
        model = await WavLMForXVector.from_pretrained(MODEL_ID, { ...opts, device: 'wasm' } as never) as unknown as VoiceprintModel['model']
      } else {
        throw e
      }
    }
    return { processor, model, device: usedDevice }
  })()

  modelCache.set(dtype, promise)
  // 加载失败不留缓存，方便用户重试
  promise.catch(() => modelCache.delete(dtype))
  return promise
}

/** 提取说话人向量（输入需为 16kHz 单声道 Float32Array） */
export async function extractVoiceEmbedding(
  audio: Float32Array,
  dtype: VoiceDtype = 'q8',
  onProgress?: (p: VoiceLoadProgress) => void
): Promise<{ embedding: number[], device: string }> {
  const m = await ensureVoiceprintModelLoaded(dtype, onProgress)
  const inputs = await m.processor(audio)
  const out = await m.model(inputs)
  const data = out?.embeddings?.data
  if (!data) throw new Error('模型未返回说话人向量')
  return { embedding: Array.from(data), device: m.device }
}

// ============================================================
// 向量工具（纯函数，可单测）
// ============================================================

/** 余弦相似度；任一向量为零向量时返回 0 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** L2 归一化（入库前调用，方便直接点积比较） */
export function l2normalize(vec: number[]): number[] {
  let sum = 0
  for (const v of vec) sum += v * v
  const norm = Math.sqrt(sum)
  if (norm === 0) return vec.slice()
  return vec.map(v => v / norm)
}

/** 多人对比：按相似度降序返回全部注册人（便于展示 Top-N 与阈值效果） */
export function rankVoiceprints(
  embedding: number[],
  registry: VoicePrint[],
  threshold: number = DEFAULT_THRESHOLD
): VoiceRank[] {
  const best = new Map<string, number>()
  for (const person of registry) {
    let top = -1
    for (const s of person.samples) {
      const sim = cosineSimilarity(embedding, s.embedding)
      if (sim > top) top = sim
    }
    if (top > -1) best.set(person.name, top)
  }
  return Array.from(best, ([name, similarity]) => ({ name, similarity, accepted: similarity >= threshold }))
    .sort((a, b) => b.similarity - a.similarity)
}

/** 最佳命中；低于阈值返回 null */
export function matchVoiceprint(
  embedding: number[],
  registry: VoicePrint[],
  threshold: number = DEFAULT_THRESHOLD
): VoiceMatch | null {
  let best: VoiceMatch | null = null
  for (const person of registry) {
    for (const s of person.samples) {
      const sim = cosineSimilarity(embedding, s.embedding)
      if (!best || sim > best.similarity) best = { name: person.name, similarity: sim, sample: s }
    }
  }
  return best && best.similarity >= threshold ? best : null
}

// ============================================================
// localStorage 注册库
// ============================================================

function loadStore(): VoicePrint[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as VoicePrint[] : []
  } catch {
    return []
  }
}

function saveStore(list: VoicePrint[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function getVoiceprints(): VoicePrint[] {
  return loadStore()
}

/** 注册一条声纹：同名则追加 sample（多样张），否则新建 */
export function enrollVoiceprint(name: string, embedding: number[], seconds = 0): VoicePrint[] {
  const list = loadStore()
  const trimmed = name.trim()
  const sample: VoiceSample = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    embedding: l2normalize(embedding),
    seconds: Math.round(seconds * 10) / 10,
    createdAt: Date.now()
  }
  const existing = list.find(p => p.name === trimmed)
  if (existing) {
    existing.samples.push(sample)
  } else {
    list.push({ id: sample.id, name: trimmed, samples: [sample], createdAt: Date.now() })
  }
  saveStore(list)
  return list
}

export function removeVoiceprint(id: string): VoicePrint[] {
  const list = loadStore().filter(p => p.id !== id)
  saveStore(list)
  return list
}

export function clearVoiceprints(): VoicePrint[] {
  saveStore([])
  return []
}
