import { describe, expect, it } from 'vitest'
import {
  createWindowState, pushSamples, latestWindow, enoughStep, windowTime,
  WINDOW_LEN, MIN_STEP_LEN
} from '../app/utils/emotion-stream'

function sine(freq: number, durSec: number, rate = 16000): Float32Array {
  const n = Math.floor(durSec * rate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * 0.5
  }
  return out
}

describe('emotion-stream 滑动窗口', () => {
  it('初始为空：未攒够窗口', () => {
    const s = createWindowState()
    expect(s.total).toBe(0)
    expect(pushSamples(s, new Float32Array(100))).toBe(false)
    expect(s.total).toBe(100)
  })

  it('连续追加攒够一个完整窗口', () => {
    const s = createWindowState()
    const chunk = new Float32Array(4096)
    let full = false
    for (let i = 0; i < Math.ceil(WINDOW_LEN / 4096); i++) {
      full = pushSamples(s, chunk)
    }
    expect(full).toBe(true)
    expect(s.total).toBeGreaterThanOrEqual(WINDOW_LEN)
  })

  it('滚动缓冲只保留最近 WINDOW_LEN 样本', () => {
    const s = createWindowState()
    const chunk = sine(440, 0.25) // 4000 样本
    pushSamples(s, chunk)
    pushSamples(s, chunk)
    expect(s.buf.length).toBe(WINDOW_LEN)
    // 缓冲尾部应是第二次追加的内容
    expect(s.buf[WINDOW_LEN - 1]).toBeCloseTo(chunk[chunk.length - 1]!, 5)
  })

  it('latestWindow 返回最近窗口的快照拷贝', () => {
    const s = createWindowState()
    pushSamples(s, sine(440, 4) as Float32Array) // 64000 样本 > 窗口
    const win = latestWindow(s)
    expect(win.length).toBe(WINDOW_LEN)
    // 快照与原缓冲互不影响
    win[0] = 999
    expect(s.buf[0]).not.toBe(999)
    // 快照内容对应当前缓冲尾部
    expect(win[WINDOW_LEN - 1]).toBeCloseTo(s.buf[WINDOW_LEN - 1]!, 5)
  })

  it('chunk 超过窗口长度时只保留其尾部', () => {
    const s = createWindowState()
    const big = sine(440, 5) as Float32Array // 80000 样本
    pushSamples(s, big)
    expect(s.total).toBe(big.length)
    const win = latestWindow(s)
    expect(win[WINDOW_LEN - 1]).toBeCloseTo(big[big.length - 1]!, 5)
  })

  it('enoughStep：达到步进阈值才允许再次推理', () => {
    const s = createWindowState()
    pushSamples(s, sine(440, 4) as Float32Array)
    const afterFirst = s.total
    expect(enoughStep(s, 0)).toBe(true) // 首窗口直接满足
    expect(enoughStep(s, afterFirst)).toBe(false) // 刚分析完，无新步进
    pushSamples(s, sine(440, 2) as Float32Array) // +32000
    expect(enoughStep(s, afterFirst)).toBe(true)
    expect(enoughStep(s, afterFirst + MIN_STEP_LEN)).toBe(false)
  })

  it('windowTime 返回窗口起始相对时间', () => {
    const s = createWindowState()
    pushSamples(s, sine(440, 4) as Float32Array)
    expect(windowTime(s)).toBeCloseTo(1, 0) // 4s - 3s = 1s
  })
})
