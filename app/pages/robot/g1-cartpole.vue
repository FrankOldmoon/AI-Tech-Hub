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

/** 全屏控制（与 rebot-arm/microduck 一致） */
const containerRef = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    containerRef.value?.requestFullscreen?.()
  }
}

onMounted(() => {
  const onFsChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }
  document.addEventListener('fullscreenchange', onFsChange)
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFsChange)
  })
})
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
    <div class="flex justify-end mb-2">
      <UButton
        :icon="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
        :label="isFullscreen ? t('g1Cartpole.exitFullscreen') : t('g1Cartpole.fullscreen')"
        color="neutral"
        variant="soft"
        size="sm"
        @click="toggleFullscreen"
      />
    </div>
    <div
      ref="containerRef"
      class="rounded-lg overflow-hidden ring ring-default bg-default"
      :class="{ 'flex flex-col': isFullscreen }"
    >
      <iframe
        src="/apps/g1-cartpole/index.html"
        class="w-full border-0"
        :class="{ 'flex-1': isFullscreen }"
        :style="{ height: isFullscreen ? '100%' : '85vh' }"
        :title="demo.title"
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
