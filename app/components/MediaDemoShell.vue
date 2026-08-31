<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'
import { pythonBackendEnabled } from '~/utils/remote-models'

const props = defineProps<{
  demo: {
    title: string
    description?: string
    icon: string
    status: DemoStatus
    slug?: string
    category?: string
    runtime?: 'browser' | 'server'
    /** 工作原理（教学向，折叠渲染） */
    howItWorks?: string
    /** 运行必需本地 Python 后端；云端部署时禁用提示 */
    requiresPython?: boolean
    /** 本地 Python 后端是否已就绪；false 时显示"后端未就绪"而非报错 */
    backendReady?: boolean
    /** 对应 python 下的模块路径，用于展示最简 Python 实现 */
    pythonModule?: string
  }
}>()

const { t } = useI18n()
const { demos, getCategory } = useDemos()

// 同分类内的上一个/下一个（审计维度四-3）
const siblings = computed(() => {
  if (!props.demo.slug || !props.demo.category) return []
  return demos.value.filter(d => d.category === props.demo.category && d.status === 'ready')
})
const currentIndex = computed(() => siblings.value.findIndex(d => d.slug === props.demo.slug))
const prevDemo = computed(() => currentIndex.value > 0 ? siblings.value[currentIndex.value - 1] : null)
const nextDemo = computed(() => currentIndex.value >= 0 && currentIndex.value < siblings.value.length - 1 ? siblings.value[currentIndex.value + 1] : null)
const category = computed(() => props.demo.category ? getCategory(props.demo.category) : null)
// 依赖本地 Python 后端的 demo：云端部署、后端未启用、或后端未就绪（依赖/模型未装）时不可用
// （审计批次5 requiresPython；runtime='server' 的 demo 必然走本地 Python 队列，等同 requiresPython）
const pythonUnavailable = computed(() =>
  (props.demo.requiresPython || props.demo.runtime === 'server')
  && (!pythonBackendEnabled() || props.demo.backendReady === false)
)
// 未就绪原因：云端部署 vs 本地后端未就绪
const pythonUnavailableTitle = computed(() =>
  props.demo.backendReady === false ? t('demo.backendNotReady') : t('demo.requiresPythonUnavailable')
)

// SEO：每个 demo 页独立 title/description（审计维度四-8）
useSeoMeta({
  title: () => props.demo.title,
  description: () => props.demo.description || '',
  ogTitle: () => props.demo.title,
  ogDescription: () => props.demo.description || ''
})
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12 space-y-6">
      <!-- 面包屑（审计维度四-3） -->
      <UBreadcrumb
        v-if="category || props.demo.slug"
        :items="[
          { label: t('nav.home'), to: '/' },
          ...(category ? [{ label: category.title, to: `/${category.slug}` }] : []),
          { label: props.demo.title }
        ]"
      />
      <!-- 标题区 -->
      <div class="flex items-start gap-4">
        <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UIcon
            :name="demo.icon"
            class="size-6"
          />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ demo.title }}
            </h1>
            <DemoStatusBadge :status="demo.status" />
          </div>
          <p
            v-if="demo.description"
            class="mt-1 text-muted"
          >
            {{ demo.description }}
          </p>
        </div>
      </div>

      <!-- 依赖本地 Python：云端不可用提示（审计批次5） -->
      <UAlert
        v-if="pythonUnavailable"
        color="warning"
        variant="subtle"
        icon="i-lucide-server-off"
        :title="pythonUnavailableTitle"
      />

      <!-- 工作原理（教学向，审计批次5） -->
      <HowItWorksSection :text="demo.howItWorks" />

      <slot />
      <!-- 对应的 Python 最简实现源码 -->
      <PythonSourceViewer
        v-if="demo.pythonModule"
        :feature="demo.pythonModule"
      />

      <!-- 上一个 / 下一个（同分类内，审计维度四-3） -->
      <div
        v-if="prevDemo || nextDemo"
        class="flex items-center justify-between gap-3 pt-2"
      >
        <UButton
          v-if="prevDemo"
          :to="`/${prevDemo.category}/${prevDemo.slug}`"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          :label="prevDemo.title"
          class="max-w-[45%]"
        />
        <span v-else />
        <UButton
          v-if="nextDemo"
          :to="`/${nextDemo.category}/${nextDemo.slug}`"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-right"
          trailing
          :label="nextDemo.title"
          class="max-w-[45%]"
        />
      </div>
    </div>
  </UContainer>
</template>
