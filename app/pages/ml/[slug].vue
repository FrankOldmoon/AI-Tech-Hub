<script setup lang="ts">
/**
 * ml 分类的通用分发页 —— 目前只负责 neural-sandbox 那 15 个演示。
 *
 * 这 15 个入口原本各占一个 `.vue`（每个 11 行，唯一差别是传给 NeuralDemoShell 的 name），
 * 合计 165 行只为了把 slug 映射成一个字符串。现在由本文件统一按 `neural-` 前缀分发。
 *
 * 其余 ml 页面（kmeans / mnist / *-training / cnn-explainer 等）都是各自独立的交互应用，
 * 有自己的 `.vue` 文件；Nuxt 里**具体路由优先于动态路由**，因此本文件只会接到没人认领的 slug。
 */
import { neuralNameFromSlug } from '~/utils/neural-demos'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('ml', slug.value))
/** 非 neural-* 或 name 不在清单里 → null → 走「未找到」分支 */
const neuralName = computed(() => neuralNameFromSlug(slug.value))
</script>

<template>
  <div v-if="demo && neuralName">
    <NeuralDemoShell
      :demo="demo"
      :name="neuralName"
    />
  </div>
  <UContainer
    v-else
    class="py-20 text-center text-muted"
  >
    {{ t('demo.notFound') }}
  </UContainer>
</template>
