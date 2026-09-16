/**
 * 录制文件 → SRT 字幕（本地 Whisper）。
 *
 * 与 app/utils/audio-engines/whisper.ts 的关系：那个是「注册表工具」，吃的是 playground
 * 已经解好的 16k 样本，输出是「文本 + 分段」；这里吃的是刚录出来的 Blob（自己要解码），
 * 输出直接是 SRT。所以共用同一套环境初始化与调用参数（return_timestamps + 30s/5s 滑窗），
 * 但保持两个模块独立——硬合并会让注册表工具多背一个「解码 Blob」的职责。
 *
 * 识别语言由调用方决定（页面按界面语言传 chinese / english），这里不猜。
 */
import { decodeTo16k } from '~/utils/audio'
import { parseDownloadProgress } from '~/utils/audio-progress'
import { toSrt, type SubtitleSegment } from '~/utils/srt'
import { preferredDevice, setupTransformersEnv } from '~/utils/transformers'

export const whisperSubtitleModels = [
  'Xenova/whisper-tiny',
  'Xenova/whisper-base',
  'Xenova/whisper-small'
] as const
export type WhisperSubtitleModel = typeof whisperSubtitleModels[number]

/** 当前阶段：解码音轨 / 加载模型 / 识别 */
export type SubtitleStage = 'decode' | 'load' | 'transcribe'

export interface SubtitleHooks {
  /** 模型下载进度（0..100）与当前文件 */
  onProgress?: (percent: number, file: string) => void
  onStage?: (stage: SubtitleStage) => void
}

export interface SubtitleResult {
  /** 可直接落盘的 SRT 文本；没识别到语音时为空串 */
  srt: string
  segments: SubtitleSegment[]
  /** 音频时长（秒） */
  duration: number
  device: 'webgpu' | 'wasm'
}

/**
 * 选出真正可用的 device。
 *
 * 不能直接用 `preferredDevice()`：它靠 `'gpu' in navigator` 判断（见 utils/transformers.ts），
 * 而有些环境里 `navigator.gpu` 存在却拿不到适配器（无头 Chrome、部分 Linux/无独显机器），
 * 这时按 webgpu 建会话会直接抛 "Failed to get GPU adapter"。这里先真的请求一次适配器。
 */
async function usableDevice(): Promise<'webgpu' | 'wasm'> {
  if (preferredDevice() !== 'webgpu') return 'wasm'
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    const adapter = gpu ? await gpu.requestAdapter() : null
    return adapter ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
}

export async function transcribeToSrt(
  media: Blob,
  options: { model: WhisperSubtitleModel, language: string },
  hooks: SubtitleHooks = {}
): Promise<SubtitleResult> {
  hooks.onStage?.('decode')
  const samples = await decodeTo16k(media)
  const duration = samples.length / 16000

  hooks.onStage?.('load')
  await setupTransformersEnv()
  const { pipeline } = await import('@huggingface/transformers')
  let device = await usableDevice()
  const onProgress = (raw: unknown) => {
    const parsed = parseDownloadProgress(raw)
    if (parsed) hooks.onProgress?.(parsed.percent, parsed.file)
  }
  const build = (dev: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', options.model, {
      dtype: 'q8',
      device: dev,
      progress_callback: onProgress
    })

  let transcriber: Awaited<ReturnType<typeof build>>
  try {
    transcriber = await build(device)
  } catch (e) {
    // 兜底：预检通过但建会话仍失败（例如适配器随后失效）时退回 WASM
    if (device !== 'webgpu') throw e
    device = 'wasm'
    transcriber = await build('wasm')
  }

  hooks.onStage?.('transcribe')
  const output = await transcriber(samples, {
    language: options.language,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true
  })

  const chunks = Array.isArray(output.chunks) ? output.chunks : []
  const segments: SubtitleSegment[] = chunks.map(c => ({
    start: c.timestamp?.[0] ?? 0,
    // 末段的 timestamp[1] 常为 null，交给 toSrt 兜底
    end: c.timestamp?.[1] ?? null,
    text: (c.text || '').trim()
  }))

  return { srt: toSrt(segments, duration), segments, duration, device }
}
