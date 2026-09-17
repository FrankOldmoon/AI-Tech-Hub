/**
 * demo 注册表的完整性契约。
 *
 * 这个注册表是全站的单一事实来源：分类页、首页、E2E 的路由枚举、SEO 全部读它。
 * 它一旦出现「重复 slug / 缺英文 / 归类到不存在的分类」，表现是某页静默消失或
 * 路由撞车，很难从界面上看出来 —— 所以在这里把它钉死。
 */
import { describe, expect, it } from 'vitest'
import {
  categories,
  categoryBySlug,
  categoryAccent,
  demoPath,
  demos,
  demosByCategory,
  getDemo,
  statusColor,
  statusI18nKey,
  visionGroupKeys,
  visionGroupLabels
} from '../app/utils/demos'

const CATEGORY_SLUGS = categories.map(c => c.slug)

describe('分类表', () => {
  it('slug 唯一，且中英标题与描述都齐全', () => {
    expect(new Set(CATEGORY_SLUGS).size).toBe(categories.length)
    for (const c of categories) {
      expect(c.title.zh.trim(), c.slug).not.toBe('')
      expect(c.title.en.trim(), c.slug).not.toBe('')
      expect(c.description.zh.trim(), c.slug).not.toBe('')
      expect(c.description.en.trim(), c.slug).not.toBe('')
    }
  })

  it('每个分类都有主题色渐变（卡片配色依赖它）', () => {
    for (const c of categories) {
      expect(categoryAccent[c.slug], c.slug).toBeTruthy()
    }
  })
})

describe('demo 条目', () => {
  it('数量不为零，且每条都归属一个存在的分类', () => {
    expect(demos.length).toBeGreaterThan(0)
    for (const d of demos) {
      expect(CATEGORY_SLUGS, `${d.category}/${d.slug}`).toContain(d.category)
    }
  })

  it('同一分类内 slug 唯一 —— 否则两条 demo 会撞同一个 URL', () => {
    const seen = new Set<string>()
    for (const d of demos) {
      const key = `${d.category}/${d.slug}`
      expect(seen.has(key), `重复的 demo 路径：${key}`).toBe(false)
      seen.add(key)
    }
  })

  it('中文英文标题都非空（英文缺失会在切语言时露出空白）', () => {
    for (const d of demos) {
      expect(d.title.zh.trim(), d.slug).not.toBe('')
      expect(d.title.en.trim(), d.slug).not.toBe('')
      expect(d.description.zh.trim(), d.slug).not.toBe('')
      expect(d.description.en.trim(), d.slug).not.toBe('')
    }
  })

  it('status 只有 ready / planned 两种，且 planned 不该被标成课堂推荐', () => {
    for (const d of demos) {
      expect(['ready', 'planned'], d.slug).toContain(d.status)
      if (d.classroomSafe) expect(d.status, `${d.slug} 标了课堂推荐但还没完成`).toBe('ready')
    }
  })

  it('alsoIn 只指向存在的分类，且不含自己被归属的那个分类', () => {
    for (const d of demos) {
      for (const slug of d.alsoIn ?? []) {
        expect(CATEGORY_SLUGS, `${d.slug} 的 alsoIn=${slug}`).toContain(slug)
        expect(slug, `${d.slug} 的 alsoIn 不该重复自己的规范分类`).not.toBe(d.category)
      }
    }
  })

  it('group 只用于 vision 分类，且必须是已登记的 visionGroupKeys', () => {
    for (const d of demos) {
      if (!d.group) continue
      expect(d.category, `${d.slug} 用了 group 但不是 vision`).toBe('vision')
      expect(visionGroupKeys, `${d.slug} 的 group`).toContain(d.group)
    }
  })

  it('每条都有图标与标签（卡片渲染依赖）', () => {
    for (const d of demos) {
      expect(d.icon.trim(), d.slug).not.toBe('')
      expect(Array.isArray(d.tags) && d.tags.length > 0, `${d.slug} 没有 tags`).toBe(true)
    }
  })
})

describe('vision 分组标签', () => {
  it('每个分组键都有中英标签', () => {
    for (const key of visionGroupKeys) {
      const label = visionGroupLabels[key]
      expect(label, key).toBeTruthy()
      expect(label.zh.trim(), key).not.toBe('')
      expect(label.en.trim(), key).not.toBe('')
    }
  })
})

describe('查询辅助', () => {
  it('demoPath 生成 /分类/slug', () => {
    expect(demoPath({ category: 'vision', slug: 'pipeline' })).toBe('/vision/pipeline')
  })

  it('getDemo 命中存在的条目，未命中返回 undefined', () => {
    const first = demos[0]!
    expect(getDemo(first.category, first.slug)?.slug).toBe(first.slug)
    expect(getDemo(first.category, 'definitely-not-a-real-slug')).toBeUndefined()
  })

  it('categoryBySlug 命中存在的分类', () => {
    expect(categoryBySlug('vision')?.slug).toBe('vision')
    expect(categoryBySlug('nope')).toBeUndefined()
  })

  it('demosByCategory 把 alsoIn 跨分类的条目也算进来', () => {
    const cross = demos.find(d => (d.alsoIn?.length ?? 0) > 0)
    if (!cross) return
    const target = cross.alsoIn![0]!
    expect(demosByCategory(target).map(d => d.slug)).toContain(cross.slug)
  })

  it('状态到文案/颜色的映射', () => {
    expect(statusColor('ready')).toBe('success')
    expect(statusColor('planned')).toBe('neutral')
    expect(statusI18nKey('ready')).toBe('demo.status.ready')
    expect(statusI18nKey('planned')).toBe('demo.status.planned')
  })
})
