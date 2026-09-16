<script setup lang="ts">
/**
 * neural-sandbox 外部 demo 通用套壳（iframe 同源嵌入 public/apps/neural-sandbox/demos/<name>/）
 * 15 个交互演示：进化 / RL / 监督学习 / 扩散 / 涌现 / 混沌 / 算法可视化。
 *
 * 它只负责「按 name 拼 iframe 地址 + 套上页头」。
 * 演示之间的切换由全站左栏（AppSidebar 按分类列出全部 demo）承担 —— 曾试过在这里再加一条
 * 列出这 15 项的侧栏，但那与 AppSidebar 完全重复（同一批链接、同一分类），故撤掉。
 */
const props = defineProps<{
  demo: {
    title: string
    description?: string
    icon: string
    status: 'ready' | 'planned'
    slug?: string
    category?: string
    howItWorks?: string
  }
  name: string
}>()

// locale 同步：切语言时 iframe 子应用跟随（?locale=zh|en）
const { locale, withLocale } = useIframeLocale()
const iframeSrc = computed(() => withLocale(`/apps/neural-sandbox/demos/${props.name}/index.html`))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      :title="$t('neuralSandbox.externalNote')"
      class="mb-3"
    />
    <!-- 大体积子应用按需加载：点击后才创建 iframe（P1-4） -->
    <DemoIframeLoader
      :key="locale"
      :src="iframeSrc"
      :title="demo.title"
    />
  </MediaDemoShell>
</template>
