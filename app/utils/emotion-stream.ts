/**
 * 情绪识别的滑动窗口工具（纯函数，可单测）。
 * wav2vec2 情绪分类按「窗口」推理：麦克风采集 16kHz 音频 →
 * 攒够一个完整窗口即触发一次推理；推理期间继续采集，
 * 完成后若累计了新步进音频则立即用最新窗口再推理（重叠滑窗）。
 */
export const WINDOW_SECONDS = 3
export const WINDOW_LEN = 16000 * WINDOW_SECONDS // 48000
export const MIN_STEP_SECONDS = 1.5
export const MIN_STEP_LEN = 16000 * MIN_STEP_SECONDS // 24000

export interface WindowState {
  /** 已采集样本总数（16kHz） */
  total: number
  /** 滚动缓冲：始终保留最近 WINDOW_LEN 个样本 */
  buf: Float32Array
}

export function createWindowState(): WindowState {
  return { total: 0, buf: new Float32Array(WINDOW_LEN) }
}

/** 追加一帧 16kHz 音频，返回是否已攒满首个完整窗口 */
export function pushSamples(s: WindowState, chunk: Float32Array): boolean {
  const buf = s.buf
  if (chunk.length >= WINDOW_LEN) {
    buf.set(chunk.subarray(chunk.length - WINDOW_LEN) as Float32Array)
  } else {
    buf.copyWithin(0, chunk.length)
    buf.set(chunk, WINDOW_LEN - chunk.length)
  }
  s.total += chunk.length
  return s.total >= WINDOW_LEN
}

/** 取最近一次完整窗口（拷贝，可安全传给推理，推理期间缓冲继续滚动） */
export function latestWindow(s: WindowState): Float32Array {
  return s.buf.slice()
}

/** 自 lastAnalyzedTotal 后是否又积累了足够步进音频（防止推理空转） */
export function enoughStep(s: WindowState, lastAnalyzedTotal: number): boolean {
  return s.total - lastAnalyzedTotal >= MIN_STEP_LEN
}

/** 窗口相对时间（秒），用于时间线标签 */
export function windowTime(s: WindowState): number {
  return Math.max(0, (s.total - WINDOW_LEN) / 16000)
}
