<script setup lang="ts">
const { t, locale, locales, setLocale } = useI18n()
const route = useRoute()
const { categories } = useDemos()

const navItems = computed(() => [
  ...categories.value.map(c => ({
    label: c.title,
    to: `/${c.slug}`,
    icon: c.icon,
    active: route.path === `/${c.slug}` || route.path.startsWith(`/${c.slug}/`)
  })),
  { label: t('nav.ide'), to: '/ide', icon: 'i-lucide-code', active: route.path === '/ide' }
])

const otherLocales = computed(() =>
  (locales.value as Array<{ code: string, name: string }>).filter(l => l.code !== locale.value)
)

// Apple 式层级：滚动后 header 出现微妙阴影，强化「毛玻璃悬浮」层次（毛玻璃 blur 由 Nuxt UI UHeader 主题内置）
const scrolled = ref(false)
onMounted(() => {
  const onScroll = () => {
    scrolled.value = window.scrollY > 8
  }
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  onScopeDispose(() => window.removeEventListener('scroll', onScroll))
})
</script>

<template>
  <UHeader :class="scrolled ? 'shadow-sm' : ''">
    <template #left>
      <NuxtLink
        to="/"
        class="flex items-center gap-2"
      >
        <AppLogo class="h-6 w-auto shrink-0" />
        <span class="font-bold text-highlighted whitespace-nowrap">{{ t('site.title') }}</span>
      </NuxtLink>
    </template>

    <UNavigationMenu
      :items="navItems"
      variant="link"
      class="hidden md:flex -mb-px"
      :ui="{
        root: 'relative gap-1.5 md:gap-1 lg:gap-1.5 [&>div]:min-w-0 items-center justify-between hidden md:flex -mb-px',
        // 中屏 768–1023px 隐藏导航项图标（每项省 ~20px），腾出空间给右侧按钮；lg+ 恢复图标+文字
        linkLeadingIcon: 'shrink-0 size-5 hidden lg:block'
      }"
    />

    <template #right>
      <UButton
        v-for="l in otherLocales"
        :key="l.code"
        :label="l.name"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="setLocale(l.code as any)"
      />
      <UColorModeButton />
      <UButton
        to="https://github.com/FrankOldmoon/AI-Tech-Hub"
        target="_blank"
        icon="i-simple-icons-github"
        aria-label="GitHub"
        color="neutral"
        variant="ghost"
      />
    </template>

    <template #body>
      <UNavigationMenu
        :items="navItems"
        orientation="vertical"
      />
    </template>
  </UHeader>
</template>
