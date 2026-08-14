<script setup lang="ts">
/**
 * AIGC 分类兜底页：处理 demos.ts 中已注册但尚未实现独立页面的
 * planned 演示（显示"敬请期待"），避免 404。
 */
const route = useRoute()
const { t } = useI18n()
const { getDemo } = useDemos()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('aigc', slug.value))
</script>

<template>
  <div v-if="demo">
    <ClientOnly>
      <MediaDemoShell :demo="demo">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-hourglass"
          :title="t('demo.comingSoon')"
        />
      </MediaDemoShell>
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
      :title="t('demo.notFound')"
    />
  </UContainer>
</template>
