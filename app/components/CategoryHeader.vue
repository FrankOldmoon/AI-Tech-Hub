<script setup lang="ts">
import type { LocalizedCategory } from '~/utils/demos'

defineProps<{
  category: LocalizedCategory
  count?: number
}>()
</script>

<template>
  <div class="flex items-start gap-4">
    <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
      <UIcon :name="category.icon" class="size-6" />
    </div>
    <div class="min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h1 class="text-2xl font-bold text-highlighted">
          {{ category.title }}
        </h1>
        <UBadge v-if="count !== undefined" color="neutral" variant="subtle" size="sm">
          {{ count }}
        </UBadge>
      </div>
      <p class="mt-1 text-muted">
        {{ category.description }}
      </p>
    </div>
  </div>
</template>
