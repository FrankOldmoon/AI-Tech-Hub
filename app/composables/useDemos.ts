import type { DemoCategory, Localized, LocalizedCategory, LocalizedDemo } from '~/utils/demos'
import { categories, demos } from '~/utils/demos'

/**
 * 以当前 locale 解析后的 demo / category 访问器
 * 标题/描述已根据 locale 取值为字符串，组件可直接展示
 */
export function useDemos() {
  const { locale } = useI18n()
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
      description: pick(d.description)
    }))
  )

  const byCategory = (slug: DemoCategory | string) =>
    localizedDemos.value.filter(d => d.category === slug)

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

  return {
    demos: localizedDemos,
    categories: localizedCategories,
    byCategory,
    getCategory,
    getDemo,
    stats
  }
}
