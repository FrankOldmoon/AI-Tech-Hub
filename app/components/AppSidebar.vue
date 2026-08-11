<script setup lang="ts">
/**
 * 全站功能导航侧边栏。
 * - 父级：功能分类（可折叠/展开）
 * - 子级：分类下的各功能页面
 * - 当前路由所在分类自动展开，当前页面高亮
 * - embedded 模式：用于 Slideover/Drawer 内部，去掉固定定位
 */
const props = withDefaults(defineProps<{
  embedded?: boolean
}>(), { embedded: false })

const route = useRoute()
const { categories, byCategory } = useDemos()

const activeCategory = computed(() => route.path.split('/')[1] || '')

// 展开状态：当前分类自动展开
const expanded = ref<Set<string>>(new Set<string>())

watch(activeCategory, (cat) => {
  if (cat) expanded.value.add(cat)
}, { immediate: true })

function toggle(slug: string) {
  const s = new Set(expanded.value)
  if (s.has(slug)) s.delete(slug)
  else s.add(slug)
  expanded.value = s
}

function isExpanded(slug: string) {
  return expanded.value.has(slug)
}

function isDemoActive(catSlug: string, demoSlug: string) {
  return route.path === `/${catSlug}/${demoSlug}`
}
</script>

<template>
  <aside
    :class="[
      'overflow-y-auto',
      embedded
        ? 'h-full w-full'
        : 'w-60 shrink-0 border-r border-default h-[calc(100dvh-4rem)] sticky top-16 self-start'
    ]"
  >
    <nav class="p-3 space-y-0.5">
      <template v-for="cat in categories" :key="cat.slug">
        <!-- 父级：分类 -->
        <div class="flex items-center rounded-lg" :class="activeCategory === cat.slug ? 'bg-primary/10' : ''">
          <NuxtLink
            :to="`/${cat.slug}`"
            class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium flex-1 min-w-0"
            :class="activeCategory === cat.slug ? 'text-primary' : 'text-muted hover:text-highlighted'"
          >
            <UIcon :name="cat.icon" class="size-4 shrink-0" />
            <span class="truncate">{{ cat.title }}</span>
          </NuxtLink>
          <button
            type="button"
            class="p-1.5 me-1 text-dimmed hover:text-highlighted rounded shrink-0"
            :aria-label="isExpanded(cat.slug) ? 'Collapse' : 'Expand'"
            @click="toggle(cat.slug)"
          >
            <UIcon
              name="i-lucide-chevron-down"
              class="size-3.5 transition-transform"
              :class="isExpanded(cat.slug) ? 'rotate-180' : ''"
            />
          </button>
        </div>

        <!-- 子级：功能页面 -->
        <div v-if="isExpanded(cat.slug)" class="ml-4 mt-0.5 space-y-0.5 pb-1">
          <NuxtLink
            v-for="demo in byCategory(cat.slug)"
            :key="demo.slug"
            :to="`/${cat.slug}/${demo.slug}`"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm min-w-0"
            :class="isDemoActive(cat.slug, demo.slug)
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted hover:bg-elevated/60 hover:text-highlighted'"
          >
            <UIcon :name="demo.icon" class="size-3.5 shrink-0" />
            <span class="truncate">{{ demo.title }}</span>
          </NuxtLink>
        </div>
      </template>
    </nav>
  </aside>
</template>
