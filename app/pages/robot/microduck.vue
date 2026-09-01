<script setup lang="ts">
/**
 * MicroDuck 微鸭仿真器（独立应用集成，见 docs/APP-INTEGRATION-GUIDE.md）
 * - 前端：public/apps/microduck/（iframe 同源嵌入，纯静态无后端）
 * - 运行时：MuJoCo(WASM) + onnxruntime-web 全本地，无需外部依赖
 * - 多人幽灵（Trystero/Nostr）需公网，内网自动静默禁用
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'microduck')!)

/** 全屏控制（与 rebot-arm 一致的交互） */
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
      icon="i-lucide-bird"
      :title="t('microduck.externalNote')"
      class="mb-3"
    />
    <div class="flex justify-end mb-2">
      <UButton
        :icon="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
        :label="isFullscreen ? t('microduck.exitFullscreen') : t('microduck.fullscreen')"
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
        src="/apps/microduck/index.html"
        class="w-full border-0"
        :class="{ 'flex-1': isFullscreen }"
        :style="{ height: isFullscreen ? '100%' : '85vh' }"
        :title="demo.title"
        loading="lazy"
      />
    </div>
  </MediaDemoShell>
</template>
