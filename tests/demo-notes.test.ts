import { describe, expect, it } from 'vitest'
import { allDemoNotes, normalizeNotePath } from '../app/utils/demo-notes'
import { demos } from '../app/utils/demos'

/**
 * 底部「延伸学习」内容的守门测试。
 *
 * 这类内容最容易出的错不是代码写错，而是**路径拼错**（`/robot/autodrive` vs
 * `/robot/auto-drive`）：页面照常渲染，注册表里那条内容却永远不会出现，
 * 而且不报错。所以这里做双向校验 —— 注册表里的 key 必须对应真实 demo，
 * 分类里每个 ready 的 demo 也必须有内容。
 *
 * 用 allDemoNotes() 而不是直接 import 某个分类：以后新增 `<分类>.ts` 会自动纳入校验，
 * 不需要改测试。
 */
const all = await allDemoNotes()
const entries = Object.entries(all)
const known = new Set(demos.map(d => `/${d.category}/${d.slug}`))
const categories = [...new Set(Object.values(all).map(n => n.category))]

describe('demo-notes 路径', () => {
  it('normalizeNotePath 去掉 query 与尾斜杠', () => {
    expect(normalizeNotePath('/robot/drone/')).toBe('/robot/drone')
    expect(normalizeNotePath('/robot/drone?tool=x')).toBe('/robot/drone')
    expect(normalizeNotePath('')).toBe('/')
  })

  it('至少收录了一个分类（glob 没失效）', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('每个 key 都能对上真实存在的 demo', () => {
    const unknown = entries.map(([path]) => path).filter(path => !known.has(path))
    expect(unknown).toEqual([])
  })

  it('key 与所属分类文件一致（robot.ts 里只放 /robot/*）', () => {
    const wrong = entries
      .filter(([, note]) => !note.category)
      .map(([path]) => path)
    expect(wrong).toEqual([])
    for (const [path, note] of entries) {
      expect(path.startsWith(`/${note.category}/`)).toBe(true)
    }
  })

  it('已收录的分类里，每个 ready 的 demo 都有内容（不会有页面悄悄没内容）', () => {
    const missing: string[] = []
    for (const category of categories) {
      for (const demo of demos) {
        if (demo.category !== category || demo.status !== 'ready') continue
        const path = `/${demo.category}/${demo.slug}`
        if (!(path in all)) missing.push(path)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('demo-notes 内容', () => {
  for (const [path, note] of entries) {
    describe(path, () => {
      it('Python 与 JavaScript 都是多行、非空、且语言不同', () => {
        expect(note.python.trim().length).toBeGreaterThan(200)
        expect(note.javascript.trim().length).toBeGreaterThan(200)
        expect(note.python.split('\n').length).toBeGreaterThanOrEqual(10)
        expect(note.javascript.split('\n').length).toBeGreaterThanOrEqual(10)
        expect(note.python).not.toBe(note.javascript)
      })

      it('原理说明中英都有，且足够长（不是一句话占位）', () => {
        expect(note.principle.zh.length).toBeGreaterThan(300)
        expect(note.principle.en.length).toBeGreaterThan(300)
        expect(note.principle.zh).not.toBe(note.principle.en)
        // 至少一个小标题，保证是结构化说明而不是一段流水账
        expect(note.principle.zh).toContain('##')
        expect(note.principle.en).toContain('##')
      })

      it('htmlDemo 若要填，必须是站内相对路径', () => {
        if (!note.htmlDemo) return
        expect(note.htmlDemo.startsWith('/')).toBe(true)
        expect(note.htmlDemo).not.toMatch(/^https?:/)
      })
    })
  }
})
