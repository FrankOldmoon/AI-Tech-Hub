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

/** 全屏控制（测试：验证定时自动部署链路） */
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
      icon="i-lucide-plug"
      :title="t('robotArm.externalNote')"
      class="mb-3"
    />
    <div class="flex justify-end mb-2">
      <UButton
        :icon="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
        :label="isFullscreen ? t('robotArm.exitFullscreen') : t('robotArm.fullscreen')"
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
        src="/apps/rebot-arm/index.html"
        class="w-full border-0"
        :class="{ 'flex-1': isFullscreen }"
        :style="{ height: isFullscreen ? '100%' : '85vh' }"
        :title="demo.title"
        allow="microphone; camera"
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
