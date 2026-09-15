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

// locale 同步：切语言时 iframe 子应用跟随（?locale=zh|en）
const { locale, withLocale } = useIframeLocale()
const iframeSrc = computed(() => withLocale('/apps/g1-motion-tracking/index.html'))
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
    <DemoIframeLoader :key="locale" :src="iframeSrc" :title="demo.title" />
  </MediaDemoShell>
</template>
