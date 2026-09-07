// 语音模块共用工具：音频编解码 + 16kHz 单声道重采样
// 各分析页（asr/emotion/audio-classifier/pitch）均以 16kHz 单声道 Float32Array 作为输入

/** 用 AudioContext 解码任意音频文件为 AudioBuffer */
export async function decodeAudio(file: File): Promise<AudioBuffer> {
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
 * 解码并重采样到 16kHz 单声道（Whisper / YAMNet / wav2vec 等模型期望格式）。
 * 返回 16kHz 的 Float32Array（0..1 幅度）。
 */
export async function decodeTo16k(file: File): Promise<Float32Array> {
  const audio = await decodeAudio(file)
  const src = audio.getChannelData(0)
  const targetRate = 16000
  if (audio.sampleRate === targetRate) return src.slice()
  const ratio = audio.sampleRate / targetRate
  const out = new Float32Array(Math.floor(src.length / ratio))
  for (let i = 0; i < out.length; i++) {
    out[i] = src[Math.floor(i * ratio)] ?? 0
  }
  return out
}

/** 从文件创作一个可播放的 object URL（调用方负责 revoke） */
export function fileObjectUrl(file: File | Blob): string {
  return URL.createObjectURL(file)
}
