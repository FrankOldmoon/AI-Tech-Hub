<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'

const props = defineProps<{
  demo: {
    title: string
    description?: string
    icon: string
    status: DemoStatus
    slug?: string
    category?: string
    /** 工作原理（教学向，折叠渲染） */
    howItWorks?: string
  }
}>()

const { t } = useI18n()
const { getCategory } = useDemos()

const category = computed(() => props.demo.category ? getCategory(props.demo.category) : null)

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

      <!-- 工作原理（教学向，审计批次5） -->
      <HowItWorksSection :text="demo.howItWorks" />

      <slot />
    </div>
  </UContainer>
</template>
