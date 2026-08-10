<script setup lang="ts">
import type { TextTaskConfig } from '~/utils/mediapipe-text'
import type { TransformersTextTaskConfig } from '~/utils/transformers'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('nlp', slug.value))

// 两种任务类型：MediaPipe 文本 / transformers.js 文本
type TaskKind = 'mediapipe' | 'transformers'
const taskKind = ref<TaskKind | null>(null)
const mpCfg = ref<TextTaskConfig | null>(null)
const tfCfg = ref<TransformersTextTaskConfig | null>(null)

onMounted(async () => {
  // 先查 MediaPipe 文本任务
  const mpMod = await import('~/utils/mediapipe-text')
  const mp = mpMod.textTasks[slug.value]
  if (mp) {
    mpCfg.value = mp
    taskKind.value = 'mediapipe'
    return
  }
  // 再查 transformers.js 文本任务
  const tfMod = await import('~/utils/transformers')
  const tf = tfMod.transformersTextTasks[slug.value]
  if (tf) {
    tfCfg.value = tf
    taskKind.value = 'transformers'
  }
})

const createTask = computed(() => mpCfg.value?.create ?? null)
const method = computed(() => mpCfg.value?.method ?? 'classify')
</script>

<template>
  <div v-if="demo">
    <ClientOnly>
      <!-- MediaPipe 文本任务 -->
      <MediaTextRunner
        v-if="taskKind === 'mediapipe' && createTask"
        :demo="demo"
        :create-task="createTask!"
        :method="method"
      >
        <template #result="{ result }">
          <!-- 文本分类：classifications[0].categories -->
          <div v-if="result?.classifications?.[0]?.categories?.length" class="space-y-2">
            <div
              v-for="(c, i) in result.classifications[0].categories"
              :key="i"
              class="flex items-center justify-between gap-4"
            >
              <span class="text-sm">{{ c.categoryName }}</span>
              <div class="flex items-center gap-2 flex-1 max-w-xs">
                <UProgress :model-value="Math.round(c.score * 100)" size="sm" />
                <span class="text-sm text-muted w-12 text-right">{{ Math.round(c.score * 100) }}%</span>
              </div>
            </div>
          </div>
          <!-- 语言检测：languages -->
          <div v-else-if="result?.languages?.length" class="space-y-2">
            <div
              v-for="(l, i) in result.languages"
              :key="i"
              class="flex items-center justify-between gap-4"
            >
              <span class="text-sm font-mono">{{ l.languageCode }}</span>
              <div class="flex items-center gap-2 flex-1 max-w-xs">
                <UProgress :model-value="Math.round(l.probability * 100)" size="sm" />
                <span class="text-sm text-muted w-12 text-right">{{ Math.round(l.probability * 100) }}%</span>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-muted">
            —
          </div>
        </template>
      </MediaTextRunner>

      <!-- transformers.js 文本任务 -->
      <TransformersTextRunner
        v-else-if="taskKind === 'transformers' && tfCfg"
        :demo="demo"
        :config="tfCfg"
      >
        <template #result="{ result }">
          <!-- 列表项形式（ner / zero-shot / qa / fill-mask）-->
          <div v-if="tfCfg?.parseItems && result" class="space-y-2">
            <div
              v-for="(item, i) in tfCfg.parseItems(result)"
              :key="i"
              class="flex items-center justify-between gap-4"
            >
              <div class="min-w-0">
                <span class="text-sm font-medium">{{ item.label }}</span>
                <span v-if="item.value" class="text-sm text-muted ms-2 truncate">{{ item.value }}</span>
              </div>
              <div v-if="item.score !== undefined" class="flex items-center gap-2 flex-1 max-w-xs">
                <UProgress :model-value="Math.round(item.score * 100)" size="sm" />
                <span class="text-sm text-muted w-12 text-right">{{ Math.round(item.score * 100) }}%</span>
              </div>
            </div>
          </div>
          <!-- 纯文本形式（summarization）-->
          <div v-else-if="tfCfg?.parseText && result" class="text-sm leading-relaxed whitespace-pre-wrap">
            {{ tfCfg.parseText(result) }}
          </div>
          <div v-else class="text-sm text-muted">
            —
          </div>
        </template>
      </TransformersTextRunner>

      <template #fallback>
        <div class="py-20 flex items-center justify-center">
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-muted" />
        </div>
      </template>
    </ClientOnly>
  </div>
  <UContainer v-else>
    <div class="py-20 text-center text-muted">
      Demo not found.
    </div>
  </UContainer>
</template>
