<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { processImageFile } from '~/utils/image'
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
// SSR 与客户端初始保持一致（false），挂载后再检测，避免 hydration mismatch
const webgpu = ref(false)
onMounted(() => {
  webgpu.value = hasWebGPU()
  // 课堂演示：打开页面自动加载风景示例图并生成描述
  useSample('/samples/images/urban-street.jpg')
})

const modelItems = [
  // BLIP (Xenova/blip-image-captioning-base) 是 HuggingFace gated 仓库，匿名无法下载，已移除
  { label: 'ViT-GPT2 Image Captioning', value: transformersModels.imageCaptioning }
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
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
  return pipe
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    // 先解码为标准 PNG（处理 HEIC/超大图等 createImageBitmap 不支持的输入）
    imgSrc.value = await processImageFile(file)
    caption.value = ''
    await run()
  } catch (err: any) {
    error.value = err?.message || String(err)
    imgSrc.value = ''
  }
  input.value = ''
}

async function useSample(url: string) {
  try {
    const file = await fetchSampleFile(url)
    imgSrc.value = await processImageFile(file)
    caption.value = ''
    error.value = null
    await run()
  } catch (err: any) {
    error.value = err?.message || String(err)
    imgSrc.value = ''
  }
}

const { samples, fetchSampleFile } = useVisionSamples()

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
    error.value = humanError(e, t)
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
      <SampleImagePicker
        :samples="samples"
        @pick="useSample"
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
