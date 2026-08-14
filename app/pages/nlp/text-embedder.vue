<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('nlp', 'text-embedder')!)

const text1 = ref('')
const text2 = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const similarity = ref<number | null>(null)
const inferenceTime = ref(0)

const specs = computed<ParamSpec[]>(() => [
  { key: 'l2Normalize', label: t('params.l2Normalize'), type: 'switch', default: false, help: t('params.l2NormalizeHelp') },
  { key: 'quantize', label: t('params.quantize'), type: 'switch', default: false, help: t('params.quantizeHelp') }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let embedder: any = null
let TextEmbedderCtor: any = null

async function ensure() {
  loading.value = true
  error.value = null
  try {
    const { FilesetResolver, TextEmbedder } = await import('@mediapipe/tasks-text')
    TextEmbedderCtor = TextEmbedder
    const text = await FilesetResolver.forTextTasks(mediapipeWasm.text)
    // 重建以应用 l2Normalize / quantize（这两个选项需在创建时指定）
    if (embedder) { embedder.close?.(); embedder = null }
    embedder = await TextEmbedder.createFromOptions(text, {
      baseOptions: { modelAssetPath: mediapipeModels.textEmbedder },
      l2Normalize: Boolean(params.value.l2Normalize),
      quantize: Boolean(params.value.quantize)
    })
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
  return embedder
}

// 选项变更后失效缓存，下次 compute 重建
watch(params, () => {
  if (embedder) { embedder.close?.(); embedder = null }
  similarity.value = null
}, { deep: true })

async function compute() {
  if (!text1.value.trim() || !text2.value.trim()) return
  const e = await ensure()
  if (!e) return
  loading.value = true
  error.value = null
  similarity.value = null
  const ts = performance.now()
  try {
    const r1 = e.embed(text1.value)
    const r2 = e.embed(text2.value)
    similarity.value = TextEmbedderCtor.cosineSimilarity(r1.embeddings[0], r2.embeddings[0])
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('textEmbedder.textA') }}</label>
        <UTextarea v-model="text1" :rows="4" placeholder="Enter text A…" class="w-full" />
      </div>
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('textEmbedder.textB') }}</label>
        <UTextarea v-model="text2" :rows="4" placeholder="Enter text B…" class="w-full" />
      </div>
    </div>

    <div class="flex items-center gap-2">
      <UButton
        icon="i-lucide-play"
        :label="t('demo.run')"
        color="primary"
        :loading="loading"
        :disabled="!text1.trim() || !text2.trim()"
        @click="compute"
      />
      <span v-if="inferenceTime" class="text-sm text-muted ms-2">{{ inferenceTime }} ms</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="loading" />

    <UCard>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted">{{ t('textEmbedder.cosineSimilarity') }}</span>
        <span v-if="similarity !== null" class="text-2xl font-bold text-highlighted">
          {{ similarity.toFixed(4) }}
        </span>
        <span v-else class="text-sm text-muted">{{ loading ? 'computing…' : '—' }}</span>
      </div>
    </UCard>
  </MediaDemoShell>
</template>
