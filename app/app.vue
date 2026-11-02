<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const fullscreen = computed(() => route.meta.fullscreen === true)

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    // 安装成 PWA 后浏览器窗口着色：跟随系统明暗，避免浅色界面配深色标题栏
    { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: '#0b1220', media: '(prefers-color-scheme: dark)' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/icon-192.png' },
    { rel: 'manifest', href: '/manifest.webmanifest' }
  ],
  htmlAttrs: {
    // 用完整的 locale code：zh-Hans / zh-Hant-HK 让浏览器的断行、字体回退、
    // 朗读都按对应字形走（只写 zh / en 的话，香港繁体页面会拿到简体字形的字体栈）
    lang: computed(() => {
      const lc = String(locale.value).toLowerCase()
      if (lc.startsWith('zh-hk')) return 'zh-Hant-HK'
      if (lc.startsWith('zh')) return 'zh-Hans'
      return 'en'
    })
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
    <AppHeader v-if="!fullscreen" />

    <UMain :class="fullscreen ? 'min-h-0' : ''">
      <NuxtLayout>
        <NuxtPage
          :transition="{ name: 'page', mode: 'out-in' }"
        />
      </NuxtLayout>
    </UMain>

    <template v-if="!fullscreen">
      <USeparator icon="i-simple-icons-nuxtdotjs" />
      <AppFooter />
    </template>

    <!-- 统计合规告知横幅（P2-3）：全局展示（fullscreen 页除外），仅首次访问出现，同意/拒绝后不再打扰 -->
    <CookieConsent v-if="!fullscreen" />
  </UApp>
</template>
