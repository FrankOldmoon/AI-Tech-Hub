import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOUR_STEPS, markTourSeen, tourSeen } from '../app/program-world/tour'

/**
 * 导览里两件可以脱离浏览器验的事：
 *
 * 1. 步骤数据本身要成立 —— 每一步都得有目标和文案，目标还不能重复
 *    （两步指同一个元素，第二步的聚光等于白画）。
 * 2. 「看过没」这个标记的读写 —— 浏览器不给 localStorage 时不能把 Run 搞崩。
 *
 * 覆盖层本身（出现/点完不再出现）在真浏览器里验：tests/e2e/ide-tour.spec.ts。
 */

function fakeStore() {
  const map = new Map<string, string>()
  return {
    getItem(k: string) {
      return map.has(k) ? String(map.get(k)) : null
    },
    setItem(k: string, v: string) {
      map.set(k, String(v))
    }
  }
}

describe('TOUR_STEPS', () => {
  it('每一步都有目标、标题和正文', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(2)
    for (const [i, s] of TOUR_STEPS.entries()) {
      expect(typeof s.target, `第 ${i + 1} 步缺 target`).toBe('string')
      expect(s.target.length, `第 ${i + 1} 步的 target 是空的`).toBeGreaterThan(1)
      expect(s.title.length, `第 ${i + 1} 步缺标题`).toBeGreaterThan(0)
      expect(s.text.length, `第 ${i + 1} 步缺正文`).toBeGreaterThan(0)
      // '#' 是 id，'.' 是类名 —— 这两种选择器才配得上「一个具体控件」
      expect(/^[#.]/.test(s.target), `第 ${i + 1} 步的 target 不是 id/类选择器：${s.target}`).toBe(true)
    }
  })

  it('目标互不重复', () => {
    const targets = TOUR_STEPS.map(s => s.target)
    expect(new Set(targets).size).toBe(targets.length)
  })
})

describe('tourSeen / markTourSeen', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没标记时算没看过，标记之后算看过', () => {
    vi.stubGlobal('localStorage', fakeStore())
    expect(tourSeen()).toBe(false)
    markTourSeen()
    expect(tourSeen()).toBe(true)
  })

  it('localStorage 抛错时不崩，并且只是当作没看过', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      }
    })
    expect(tourSeen()).toBe(false)
    expect(() => markTourSeen()).not.toThrow()
  })
})
