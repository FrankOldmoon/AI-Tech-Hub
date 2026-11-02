<script setup lang="ts">
/**
 * 按需加载 iframe（P1-4 部署瘦身）
 * - 默认（eager=false）：未点击前不创建 iframe，仅显示占位卡片 —— 首屏/滚动不拉取子应用资源
 * - eager=true：进入页面就创建 iframe（robot 的仿真页用这个模式，用户不必再点一次），
 *   加载期间盖一层遮罩，避免重型应用（12 MB + wasm 的 g1-motion-tracking）白屏几十秒
 * - locale 变化由父组件 :key="locale" 重建本组件（与原有行为一致）
 *
 * ⚠️ eager 的 iframe 必须**客户端**创建，不能在 SSR 里输出：
 * SSR 出的 <iframe> 标签在 HTML 到达时就开始加载，等 hydration 绑上 @load 时
 * 事件早过去了，遮罩会永远不消失（本地资源快的时候 100% 复现）。
 * 所以 eager 也走 mounted 再置 loaded，让 load 监听先于加载挂好。
 */
const props = withDefaults(defineProps<{
  src: string
  title: string
  /** 占位/iframe 高度，默认 85vh（与改造前一致） */
  height?: string
  /** iframe allow 属性透传（如 rebot-arm 需要麦克风/摄像头） */
  allow?: string
  /** 进入页面即加载，跳过「点击加载」占位 */
  eager?: boolean
}>(), {
  height: '85vh',
  allow: undefined,
  eager: false
})

/** 是否已创建 iframe（eager 时在 mounted 置 true，见文件头说明） */
const loaded = ref(false)
/** 子应用文档加载完成，收起遮罩 */
const ready = ref(false)
/** 遮罩兜底：子应用自己也有加载界面，遮罩不能无限停留 */
const READY_TIMEOUT_MS = 15000
let readyTimer: ReturnType<typeof setTimeout> | null = null

function clearReadyTimer() {
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = null
}

onMounted(() => {
  if (props.eager) loaded.value = true
})

watch(loaded, (isLoaded) => {
  if (!isLoaded) return
  clearReadyTimer()
  readyTimer = setTimeout(() => {
    ready.value = true
  }, READY_TIMEOUT_MS)
})

onBeforeUnmount(clearReadyTimer)
</script>

<template>
  <div
    class="relative rounded-lg overflow-hidden ring ring-default bg-default"
    :style="{ height: props.height }"
  >
    <button
      v-if="!loaded"
      type="button"
      class="w-full h-full flex flex-col items-center justify-center gap-3 text-muted hover:text-highlighted transition-colors"
      :aria-label="props.title"
      @click="loaded = true"
    >
      <UIcon name="i-lucide-play-circle" class="size-10 opacity-60" />
      <span class="text-sm font-medium px-6 text-center">{{ props.title }}</span>
      <span class="text-xs opacity-70">{{ $t('lazyIframe.clickToLoad') }}</span>
    </button>
    <iframe
      v-else
      :src="props.src"
      class="w-full h-full border-0"
      :title="props.title"
      :allow="props.allow"
      allowfullscreen
      :loading="props.eager ? 'eager' : 'lazy'"
      @load="ready = true"
    />

    <!-- eager 模式的加载反馈：子应用要下载 js + wasm + 模型，中间这段时间不能是纯白 -->
    <div
      v-if="loaded && !ready"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-default text-muted pointer-events-none"
    >
      <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin opacity-70" />
      <span class="text-sm">{{ $t('lazyIframe.loading') }}</span>
    </div>
  </div>
</template>
