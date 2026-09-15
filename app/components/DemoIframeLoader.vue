<script setup lang="ts">
/**
 * 按需加载 iframe（P1-4 部署瘦身）
 * - 未点击前不创建 iframe，仅显示占位卡片：页面首屏/滚动不拉取子应用任何资源
 * - 点击后创建 iframe（保留 loading="lazy"），行为对用户透明
 * - locale 变化由父组件 :key="locale" 重建本组件（与原有行为一致）
 */
const props = withDefaults(defineProps<{
  src: string
  title: string
  /** 占位/iframe 高度，默认 85vh（与改造前一致） */
  height?: string
  /** iframe allow 属性透传（如 rebot-arm 需要麦克风/摄像头） */
  allow?: string
}>(), {
  height: '85vh',
  allow: undefined
})

const loaded = ref(false)
</script>

<template>
  <div
    class="rounded-lg overflow-hidden ring ring-default bg-default"
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
      loading="lazy"
    />
  </div>
</template>