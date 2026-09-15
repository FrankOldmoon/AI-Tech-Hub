<script setup lang="ts">
/**
 * ReBot Arm B601-RS 机械臂仿真器（独立应用集成示例，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/rebot-arm/（iframe 同源嵌入）
 * - API：/api/apps/rebot-arm/...（URDF/STL/配置）
 * - 外部依赖：ROS2 rosbridge / motorbridge 可选；LLM 未部署
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'rebot-arm')!)

// locale 同步：切语言时 iframe 子应用跟随（?locale=zh|en）
const { locale, withLocale } = useIframeLocale()
const iframeSrc = computed(() => withLocale('/apps/rebot-arm/index.html'))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-plug"
      :title="t('robotArm.externalNote')"
      class="mb-3"
    />
    <DemoIframeLoader :key="locale" :src="iframeSrc" :title="demo.title" allow="microphone; camera" />
  </MediaDemoShell>
</template>
