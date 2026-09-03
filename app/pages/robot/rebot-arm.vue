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
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        src="/apps/rebot-arm/index.html"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allow="microphone; camera"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
