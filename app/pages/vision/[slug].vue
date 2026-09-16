<script setup lang="ts">
/**
 * 视觉分类通用页面（能力 × 引擎双轴统一分发）。
 *
 * 所有视觉页都由工具注册表驱动：ImagePlayground 负责「左侧工具栏（可分组）+ 上传/示例/拍照/实时 + 结果」，
 * 页面归属由 ImageTool 的 page / pages 决定（见 ~/utils/image-tools 的 toolPages）：
 *   - 图像工坊（viewer / transform / …）      ：经典算法与文档，单引擎
 *   - 引擎页（mediapipe / yolo / transformers）：一个模型库的全部任务，侧栏按任务族分组
 *   - 能力页（detection / classification / …） ：同一任务的多引擎实现，侧栏按引擎分组
 *
 * slug 不在注册表内 -> 提示未找到（旧 slug 由 nuxt.config routeRules 301 到对应能力页/引擎页）。
 */
import { imagePageSamples, imageToolsByPage } from '~/utils/image-tools'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('vision', slug.value))
const tools = computed(() => imageToolsByPage(slug.value))

// 各页专属示例图（labelKey 解析为 i18n 文案；未配置的页回落 ImagePlayground 的通用列表）
const pageSamples = computed(() => {
  const list = imagePageSamples[slug.value as keyof typeof imagePageSamples]
  return list ? list.map(s => ({ label: t(s.labelKey), url: s.url, secondUrl: s.secondUrl })) : null
})
</script>

<template>
  <div v-if="demo && tools.length">
    <ClientOnly>
      <ImagePlayground
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
