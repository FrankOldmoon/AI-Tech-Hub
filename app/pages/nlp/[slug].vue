<script setup lang="ts">
/**
 * NLP 通用页面（能力 × 引擎双轴统一分发）——与 vision/[slug].vue、speech/[slug].vue 同构。
 *
 * 改造前：这里用 `onMounted` + 动态 import 在**两份按 slug 索引的注册表**之间
 * 「先查 MediaPipe、再查 Transformers」解析 slug，于是
 *   1) 一个任务只能属于一个页面（双轴不成立）；
 *   2) 结果渲染必须在页面里手写两个大 `#result` 模板（本文件曾有 193 行）。
 * 现在归属由 `utils/nlp-tools` 的 `NlpTool.pages` 决定，渲染交给 `NlpPlayground`。
 *
 * slug 不在注册表内 -> 提示未找到。
 */
import { nlpToolsByPage } from '~/utils/nlp-tools'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('nlp', slug.value))
const tools = computed(() => nlpToolsByPage(slug.value))
</script>

<template>
  <div v-if="demo && tools.length">
    <ClientOnly>
      <NlpPlayground
        :demo="demo"
        :tools="tools"
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
    class="py-20 text-center text-muted"
  >
    {{ t('demo.notFound') }}
  </UContainer>
</template>
