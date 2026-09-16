/**
 * 实时音高检测与音符切分工具（纯函数，可单测）
 * 供 speech 页麦克风实时识别与文件分析共用；逻辑与 pitch-detector 页面一致。
 */

export interface PitchNote {
  freq: number
  name: string
  syll: string
  start: number
  end: number
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
/** 12 半音唱名（与 NOTE_NAMES 一一对应）：C→do … A→la、A#→la#、B→si */
export const SCALE = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'] as const

/** 以 C 大调（do=C）将频率量化为音名 */
export function freqToName(f: number): { name: string, syll: string } {
  const midi = 69 + 12 * Math.log2(f / 440)
  const r = Math.round(midi)
  const idx = ((r % 12) + 12) % 12
  const name = NOTE_NAMES[idx]!
  const oct = Math.floor(r / 12) - 1
  return { name: `${name}${oct}`, syll: SCALE[idx]! }
}

/**
 * 频率 → 音名 + 偏差音分（±50¢）。
 * pitch-detector 页面原先自带一份（freqToNote + midiToNote + NOTE_NAMES），
 * 搬过来时只把「偏差」这一项加在这里，音名仍复用 freqToName，避免出现第二份音名换算。
 */
export function freqToNote(f: number): { note: string, cents: number } {
  const midi = 69 + 12 * Math.log2(f / 440)
  const cents = Math.round((midi - Math.round(midi)) * 100)
  return { note: freqToName(f).name, cents }
}

/** YIN 基频检测（CMND + 抛物线插值），返回 { freq, clarity } 或 null */
export function yinPitch(
  buffer: Float32Array,
  sampleRate: number,
  threshold: number,
  minF: number,
  maxF: number
): { freq: number, clarity: number } | null {
  const len = buffer.length
  const half = Math.floor(len / 2)
  if (half < 4) return null
  const cmnd = new Float32Array(half)
  cmnd[0] = 1
  let sum = 0
  for (let tau = 1; tau < half; tau++) {
    let diff = 0
    for (let i = 0; i < half; i++) {
      const d = buffer[i]! - buffer[i + tau]!
      diff += d * d
    }
    sum += diff
    cmnd[tau] = sum > 0 ? (diff * tau) / sum : 1
  }
  let tau = -1
  for (let q = 2; q < half - 1; q++) {
    if (cmnd[q]! < threshold && cmnd[q]! < cmnd[q - 1]! && cmnd[q]! < cmnd[q + 1]!) {
      tau = q
      break
    }
  }
  if (tau === -1) {
    let min = 1
    for (let q = 2; q < half - 1; q++) {
      if (cmnd[q]! < min) {
        min = cmnd[q]!
        tau = q
      }
    }
    if (min > threshold) return null
  }
  const s0 = cmnd[tau - 1]!
  const s1 = cmnd[tau]!
  const s2 = cmnd[tau + 1]!
  const denom = s0 - 2 * s1 + s2
  const shift = denom !== 0 ? (s0 - s2) / (2 * denom) : 0
  const period = tau + shift
  const f = sampleRate / period
  if (f < minF || f > maxF) return null
  return { freq: f, clarity: Math.max(0, Math.min(1, 1 - s1)) }
}

/**
 * 单帧实时切分：把一次检测结果并入音符流（就地修改数组）。
 * 相邻帧同半音 → 延长最后一个音符；否则开新音符。
 * 返回 'extend' | 'append'，便于调用方跟踪状态。
 */
export function mergeLivePitch(notes: PitchNote[], res: { freq: number }, t: number): 'extend' | 'append' {
  const n = freqToName(res.freq)
  const last = notes[notes.length - 1]
  if (last && last.name === n.name) {
    last.end = t
    return 'extend'
  }
  notes.push({ freq: res.freq, name: n.name, syll: n.syll, start: t, end: t })
  return 'append'
}
