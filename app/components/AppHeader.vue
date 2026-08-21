<script setup lang="ts">
const { t, locale, locales, setLocale } = useI18n()
const route = useRoute()
const { categories } = useDemos()

const navItems = computed(() => [
  { label: t('nav.home'), to: '/', icon: 'i-lucide-home', active: route.path === '/' },
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
      <NuxtLink to="/" class="flex items-center gap-2">
        <AppLogo class="h-6 w-auto" />
        <span class="font-bold text-highlighted">{{ t('site.title') }}</span>
      </NuxtLink>
    </template>

    <UNavigationMenu
      :items="navItems"
      variant="link"
      class="hidden md:flex -mb-px"
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
        to="https://github.com/ikeee/nuxt-ai"
        target="_blank"
        icon="i-simple-icons-github"
        aria-label="GitHub"
        color="neutral"
        variant="ghost"
      />
    </template>

    <template #body>
      <UNavigationMenu :items="navItems" orientation="vertical" />
    </template>
  </UHeader>
</template>
