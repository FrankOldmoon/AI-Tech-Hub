<script setup lang="ts">
/**
 * 机械臂运动学（UAIBot 封装，独立应用集成，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/uaibot-kinematics/（iframe 同源嵌入，纯静态无后端）
 * - 内容：6-DoF KUKA KR5 关节空间控制 + 末端位姿（正运动学）演示
 * - 上游：github.com/UAIbot/UAIbotJS @ f4a367d（MIT），three/mathjs 本地化
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'uaibot-kinematics')!)

// locale 同步：切语言时 iframe 子应用跟随（?locale=zh|en）
const { locale, withLocale } = useIframeLocale()
const iframeSrc = computed(() => withLocale('/apps/uaibot-kinematics/index.html'))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-move-3d"
      :title="t('uaibotKinematics.externalNote')"
      class="mb-3"
    />
    <DemoIframeLoader :key="locale" :src="iframeSrc" :title="demo.title" />
  </MediaDemoShell>
</template>
