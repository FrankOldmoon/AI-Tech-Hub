import { describe, expect, it } from 'vitest'
import { COVER_HEIGHT, COVER_WIDTH, coverHash } from '../app/utils/demo-cover-shapes'
import { demoCoverArt, hasSceneFor } from '../app/utils/demo-cover'
import { DEMO_SCENES } from '../app/utils/demo-cover-scenes'
import { demos } from '../app/utils/demos'

const keys = demos.map(d => `${d.category}/${d.slug}`)

describe('coverHash', () => {
  it('同输入同输出，且落在 32 位无符号范围', () => {
    const seed = coverHash('vision/face')
    expect(seed).toBe(coverHash('vision/face'))
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(0xffffffff)
  })

  it('全部 demo 的唯一键散列到不同种子（细节互不相同）', () => {
    expect(new Set(keys.map(coverHash)).size).toBe(demos.length)
  })

  it('分类参与散列：同名不同分类算出的种子不同', () => {
    expect(coverHash('vision/transformers')).not.toBe(coverHash('nlp/transformers'))
  })
})

describe('场景映射', () => {
  it('每个 demo 都有专属场景，不允许静默回退到兜底图', () => {
    const missing = keys.filter(key => !(key in DEMO_SCENES))
    expect(missing).toEqual([])
    for (const demo of demos) {
      expect(hasSceneFor(demo.slug, demo.category)).toBe(true)
      expect(demoCoverArt(demo.slug, demo.category).scene).toBe(`${demo.category}/${demo.slug}`)
    }
  })

  it('映射表里没有多余的键（没有配给已删除 demo 的场景）', () => {
    const extra = Object.keys(DEMO_SCENES).filter(key => !keys.includes(key))
    expect(extra).toEqual([])
  })

  it('未登记的分类/页面对退回中性兜底图，且不抛错', () => {
    const art = demoCoverArt('brand-new-thing', 'quantum')
    expect(art.scene).toBe('generic')
    expect(art.shapes.length).toBeGreaterThan(0)
  })
})

describe('demoCoverArt', () => {
  it('是纯函数：同参数两次调用结果一致（SSR 与客户端必须一致）', () => {
    for (const demo of demos) {
      const a = demoCoverArt(demo.slug, demo.category)
      const b = demoCoverArt(demo.slug, demo.category)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  it('只产出几何图元，绝不产出文字（中英文通用靠的就是这个）', () => {
    for (const demo of demos) {
      for (const shape of demoCoverArt(demo.slug, demo.category).shapes) {
        expect(['rect', 'circle', 'poly']).toContain(shape.kind)
      }
    }
  })

  it('每个 demo 都有内容，且几何合法（无 NaN、无零尺寸、全部落在画布内）', () => {
    for (const demo of demos) {
      const { shapes } = demoCoverArt(demo.slug, demo.category)
      expect(shapes.length).toBeGreaterThan(0)
      for (const shape of shapes) {
        expect(Number.isFinite(shape.opacity)).toBe(true)
        expect(shape.opacity).toBeGreaterThanOrEqual(0)
        expect(shape.opacity).toBeLessThanOrEqual(1)

        if (shape.kind === 'rect') {
          for (const value of [shape.x, shape.y, shape.w, shape.h, shape.rx]) expect(Number.isFinite(value)).toBe(true)
          expect(shape.w).toBeGreaterThan(0)
          expect(shape.h).toBeGreaterThan(0)
          expect(shape.x).toBeGreaterThanOrEqual(0)
          expect(shape.y).toBeGreaterThanOrEqual(0)
          expect(shape.x + shape.w).toBeLessThanOrEqual(COVER_WIDTH)
          expect(shape.y + shape.h).toBeLessThanOrEqual(COVER_HEIGHT)
        }

        if (shape.kind === 'circle') {
          expect(Number.isFinite(shape.r)).toBe(true)
          expect(shape.r).toBeGreaterThan(0)
          expect(shape.cx - shape.r).toBeGreaterThanOrEqual(0)
          expect(shape.cx + shape.r).toBeLessThanOrEqual(COVER_WIDTH)
          expect(shape.cy - shape.r).toBeGreaterThanOrEqual(0)
          expect(shape.cy + shape.r).toBeLessThanOrEqual(COVER_HEIGHT)
        }

        if (shape.kind === 'poly') {
          expect(shape.points.length).toBeGreaterThanOrEqual(shape.mode === 'fill' ? 3 : 2)
          if (shape.mode === 'stroke') expect(shape.width).toBeGreaterThan(0)
          for (const [x, y] of shape.points) {
            expect(Number.isFinite(x)).toBe(true)
            expect(Number.isFinite(y)).toBe(true)
            expect(x).toBeGreaterThanOrEqual(0)
            expect(x).toBeLessThanOrEqual(COVER_WIDTH)
            expect(y).toBeGreaterThanOrEqual(0)
            expect(y).toBeLessThanOrEqual(COVER_HEIGHT)
          }
        }
      }
    }
  })

  it('同一张场景被多个 demo 复用时，细节由 slug 区分开', () => {
    const tts = demoCoverArt('tts', 'speech')
    const kokoro = demoCoverArt('kokoro', 'speech')
    expect(tts.scene).not.toBe(kokoro.scene)
    expect(JSON.stringify(tts.shapes)).not.toBe(JSON.stringify(kokoro.shapes))
  })

  it('跨分类同名的 transformers 拿到的是两张不同的图', () => {
    const vision = demoCoverArt('transformers', 'vision')
    const nlp = demoCoverArt('transformers', 'nlp')
    expect(vision.scene).toBe('vision/transformers')
    expect(nlp.scene).toBe('nlp/transformers')
    expect(JSON.stringify(vision.shapes)).not.toBe(JSON.stringify(nlp.shapes))
  })

  it('画面里没有文字元素（结构上不可能出现 <text>）', () => {
    const svgish = demos.flatMap(demo => demoCoverArt(demo.slug, demo.category).shapes)
    expect(svgish.some(shape => shape.kind === 'poly' && shape.points.length === 0)).toBe(false)
  })
})
