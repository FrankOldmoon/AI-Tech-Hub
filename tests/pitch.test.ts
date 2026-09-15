import { describe, expect, it } from 'vitest'
import { freqToName, mergeLivePitch, yinPitch, type PitchNote } from '../app/utils/pitch'

/** 生成 16kHz 单声道正弦波（持续时间由采样数决定） */
function sineWave(freq: number, sampleRate: number, samples: number): Float32Array {
  const buf = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5
  }
  return buf
}

/** 模拟实时：按 4096 样本帧逐帧喂入 YIN + 音符合并，返回切分出的音符流 */
function simulateLive(freqs: Array<{ freq: number, dur: number }>, sampleRate = 16000): PitchNote[] {
  const notes: PitchNote[] = []
  let elapsed = 0
  for (const seg of freqs) {
    const samples = sineWave(seg.freq, sampleRate, Math.round(seg.dur * sampleRate))
    const frameSize = 4096
    for (let off = 0; off < samples.length; off += frameSize) {
      const frame = samples.subarray(off, off + frameSize) as Float32Array
      if (frame.length < 2048) break
      const t = (elapsed + off) / sampleRate
      const res = yinPitch(frame.subarray(0, 2048) as Float32Array, sampleRate, 0.15, 70, 900)
      if (res && res.clarity > 0.5) mergeLivePitch(notes, res, t)
    }
    elapsed += samples.length
  }
  return notes
}

describe('yinPitch', () => {
  it('能检出纯净正弦波基频（A4=440Hz）', () => {
    const buf = sineWave(440, 16000, 2048)
    const res = yinPitch(buf, 16000, 0.15, 70, 900)
    expect(res).not.toBeNull()
    expect(res!.freq).toBeCloseTo(440, 0)
    expect(res!.clarity).toBeGreaterThan(0.5)
  })

  it('对静音或噪声（低幅值）返回 null', () => {
    const buf = new Float32Array(2048)
    const res = yinPitch(buf, 16000, 0.15, 70, 900)
    expect(res).toBeNull()
  })
})

describe('freqToName', () => {
  it('440Hz → A4', () => {
    expect(freqToName(440).name).toBe('A4')
  })
  it('523.25Hz（C5）→ C5', () => {
    expect(freqToName(523.25).name).toBe('C5')
  })
  it('660Hz 附近的 E5 落点正确', () => {
    expect(freqToName(659.25).name).toBe('E5')
  })
})

describe('mergeLivePitch（实时音符合并）', () => {
  it('同半音帧延长最后一个音符，不新增', () => {
    const notes: PitchNote[] = [{ freq: 440, name: 'A4', syll: 'la', start: 0, end: 0.1 }]
    const r = mergeLivePitch(notes, { freq: 441 }, 0.2)
    expect(r).toBe('extend')
    expect(notes).toHaveLength(1)
    expect(notes[0]!.end).toBeCloseTo(0.2)
  })

  it('换半音开新音符', () => {
    const notes: PitchNote[] = [{ freq: 440, name: 'A4', syll: 'la', start: 0, end: 0.1 }]
    const r = mergeLivePitch(notes, { freq: 523.25 }, 0.2)
    expect(r).toBe('append')
    expect(notes).toHaveLength(2)
    expect(notes[1]!.name).toBe('C5')
  })
})

describe('simulateLive（整段实时切分行为）', () => {
  it('do-re-mi 三段音切出 3 个音符且音名正确', () => {
    const notes = simulateLive([
      { freq: 261.63, dur: 0.5 }, // C4 do
      { freq: 293.66, dur: 0.5 }, // D4 re
      { freq: 329.63, dur: 0.5 } // E4 mi
    ])
    expect(notes).toHaveLength(3)
    expect(notes[0]!.name).toBe('C4')
    expect(notes[0]!.syll).toBe('do')
    expect(notes[1]!.name).toBe('D4')
    expect(notes[1]!.syll).toBe('re')
    expect(notes[2]!.name).toBe('E4')
    expect(notes[2]!.syll).toBe('mi')
    // 时间轴随帧推进，end >= start
    for (const n of notes) expect(n.end).toBeGreaterThanOrEqual(n.start)
  })

  it('同一音持续 1 秒只产生一个音符，end 覆盖全长', () => {
    const notes = simulateLive([{ freq: 440, dur: 1.0 }])
    expect(notes).toHaveLength(1)
    expect(notes[0]!.name).toBe('A4')
    expect(notes[0]!.end - notes[0]!.start).toBeGreaterThan(0.5)
  })
})
