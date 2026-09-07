<script setup lang="ts">
/**
 * CNN Explainer（poloclub，独立应用集成，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/cnn-explainer/（iframe 同源嵌入，纯静态无后端）
 * - 内容：Tiny VGG 卷积层内部可视化（TensorFlow.js），讲解卷积/激活/池化/Softmax
 * - 上游：github.com/poloclub/cnn-explainer @ d0971f9（MIT），资源全部本地化
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'cnn-explainer')!)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-scan-search"
      :title="t('cnnExplainer.externalNote')"
      class="mb-3"
    />
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        src="/apps/cnn-explainer/index.html"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
