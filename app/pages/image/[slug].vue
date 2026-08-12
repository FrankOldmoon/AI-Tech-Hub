<script setup lang="ts">
/**
 * 图像工坊通用页面：根据 slug 从 image-tools 注册表取工具，
 * 交给 ImagePlayground 渲染；未实现的页面显示"规划中"。
 */
import { imageToolsByPage } from '~/utils/image-tools'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('image', slug.value))
const tools = computed(() => imageToolsByPage(slug.value))
</script>

<template>
  <div v-if="demo">
    <ClientOnly>
      <ImagePlayground v-if="tools.length" :demo="demo" :tools="tools" />
      <UContainer v-else class="py-16">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-hourglass"
          :title="t('image.comingSoon')"
        />
      </UContainer>
      <template #fallback>
        <div class="py-20 flex items-center justify-center">
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-muted" />
        </div>
      </template>
    </ClientOnly>
  </div>
  <UContainer v-else class="py-16">
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-file-question"
      title="Demo not found"
    />
  </UContainer>
</template>
