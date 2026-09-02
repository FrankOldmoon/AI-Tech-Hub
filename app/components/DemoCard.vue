<script setup lang="ts">
import type { LocalizedDemo } from '~/utils/demos'
import { accentForCategory, demoPath } from '~/utils/demos'

const props = defineProps<{ demo: LocalizedDemo }>()
const to = computed(() => demoPath(props.demo))
const accent = computed(() => accentForCategory(props.demo.category))
const { t } = useI18n()

function modelSizeText(mb?: number): string {
  if (!mb) return ''
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb}MB`
}
</script>

<template>
  <NuxtLink
    :to="to"
    class="block h-full group relative"
  >
    <UCard class="h-full transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-primary/10 group-hover:ring-1 group-hover:ring-primary/40 ring-1 ring-default/70">
      <div class="flex items-start gap-3">
        <!-- 分类色渐变图标 -->
        <div
          class="size-10 rounded-lg bg-gradient-to-br text-white flex items-center justify-center shrink-0 shadow-sm"
          :class="accent"
        >
          <UIcon
            :name="demo.icon"
            class="size-5"
          />
        </div>
        <div class="min-w-0">
          <h3 class="font-semibold text-highlighted truncate group-hover:text-primary transition-colors">
            {{ demo.title }}
          </h3>
          <p class="mt-1 text-sm text-muted line-clamp-2">
            {{ demo.description }}
          </p>
        </div>
      </div>

      <template #footer>
        <div
          v-if="demo.requirements"
          class="flex flex-wrap gap-1 mb-2"
        >
          <UBadge
            v-if="demo.requirements?.camera"
            color="warning"
            variant="soft"
            size="xs"
          >
            {{ t('demo.requiresCamera') }}
          </UBadge>
          <UBadge
            v-if="demo.requirements?.mic"
            color="warning"
            variant="soft"
            size="xs"
          >
            {{ t('demo.requiresMic') }}
          </UBadge>
          <UBadge
            v-if="demo.requirements?.modelSizeMB"
            color="info"
            variant="soft"
            size="xs"
          >
            {{ t('demo.modelSize', { size: modelSizeText(demo.requirements.modelSizeMB) }) }}
          </UBadge>
          <UBadge
            v-if="demo.requirements?.needsServer"
            color="warning"
            variant="soft"
            size="xs"
          >
            {{ t('demo.needsServer') }}
          </UBadge>
        </div>
        <div class="flex items-center justify-between gap-2">
          <DemoStatusBadge :status="demo.status" />
          <div
            v-if="demo.tags?.length"
            class="flex flex-wrap gap-1 justify-end"
          >
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