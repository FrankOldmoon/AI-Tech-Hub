<script setup lang="ts">
const { t } = useI18n()
const { categories, byCategory, stats, demos } = useDemos()

const statItems = computed(() => [
  { value: stats.value.total, label: t('home.stats.demos'), icon: 'i-lucide-flask-conical' },
  { value: stats.value.categories, label: t('home.stats.categories'), icon: 'i-lucide-layout-grid' },
  { value: stats.value.ready, label: t('home.stats.ready'), icon: 'i-lucide-check-circle-2' },
  { value: stats.value.planned, label: t('home.stats.planned'), icon: 'i-lucide-clock' }
])

// 搜索
const query = ref('')
const queryLower = computed(() => query.value.trim().toLowerCase())
const isSearching = computed(() => queryLower.value.length > 0)

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
    <UPageHero
      :title="t('home.heroTitle')"
      :description="t('home.heroDescription')"
    />

    <UContainer>
      <!-- 统计 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 -mt-6">
        <UCard v-for="s in statItems" :key="s.label" variant="subtle">
          <div class="flex items-center gap-3">
            <UIcon :name="s.icon" class="size-6 text-primary shrink-0" />
            <div>
              <div class="text-2xl font-bold text-highlighted leading-none">
                {{ s.value }}
              </div>
              <div class="text-sm text-muted mt-1">
                {{ s.label }}
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <!-- 搜索框 -->
      <div class="py-8">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          size="xl"
          :placeholder="t('home.searchPlaceholder')"
          :ui="{ root: 'w-full' }"
        >
          <template v-if="query" #trailing>
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
      <div v-if="isSearching" class="pb-12 space-y-5">
        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-search" class="size-4" />
          <span>{{ t('home.searchResults', { count: searchResults.length }) }}</span>
        </div>
        <DemoGrid v-if="searchResults.length">
          <DemoCard
            v-for="d in searchResults"
            :key="d.slug"
            :demo="d"
          />
        </DemoGrid>
        <div v-else class="py-16 text-center text-muted">
          <UIcon name="i-lucide-search-x" class="size-8 mb-2 opacity-50" />
          <p>{{ t('home.searchEmpty') }}</p>
        </div>
      </div>

      <!-- 各分类演示 -->
      <div v-if="!isSearching" v-for="cat in categories" :key="cat.slug" class="py-10 space-y-5">
        <CategoryHeader :category="cat" :count="byCategory(cat.slug).length" />
        <DemoGrid>
          <DemoCard
            v-for="d in byCategory(cat.slug)"
            :key="d.slug"
            :demo="d"
          />
        </DemoGrid>
      </div>
    </UContainer>
  </div>
</template>
