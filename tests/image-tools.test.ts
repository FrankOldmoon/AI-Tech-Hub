/**
 * 视觉工具注册表的完整性契约。
 *
 * 它是 vision 下所有能力页/引擎页/工坊页的唯一驱动数据：侧栏、输入、参数、运行全按它渲染。
 * 一处笔误（重复 id、page 拼错、少个英文名）的表现是「某个算子静默消失」或「点开报错」，
 * 而页面本身不会崩 —— 所以在这里把结构钉死。
 */
import { describe, expect, it } from 'vitest'
import {
  getImageTool,
  imagePageSamples,
  imageTools,
  imageToolsByPage,
  toolPages,
  type ImageToolKind
} from '../app/utils/image-tools'

const KINDS: ImageToolKind[] = ['canvas', 'opencv', 'mediapipe', 'transformers', 'tesseract', 'yolo', 'tfjs']

describe('注册表结构', () => {
  it('非空，且 id 唯一（id 是页面选择工具与外发深链的键）', () => {
    expect(imageTools.length).toBeGreaterThan(0)
    const ids = imageTools.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个工具都有中英名与合法的 kind', () => {
    for (const tool of imageTools) {
      expect(tool.name.zh.trim(), tool.id).not.toBe('')
      expect(tool.name.en.trim(), tool.id).not.toBe('')
      expect(KINDS, tool.id).toContain(tool.kind)
    }
  })

  it('每个工具至少归属一个页面（否则侧栏永远看不到它）', () => {
    for (const tool of imageTools) {
      expect(toolPages(tool).length, `${tool.id} 没有 page/pages`).toBeGreaterThan(0)
    }
  })

  it('pages 与 page 同时出现时以 pages 为准（接口约定）', () => {
    const dual = imageTools.find(t => t.pages && t.page)
    if (!dual) return
    expect(toolPages(dual)).toEqual(dual.pages)
  })

  it('planned 只是「暂不执行」，仍须挂在本分类下可见', () => {
    for (const tool of imageTools.filter(t => t.planned)) {
      expect(toolPages(tool).length, `${tool.id} 标了 planned 却没有归属页`).toBeGreaterThan(0)
    }
  })

  it('需要手绘输入的工具不该同时又要求第二张图（输入源会互相顶掉）', () => {
    for (const tool of imageTools) {
      if (tool.needsDrawing) expect(tool.needsSecondImage, tool.id).toBeFalsy()
    }
  })
})

describe('按页查询', () => {
  it('imageToolsByPage 返回的工具都确实声称属于该页', () => {
    const pages = new Set(imageTools.flatMap(t => toolPages(t)))
    for (const page of pages) {
      const list = imageToolsByPage(page)
      expect(list.length, page).toBeGreaterThan(0)
      for (const tool of list) {
        expect(toolPages(tool), `${page} ← ${tool.id}`).toContain(page)
      }
    }
  })

  it('不存在的页面得到空列表（而不是全量）', () => {
    expect(imageToolsByPage('definitely-not-a-page')).toEqual([])
  })

  it('getImageTool 只在该页确实有它时命中', () => {
    const tool = imageTools.find(t => toolPages(t).length > 0)!
    const page = toolPages(tool)[0]!
    expect(getImageTool(page, tool.id)?.id).toBe(tool.id)
    expect(getImageTool('definitely-not-a-page', tool.id)).toBeUndefined()
  })
})

describe('页面专属示例图', () => {
  it('示例 URL 都在 /samples/ 下，且带 i18n labelKey', () => {
    for (const [page, list] of Object.entries(imagePageSamples)) {
      for (const sample of list ?? []) {
        expect(sample.url, `${page} 的示例 url`).toMatch(/^\/samples\//)
        expect(sample.labelKey.trim(), `${page} 的示例 labelKey`).not.toBe('')
      }
    }
  })
})
