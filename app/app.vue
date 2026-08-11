<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = computed(() => t('site.title'))
const description = computed(() => t('site.description'))

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
})

// 首页和 IDE 页面不显示侧边栏
const showSidebar = computed(() => route.path !== '/' && !route.path.startsWith('/ide'))

// 小屏侧边栏（Slideover）状态
const mobileOpen = ref(false)

// 路由变化时自动关闭 slideover
watch(() => route.path, () => {
  mobileOpen.value = false
})
</script>

<template>
  <UApp>
    <AppHeader />

    <UMain>
      <div class="flex">
        <!-- 大屏：固定侧边栏 -->
        <AppSidebar v-if="showSidebar" class="hidden lg:block" />

        <div class="flex-1 min-w-0">
          <!-- 小屏：菜单按钮 -->
          <div v-if="showSidebar" class="lg:hidden p-3 border-b border-default">
            <UButton
              icon="i-lucide-menu"
              color="neutral"
              variant="ghost"
              :label="t('nav.menu')"
              @click="mobileOpen = true"
            />
          </div>
          <NuxtPage />
        </div>
      </div>
    </UMain>

    <!-- 小屏：Slideover 弹出侧边栏 -->
    <USlideover
      v-if="showSidebar"
      v-model:open="mobileOpen"
      side="left"
      :title="t('nav.menu')"
    >
      <template #body>
        <AppSidebar embedded />
      </template>
    </USlideover>

    <USeparator icon="i-simple-icons-nuxtdotjs" />

    <AppFooter />
  </UApp>
</template>
