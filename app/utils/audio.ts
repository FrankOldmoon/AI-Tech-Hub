// 语音模块共用工具：音频编解码 + 单声道重采样
// 各分析页（asr/emotion/audio-classifier/pitch）均以 16kHz 单声道 Float32Array 作为输入

/** 音频文件选择框的 accept 串（此前在 6+ 个页面里各写一份，且互有出入） */
export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac'

/** 用 AudioContext 解码任意音频文件为 AudioBuffer */
export async function decodeAudio(file: File | Blob): Promise<AudioBuffer> {
  const buf = await file.arrayBuffer()
  const Ctor: typeof AudioContext
    = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctor()
  try {
    return await ctx.decodeAudioData(buf)
  } finally {
    ctx.close()
  }
}

/**
 * 解码并重采样到指定采样率的**单声道** Float32Array。
 *
 * 只取第 0 声道、用最近邻抽样重采样（与历史实现一致，未做抗混叠滤波）。
 * 想改进音质的话这两点都要单独评估——会改变各模型的实际输入，属于行为变更而非重构。
 */
export async function decodeToRate(file: File | Blob, targetRate: number): Promise<Float32Array> {
  const audio = await decodeAudio(file)
  const src = audio.getChannelData(0)
  if (audio.sampleRate === targetRate) return src.slice()
  const ratio = audio.sampleRate / targetRate
  const out = new Float32Array(Math.floor(src.length / ratio))
  for (let i = 0; i < out.length; i++) {
    out[i] = src[Math.floor(i * ratio)] ?? 0
  }
  return out
}

/**
 * 解码并重采样到 16kHz 单声道（Whisper / YAMNet / wav2vec 等模型期望格式）。
 * 返回 16kHz 的 Float32Array（0..1 幅度）。
 */
export async function decodeTo16k(file: File | Blob): Promise<Float32Array> {
  return decodeToRate(file, 16000)
}

/** 从文件创作一个可播放的 object URL（调用方负责 revoke） */
export function fileObjectUrl(file: File | Blob): string {
  return URL.createObjectURL(file)
}
