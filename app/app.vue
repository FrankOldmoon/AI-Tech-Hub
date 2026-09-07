<script setup lang="ts">
const { t, locale } = useI18n()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: computed(() => (locale.value === 'zh' ? 'zh' : 'en'))
  }
})

const title = computed(() => t('site.title'))
const description = computed(() => t('site.description'))

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogImage: '/og.png',
  twitterCard: 'summary_large_image'
})

// 侧边栏只出现在功能页：由 NuxtLayout 决定（功能页用 default 布局带侧边栏，首页/分类页/IDE 用 bare 布局）
</script>

<template>
  <UApp>
    <AppHeader />

    <UMain>
      <NuxtLayout>
        <NuxtPage
          :transition="{ name: 'page', mode: 'out-in' }"
        />
      </NuxtLayout>
    </UMain>

    <USeparator icon="i-simple-icons-nuxtdotjs" />

    <AppFooter />
  </UApp>
</template>
