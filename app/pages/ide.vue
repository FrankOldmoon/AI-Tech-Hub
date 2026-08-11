<script setup lang="ts">
const { t } = useI18n()

useSeoMeta({
  title: () => `${t('nav.ide')} · ${t('site.title')}`,
  description: () => t('nav.ide')
})
</script>

<template>
  <div class="h-[calc(100dvh-4rem)] p-3">
    <PyodideRunner class="h-full" />
  </div>
</template>
