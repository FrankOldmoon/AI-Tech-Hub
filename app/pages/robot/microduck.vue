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
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        src="/apps/microduck/index.html"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
