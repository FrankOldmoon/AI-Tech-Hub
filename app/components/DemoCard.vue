<script setup lang="ts">
import type { LocalizedDemo } from '~/utils/demos'
import { demoPath } from '~/utils/demos'

const props = defineProps<{ demo: LocalizedDemo }>()
const to = computed(() => demoPath(props.demo))
</script>

<template>
  <NuxtLink :to="to" class="block h-full group">
    <UCard
      variant="subtle"
      class="h-full transition ring-0 group-hover:ring-2 group-hover:ring-primary/40"
    >
      <div class="flex items-start gap-3">
        <div class="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UIcon :name="demo.icon" class="size-5" />
        </div>
        <div class="min-w-0">
          <h3 class="font-semibold text-highlighted truncate">
            {{ demo.title }}
          </h3>
          <p class="mt-1 text-sm text-muted line-clamp-2">
            {{ demo.description }}
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <DemoStatusBadge :status="demo.status" />
          <div v-if="demo.tags?.length" class="flex flex-wrap gap-1 justify-end">
            <UBadge
              v-for="tag in demo.tags"
              :key="tag"
              color="neutral"
              variant="soft"
              size="xs"
            >
              {{ tag }}
            </UBadge>
          </div>
        </div>
      </template>
    </UCard>
  </NuxtLink>
</template>
