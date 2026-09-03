<script setup lang="ts">
/**
 * neural-sandbox 外部 demo 通用套壳（iframe 同源嵌入 public/apps/neural-sandbox/demos/<name>/）
 * 15 个非机器人 AI 交互演示（进化 / RL / 监督学习 / 扩散 / 涌现 / 混沌 / 算法可视化）
 */
defineProps<{
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
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        :src="`/apps/neural-sandbox/demos/${name}/index.html`"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
