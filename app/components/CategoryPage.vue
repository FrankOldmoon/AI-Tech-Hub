<script setup lang="ts">
import type { DemoCategory } from '~/utils/demos'

const props = defineProps<{ category: DemoCategory }>()
const { t } = useI18n()
const { getCategory, byCategory } = useDemos()

const cat = computed(() => getCategory(props.category))
const list = computed(() => byCategory(props.category))
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12 space-y-8">
      <CategoryHeader v-if="cat" :category="cat" :count="list.length" />

      <DemoGrid v-if="list.length">
        <DemoCard v-for="d in list" :key="d.slug" :demo="d" />
      </DemoGrid>

      <UAlert
        v-else
        color="neutral"
        variant="subtle"
        icon="i-lucide-inbox"
        :title="t('demo.noDemo')"
      />
    </div>
  </UContainer>
</template>
