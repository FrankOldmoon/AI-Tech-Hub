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
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        src="/apps/uaibot-kinematics/index.html"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
