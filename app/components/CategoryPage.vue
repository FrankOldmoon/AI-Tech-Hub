<script setup lang="ts">
import type { DemoCategory } from '~/utils/demos'

const props = defineProps<{ category: DemoCategory }>()
const { t } = useI18n()
const { getCategory, byCategoryGrouped } = useDemos()

const cat = computed(() => getCategory(props.category))
const grouped = computed(() => byCategoryGrouped(props.category))
const showGroupTitles = computed(() => grouped.value.filter(g => g.title).length >= 2)
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12 space-y-8">
      <CategoryHeader
        v-if="cat"
        :category="cat"
      />

      <template
        v-for="(g, i) in grouped"
        :key="g.key ?? `raw-${i}`"
      >
        <div
          v-if="showGroupTitles && g.title"
          class="mt-8"
        >
          <h2 class="text-sm font-medium text-muted uppercase tracking-wide mb-3">
            {{ g.title }}
          </h2>
          <DemoGrid>
            <DemoCard
              v-for="d in g.demos"
              :key="d.slug"
              :demo="d"
            />
          </DemoGrid>
        </div>
        <DemoGrid
          v-else-if="g.demos.length"
        >
          <DemoCard
            v-for="d in g.demos"
            :key="d.slug"
            :demo="d"
          />
        </DemoGrid>
      </template>

      <UAlert
        v-if="!grouped.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-inbox"
        :title="t('demo.noDemo')"
      />
    </div>
  </UContainer>
</template>
