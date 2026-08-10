<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { setupTransformersEnv, preferredDevice, hasWebGPU, transformersModels } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'image-captioning')!)

const fileInput = ref<HTMLInputElement>()
const imgSrc = ref('')
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const caption = ref('')
const inferenceTime = ref(0)
const webgpu = ref(hasWebGPU())

const modelItems = [
  { label: 'ViT-GPT2 Image Captioning', value: transformersModels.imageCaptioning },
  { label: 'BLIP Image Captioning', value: 'Xenova/blip-image-captioning-base' }
]
const modelId = ref(modelItems[0]!.value)

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'maxNewTokens',
    label: t('tf.maxNewTokens'),
    type: 'slider',
    default: 50,
    min: 10,
    max: 200,
    step: 5
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let pipe: any = null
let envReady = false

async function ensurePipeline() {
  if (pipe) return pipe
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { pipeline } = await import('@huggingface/transformers')
    pipe = await pipeline('image-to-text' as any, modelId.value, {
      device: preferredDevice(),
      dtype: 'q8'
    } as any)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
  return pipe
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  imgSrc.value = URL.createObjectURL(file)
  caption.value = ''
  await run()
  input.value = ''
}

async function run() {
  if (!imgSrc.value) return
  const p = await ensurePipeline()
  if (!p) return
  running.value = true
  error.value = null
  caption.value = ''
  const ts = performance.now()
  try {
    const out = await p(imgSrc.value, { max_new_tokens: Number(params.value.maxNewTokens) })
    // 输出 [{ generated_text }]
    const arr = Array.isArray(out) ? out : [out]
    caption.value = arr[0]?.generated_text || ''
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    running.value = false
  }
}

async function onModelChange() {
  if (pipe) {
    try { await pipe.dispose() } catch { /* ignore */ }
    pipe = null
  }
  if (imgSrc.value) run()
}

onBeforeUnmount(async () => {
  try { if (pipe) await pipe.dispose() } catch { /* ignore */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-end gap-4">
      <div class="min-w-56 flex-1">
        <label class="block text-sm font-medium text-muted mb-1">{{ t('tf.model') }}</label>
        <USelect
          v-model="modelId"
          :items="modelItems"
          :disabled="loading || running"
          class="w-full"
          @change="onModelChange"
        />
      </div>
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM</UBadge>
      <UButton
        icon="i-lucide-upload"
        :label="t('mp.upload')"
        color="primary"
        variant="subtle"
        :disabled="loading || running"
        @click="fileInput?.click()"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
      <span v-if="inferenceTime" class="text-sm text-muted ms-2">{{ inferenceTime }} ms</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('tf.inputImage') }}</label>
        <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-elevated/60 flex items-center justify-center border border-dashed border-default">
          <img v-if="imgSrc" :src="imgSrc" class="w-full h-full object-contain">
          <UIcon v-else name="i-lucide-image-plus" class="size-8 text-muted" />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('demo.result') }}</label>
        <UCard class="h-full">
          <div v-if="running" class="flex items-center gap-2 text-sm text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            {{ t('tf.generating') }}
          </div>
          <p v-else-if="caption" class="text-base leading-relaxed text-highlighted">
            {{ caption }}
          </p>
          <p v-else class="text-sm text-muted">
            {{ t('tf.captionHint') }}
          </p>
        </UCard>
      </div>
    </div>

    <DemoParams v-model="params" :specs="specs" :running="running" />
  </MediaDemoShell>
</template>
