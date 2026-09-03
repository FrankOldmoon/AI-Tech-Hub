<script setup lang="ts">
/**
 * mjswan RL 机器人仿真（G1 人形 + Cartpole 平衡，独立应用集成，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/g1-cartpole/（iframe 同源嵌入，纯静态无后端）
 * - 运行时：MuJoCo(WASM) + ONNX 策略（mjswan 构建，base_path=/apps/g1-cartpole/）
 * - 两个场景：G1 人形（宇树官方 RL 走路策略）/ Cartpole 平衡（本机 PPO 从零训练）
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'g1-cartpole')!)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-person-standing"
      :title="t('g1Cartpole.externalNote')"
      class="mb-3"
    />
    <div class="rounded-lg overflow-hidden ring ring-default bg-default">
      <iframe
        src="/apps/g1-cartpole/index.html"
        class="w-full border-0"
        style="height: 85vh"
        :title="demo.title"
        allowfullscreen
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
