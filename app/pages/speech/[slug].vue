<script setup lang="ts">
/**
 * 语音通用页面（能力 × 引擎双轴统一分发）——与 vision/[slug].vue 同构。
 *
 * 页面归属完全由工具注册表（utils/audio-tools 的 AudioTool.pages）决定：
 *   - 能力页（asr / tts / audio-classification）：一个任务 × 多种引擎，侧栏按**引擎**分组
 *   - 引擎页（whisper / kokoro / yamnet）：一个引擎 × 多种任务，侧栏按**任务族**分组
 *
 * slug 不在注册表内 -> 提示未找到（旧 slug 由 nuxt.config 的 routeRules 301 到新页面）。
 */
import { audioPageSamples, audioToolsByPage } from '~/utils/audio-tools'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('speech', slug.value))
const tools = computed(() => audioToolsByPage(slug.value))

// 各页专属示例音频（labelKey 解析为 i18n 文案；未配置的页回落 AudioPlayground 的通用列表）
const pageSamples = computed(() => {
  const list = audioPageSamples[slug.value as keyof typeof audioPageSamples]
  return list ? list.map(s => ({ label: t(s.labelKey), url: s.url })) : null
})
</script>

<template>
  <div v-if="demo && tools.length">
    <ClientOnly>
      <AudioPlayground
        :demo="demo"
        :tools="tools"
        :samples="pageSamples"
      />
      <template #fallback>
        <div class="py-20 flex items-center justify-center">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-8 animate-spin text-muted"
          />
        </div>
      </template>
    </ClientOnly>
  </div>
  <UContainer
    v-else
    class="py-16"
  >
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-file-question"
      :title="t('demo.notFound')"
    />
  </UContainer>
</template>
