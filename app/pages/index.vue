<script setup lang="ts">
import type { LocalizedDemo } from '~/utils/demos'

const { t } = useI18n()
const { categories, byCategory, demos, classroomDemos } = useDemos()

/** 首页只展示有 demo 的分类（机械人等空分类在导航可见、页面显示"敬请期待"，但不在首页占位） */
const homeCategories = computed(() => categories.value.filter(c => byCategory(c.slug).length > 0))

// 搜索
const query = ref('')
const queryLower = computed(() => query.value.trim().toLowerCase())
const isSearching = computed(() => queryLower.value.length > 0)
const HOME_LIMIT = 6

/** 分类首页：featured 优先 + 限流（审计维度四-2） */
function visibleDemos(catSlug: string): LocalizedDemo[] {
  const list = byCategory(catSlug)
  const featured = list.filter(d => d.featured)
  const rest = list.filter(d => !d.featured)
  return [...featured, ...rest].slice(0, HOME_LIMIT)
}

const searchResults = computed(() => {
  if (!isSearching.value) return []
  const q = queryLower.value
  return demos.value.filter((d) => {
    const cat = categories.value.find(c => c.slug === d.category)
    const haystack = [
      d.title,
      d.description,
      d.slug,
      cat?.title ?? '',
      ...(d.tags ?? [])
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
})
</script>

<template>
  <div>
    <!-- 科技感首屏 Hero（含统计条 + 分类快速入口） -->
    <HomeHero />

    <UContainer>
      <!-- 主内容锚点 -->
      <div
        id="demos"
        class="scroll-mt-24 -mt-6"
      />

      <!-- 搜索框 -->
      <div class="pt-10 pb-2">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          size="xl"
          :placeholder="t('home.searchPlaceholder')"
          :ui="{ root: 'w-full' }"
        >
          <template
            v-if="query"
            #trailing
          >
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="link"
              size="sm"
              @click="query = ''"
            />
          </template>
        </UInput>
      </div>

      <!-- 搜索结果 -->
      <div
        v-if="isSearching"
        class="pb-12 space-y-5"
      >
        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon
            name="i-lucide-search"
            class="size-4"
          />
          <span>{{ t('home.searchResults', { count: searchResults.length }) }}</span>
        </div>
        <DemoGrid v-if="searchResults.length">
          <DemoCard
            v-for="d in searchResults"
            :key="d.slug"
            :demo="d"
          />
        </DemoGrid>
        <div
          v-else
          class="py-16 text-center text-muted"
        >
          <UIcon
            name="i-lucide-search-x"
            class="size-8 mb-2 opacity-50"
          />
          <p>{{ t('home.searchEmpty') }}</p>
        </div>
      </div>

      <template v-else>
        <!-- 课堂演示推荐（老师视角，审计 P1-5） -->
        <div
          v-if="classroomDemos.length"
          id="classroom"
          class="py-10 space-y-5 scroll-mt-24"
        >
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-presentation"
              class="size-5 text-primary"
            />
            <h2 class="text-xl font-bold text-highlighted">
              {{ t('home.classroomTitle') }}
            </h2>
          </div>
          <p class="mt-1 text-sm text-muted -mt-3">
            {{ t('home.classroomDesc') }}
          </p>
          <DemoGrid>
            <DemoCard
              v-for="d in classroomDemos"
              :key="d.slug"
              :demo="d"
            />
          </DemoGrid>
        </div>

        <!-- 各分类演示 -->
        <div
          v-for="cat in homeCategories"
          :id="`cat-${cat.slug}`"
          :key="cat.slug"
          class="py-10 space-y-5 scroll-mt-24"
        >
          <CategoryHeader
            :category="cat"
            :count="byCategory(cat.slug).length"
          />
          <DemoGrid>
            <DemoCard
              v-for="d in visibleDemos(cat.slug)"
              :key="d.slug"
              :demo="d"
            />
          </DemoGrid>
          <div
            v-if="byCategory(cat.slug).length > HOME_LIMIT"
            class="text-center pt-2"
          >
            <UButton
              :to="`/${cat.slug}`"
              color="neutral"
              variant="soft"
              icon="i-lucide-arrow-right"
              trailing
            >
              {{ t('demo.viewAll') }} ({{ byCategory(cat.slug).length }})
            </UButton>
          </div>
        </div>

        <!-- 怎么玩（下沉：避免首屏太满，靠后折叠呈现） -->
        <HowToPlay />
      </template>
    </UContainer>
  </div>
</template>