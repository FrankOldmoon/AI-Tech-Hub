<script setup lang="ts">
/**
 * 首页 Hero：科技感首屏
 * - 白色底 + 多层渐变光晕（primary / violet / cyan）+ 顶部径向渐变细线
 * - 玻璃拟态徽章 + 渐变标题 + 主副 CTA
 * - 底部内嵌统计条（原独立统计区并入 Hero）
 */
import { accentForCategory } from '~/utils/demos'

const { t } = useI18n()
const { stats, categories, byCategory } = useDemos()

const statItems = computed(() => [
  { value: stats.value.total, label: t('home.stats.demos'), icon: 'i-lucide-flask-conical' },
  { value: stats.value.categories, label: t('home.stats.categories'), icon: 'i-lucide-layout-grid' },
  { value: stats.value.ready, label: t('home.stats.ready'), icon: 'i-lucide-check-circle-2' },
  { value: stats.value.planned, label: t('home.stats.planned'), icon: 'i-lucide-clock' }
])

/** 分类快速入口只展示有 demo 的分类，避免空分类占位（与首页分类一致） */
const availableCategories = computed(() =>
  categories.value.filter(c => byCategory(c.slug).length > 0)
)
const categorySlugs = computed(() => availableCategories.value.map(c => `/${c.slug}`))
</script>

<template>
  <section class="relative overflow-hidden border-b border-default">
    <!-- 顶部主题径向渐变细线（科技感边界） -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      aria-hidden="true"
    />

    <!-- 科技感光晕背景：青色 + 主色 + 紫罗兰三色径向渐变 -->
    <div
      class="pointer-events-none absolute inset-0 -z-10"
      aria-hidden="true"
    >
      <div
        class="absolute -top-40 left-1/4 size-[36rem] rounded-full opacity-40 blur-3xl"
        style="background: radial-gradient(circle, color-mix(in srgb, var(--color-primary) 35%, transparent) 0%, transparent 70%)"
      />
      <div
        class="absolute top-10 -right-32 size-[28rem] rounded-full opacity-25 blur-3xl"
        style="background: radial-gradient(circle, color-mix(in srgb, #22d3ee 40%, transparent) 0%, transparent 70%)"
      />
      <div
        class="absolute -bottom-24 left-0 size-[30rem] rounded-full opacity-25 blur-3xl"
        style="background: radial-gradient(circle, color-mix(in srgb, #a78bfa 35%, transparent) 0%, transparent 70%)"
      />
      <!-- 轻网格点缀 -->
      <div
        class="absolute inset-0 opacity-[0.04] bg-[linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] bg-[size:3rem_3rem]"
      />
    </div>

    <UContainer class="py-16 sm:py-24">
      <div class="max-w-3xl">
        <!-- 玻璃拟态徽章 -->
        <div
          class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-primary border border-primary/20 bg-white/60 backdrop-blur shadow-sm"
        >
          <UIcon
            name="i-lucide-sparkles"
            class="size-3.5"
          />
          {{ t('home.heroBadge') }}
        </div>

        <!-- 渐变标题 -->
        <h1
          class="mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08]"
        >
          <span
            class="bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary-600 to-violet-500"
          >
            {{ t('home.heroTitle') }}
          </span>
        </h1>

        <p class="mt-5 text-base sm:text-lg text-muted leading-relaxed max-w-2xl">
          {{ t('home.heroDescription') }}
        </p>

        <!-- 主 CTA + 隐私提示 -->
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <UButton
            to="#demos"
            size="lg"
            icon="i-lucide-rocket"
            :label="t('home.getStarted')"
          />
          <div class="hidden sm:flex items-center gap-1.5 text-xs text-muted">
            <UIcon
              name="i-lucide-lock"
              class="size-3.5"
            />
            {{ t('home.heroPrivacy') }}
          </div>
        </div>
      </div>

      <!-- 统计数据（平淡展示，非可点击卡片） -->
      <dl class="mt-10 flex flex-wrap gap-x-8 gap-y-4">
        <div
          v-for="s in statItems"
          :key="s.label"
          class="flex items-baseline gap-2"
        >
          <dt class="sr-only">
            {{ s.label }}
          </dt>
          <dd class="text-2xl sm:text-3xl font-bold text-highlighted tabular-nums leading-none">
            {{ s.value }}
          </dd>
          <span class="flex items-center gap-1.5 text-sm text-muted">
            <UIcon
              :name="s.icon"
              class="size-4"
            />
            {{ s.label }}
          </span>
        </div>
      </dl>

      <!-- 分类快速入口锚点（仅展示有 demo 的分类，accent 色图标） -->
      <nav class="mt-10" aria-label="categories">
        <div class="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted">
          <UIcon
            name="i-lucide-grid-2x2"
            class="size-3.5"
          />
          {{ t('home.browseByCategory') }}
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="(c, i) in availableCategories"
            :key="c.slug"
            :to="categorySlugs[i]"
            size="sm"
            color="neutral"
            variant="soft"
            class="bg-white/50 backdrop-blur"
          >
            <span class="flex items-center gap-2">
              <span
                class="size-4 rounded-md bg-gradient-to-br text-white flex items-center justify-center"
                :class="accentForCategory(c.slug)"
              >
                <UIcon
                  :name="c.icon"
                  class="size-3"
                />
              </span>
              <span class="text-foreground">{{ c.title }}</span>
            </span>
          </UButton>
        </div>
      </nav>
    </UContainer>
  </section>
</template>