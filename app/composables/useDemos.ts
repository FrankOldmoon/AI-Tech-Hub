import {
  categories, demos, visionGroupKeys, visionGroupLabels,
  type DemoCategory, type Localized, type LocalizedCategory, type LocalizedDemo, type VisionGroupKey
} from '~/utils/demos'

/**
 * 以当前 locale 解析后的 demo / category 访问器
 * 标题/描述已根据 locale 取值为字符串，组件可直接展示
 */
export function useDemos() {
  const { t, locale } = useI18n()
  const lang = computed(() => locale.value as 'zh' | 'en')
  const pick = (obj?: Localized) => obj?.[lang.value] ?? obj?.en ?? ''

  const localizedCategories = computed<LocalizedCategory[]>(() =>
    categories.map(c => ({
      ...c,
      title: pick(c.title),
      description: pick(c.description)
    }))
  )

  const localizedDemos = computed<LocalizedDemo[]>(() =>
    demos.map(d => ({
      ...d,
      title: pick(d.title),
      description: pick(d.description),
      howItWorks: d.howItWorks ? pick(d.howItWorks) : undefined
    }))
  )

  /** 列表 = 规范归属本分类的 + 通过 alsoIn 跨分类归属到本分类的（后者 URL 仍指向其规范分类） */
  const byCategory = (slug: DemoCategory | string) =>
    localizedDemos.value
      .filter(d => d.category === slug || d.alsoIn?.includes(slug as DemoCategory))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title, lang.value))

  /**
   * 按子分组（demo.group）聚合某个分类的 demo。组顺序 = visionGroupKeys。
   * - vision 分类会产出多个带标题的组；无 group 的项收纳为单个未分组 bucket
   * - 非 vision 分类（所有 demo 无 group）→ 单个未分组 bucket，CategoryPage 据此不显示标题
   */
  const byCategoryGrouped = (slug: DemoCategory | string) => {
    const list = byCategory(slug)
    const groupTitle = (key?: string) =>
      (key && key in visionGroupLabels) ? pick(visionGroupLabels[key as VisionGroupKey]) : ''
    const groups: { key?: string, title: string, demos: LocalizedDemo[] }[] = []
    const unordered = new Map<string, LocalizedDemo[]>()
    const remaining: LocalizedDemo[] = []
    const cross: LocalizedDemo[] = []
    for (const d of list) {
      // 跨分类归属的项单独成组放在最后：它们同时出现在两个分类的列表里，
      // 与「本分类自己的」条目混在一个网格里会让人以为是本分类独有的能力
      if (d.category !== slug) {
        cross.push(d)
        continue
      }
      if (d.group && d.group in visionGroupLabels) {
        const arr = unordered.get(d.group) ?? []
        arr.push(d)
        unordered.set(d.group, arr)
      } else {
        remaining.push(d)
      }
    }
    for (const key of visionGroupKeys) {
      const arr = unordered.get(key)
      if (arr?.length) groups.push({ key, title: groupTitle(key), demos: arr })
    }
    if (remaining.length) groups.push({ key: undefined, title: '', demos: remaining })
    if (cross.length) groups.push({ key: 'cross', title: t('demo.crossListed'), demos: cross })
    return groups
  }

  const getCategory = (slug: DemoCategory | string) =>
    localizedCategories.value.find(c => c.slug === slug)

  const getDemo = (category: DemoCategory | string, slug: string) =>
    localizedDemos.value.find(d => d.category === category && d.slug === slug)

  const stats = computed(() => ({
    total: localizedDemos.value.length,
    categories: localizedCategories.value.length,
    ready: localizedDemos.value.filter(d => d.status === 'ready').length,
    planned: localizedDemos.value.filter(d => d.status === 'planned').length
  }))

  /** 课堂演示推荐（老师视角，审计 P1-5）：classroomSafe 且 ready 的 demo */
  const classroomDemos = computed<LocalizedDemo[]>(() =>
    localizedDemos.value.filter(d => d.classroomSafe && d.status === 'ready')
  )

  return {
    demos: localizedDemos,
    categories: localizedCategories,
    byCategory,
    byCategoryGrouped,
    getCategory,
    getDemo,
    stats,
    classroomDemos
  }
}
