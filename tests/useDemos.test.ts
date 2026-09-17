/**
 * demo 访问器（按 locale 解析后的视图）。
 *
 * 首页/分类页/详情页全部走它，其中最容易出错的是**分组**：vision 按 group 分小节、
 * 跨分类归属（alsoIn）的条目要单独成组放到最后。分错了会让「图像分类训练」出现在
 * 语音分类里却不带任何标记，看起来像分类错误。
 */
import { describe, expect, it } from 'vitest'
import './support/nuxt-env' // i18n / computed 的补丁（locale 固定 zh）
import { useDemos } from '../app/composables/useDemos'
import { demos as rawDemos, visionGroupKeys } from '../app/utils/demos'

const demos = useDemos()

describe('本地化视图', () => {
  it('标题/描述在 zh 下取中文字段（不是对象）', () => {
    const first = demos.demos.value[0]!
    expect(typeof first.title).toBe('string')
    expect(typeof first.description).toBe('string')
    expect(first.title).not.toBe('')
  })

  it('howItWorks 缺失时是 undefined，而不是空对象', () => {
    for (const demo of demos.demos.value) {
      expect(demo.howItWorks === undefined || typeof demo.howItWorks === 'string').toBe(true)
    }
  })

  it('数量与注册表一致（视图不该丢条目）', () => {
    expect(demos.demos.value).toHaveLength(rawDemos.length)
  })

  it('分类的标题同样是字符串', () => {
    for (const c of demos.categories.value) {
      expect(typeof c.title).toBe('string')
      expect(c.title).not.toBe('')
    }
  })
})

describe('查询', () => {
  it('getDemo 命中存在的条目并返回本地化字段', () => {
    const raw = rawDemos[0]!
    const hit = demos.getDemo(raw.category, raw.slug)
    expect(hit?.slug).toBe(raw.slug)
    expect(hit?.title).toBe(raw.title.zh)
  })

  it('getDemo / getCategory 未命中返回 undefined', () => {
    expect(demos.getDemo('vision', 'nope')).toBeUndefined()
    expect(demos.getCategory('nope')).toBeUndefined()
  })

  it('byCategory 只返回本分类的，且按标题排序', () => {
    const list = demos.byCategory('vision')
    expect(list.length).toBeGreaterThan(0)
    expect(list.every(d => d.category === 'vision' || d.alsoIn?.includes('vision'))).toBe(true)

    const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    expect(list.map(d => d.slug)).toEqual(sorted.map(d => d.slug))
  })

  it('byCategory 把 alsoIn 跨分类的条目也算进来', () => {
    const cross = rawDemos.find(d => (d.alsoIn?.length ?? 0) > 0)
    if (!cross) return
    const target = cross.alsoIn![0]!
    expect(demos.byCategory(target).map(d => d.slug)).toContain(cross.slug)
  })
})

describe('分组（byCategoryGrouped）', () => {
  it('vision 的组顺序跟随 visionGroupKeys，未分组项居中，跨分类项最后', () => {
    const groups = demos.byCategoryGrouped('vision')
    const keys = groups.map(g => g.key)

    // 带 key 的组必须按 visionGroupKeys 的相对顺序出现
    const ordered = keys.filter(k => k && k !== 'cross') as string[]
    const expectedOrder = visionGroupKeys.filter(k => ordered.includes(k))
    expect(ordered).toEqual(expectedOrder)

    // 'cross' 若存在必须是最后一组
    const crossIndex = keys.indexOf('cross')
    if (crossIndex >= 0) expect(crossIndex, '跨分类组必须放在最后').toBe(keys.length - 1)

    // 未分组桶（key === undefined）最多一个，且在 cross 之前
    expect(keys.filter(k => k === undefined).length).toBeLessThanOrEqual(1)
  })

  it('每个组非空，且组内条目都真的属于该分类', () => {
    for (const group of demos.byCategoryGrouped('vision')) {
      expect(group.demos.length, String(group.key)).toBeGreaterThan(0)
      for (const d of group.demos) {
        expect(['vision']).toContain(d.category === 'vision' ? 'vision' : d.alsoIn?.includes('vision') ? 'vision' : d.category)
      }
    }
  })

  it('分组会把该分类的所有条目安排完（一个都不漏）', () => {
    const groups = demos.byCategoryGrouped('vision')
    const total = groups.reduce((n, g) => n + g.demos.length, 0)
    expect(total).toBe(demos.byCategory('vision').length)
  })

  it('非 vision 分类一般只有单个未分组桶（它们没有 group 字段）', () => {
    const groups = demos.byCategoryGrouped('ml')
    const keyed = groups.filter(g => g.key && g.key !== 'cross')
    expect(keyed).toHaveLength(0)
  })

  it('跨分类组的标题走 i18n key', () => {
    const groups = demos.byCategoryGrouped('vision')
    const cross = groups.find(g => g.key === 'cross')
    if (cross) expect(cross.title).toBe('demo.crossListed')
  })
})

describe('统计与课堂推荐', () => {
  it('stats 与注册表一致', () => {
    const stats = demos.stats.value
    expect(stats.total).toBe(rawDemos.length)
    expect(stats.categories).toBe(demos.categories.value.length)
    expect(stats.ready).toBe(rawDemos.filter(d => d.status === 'ready').length)
    expect(stats.planned).toBe(rawDemos.filter(d => d.status === 'planned').length)
    expect(stats.ready + stats.planned).toBe(stats.total)
  })

  it('课堂推荐都是「已完成 + 标记为课堂安全」（不能推荐没做完的页给老师）', () => {
    for (const d of demos.classroomDemos.value) {
      expect(d.status, d.slug).toBe('ready')
      expect(rawDemos.find(r => r.slug === d.slug)?.classroomSafe, d.slug).toBe(true)
    }
  })
})
