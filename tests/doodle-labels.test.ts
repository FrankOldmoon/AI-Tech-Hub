/**
 * 简笔画标签的展示映射。
 * 模型给的是英文原始标签（下划线/连字符），中文界面要给出中文名 —— 错映射会让学生看到
 * 「一张画着披萨的图被识别成 hot dog」这类观感事故（历史：hockey_puck 曾显示为 "hockey puck"）。
 */
import { describe, expect, it } from 'vitest'
import { DOODLE_ZH, formatDoodleLabel } from '../app/utils/doodle-labels'

describe('DOODLE_ZH 映射表', () => {
  it('中文名都非空，且 key 都是模型的原始写法', () => {
    const entries = Object.entries(DOODLE_ZH)
    expect(entries.length).toBeGreaterThan(0)
    for (const [raw, zh] of entries) {
      expect(zh.trim(), raw).not.toBe('')
      expect(raw, raw).not.toMatch(/\s/)
    }
  })
})

describe('formatDoodleLabel', () => {
  it('中文模式命中映射表时给中文名', () => {
    const raw = Object.keys(DOODLE_ZH)[0]!
    expect(formatDoodleLabel(raw, true)).toBe(DOODLE_ZH[raw])
  })

  it('中文模式未命中时把下划线/连字符换成空格（而不是显示原始串）', () => {
    expect(formatDoodleLabel('some_unknown_thing', true)).toBe('some unknown thing')
    expect(formatDoodleLabel('a-b-c', true)).toBe('a b c')
  })

  it('英文模式一律只做符号替换', () => {
    const raw = Object.keys(DOODLE_ZH)[0]!
    expect(formatDoodleLabel(raw, false)).toBe(raw.replace(/[_-]/g, ' '))
    expect(formatDoodleLabel('hot_dog', false)).toBe('hot dog')
  })

  it('空串不抛错', () => {
    expect(formatDoodleLabel('', true)).toBe('')
    expect(formatDoodleLabel('', false)).toBe('')
  })
})
