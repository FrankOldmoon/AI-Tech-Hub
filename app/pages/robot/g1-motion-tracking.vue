<script setup lang="ts">
/**
 * G1 动作跟踪（Humanoid Policy Viewer，独立应用集成，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/g1-motion-tracking/（iframe 同源嵌入，纯静态无后端）
 * - 运行时：mujoco-js(MuJoCo WASM) + onnxruntime-web 追踪策略（Vue3+Vuetify，非 mjswan 生态）
 * - 玩法：G1 跟参考动作（走/跑/跳/舞蹈/格斗等 ~15 条）；Compliance 柔顺度开关可拖拽机器人
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'g1-motion-tracking')!)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-person-standing"
      :title="t('g1MotionTracking.externalNote')"
      class="mb-3"
    />
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        src="/apps/g1-motion-tracking/index.html"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
