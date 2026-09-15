<script setup lang="ts">
/**
 * MicroDuck 微鸭仿真器（独立应用集成，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/microduck/（iframe 同源嵌入，纯静态无后端）
 * - 运行时：MuJoCo(WASM) + onnxruntime-web 全本地，无需外部依赖
 * - 多人幽灵（Trystero/Nostr）需公网，内网自动静默禁用
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'microduck')!)

// locale 同步：切语言时 iframe 子应用跟随（?locale=zh|en）
const { locale, withLocale } = useIframeLocale()
const iframeSrc = computed(() => withLocale('/apps/microduck/index.html'))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-bird"
      :title="t('microduck.externalNote')"
      class="mb-3"
    />
    <DemoIframeLoader :key="locale" :src="iframeSrc" :title="demo.title" />
  </MediaDemoShell>
</template>
