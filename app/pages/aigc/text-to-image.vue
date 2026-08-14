<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { processImageFile } from '~/utils/image'
import { setupTransformersEnv, hasWebGPU } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'text-to-image')!)

const tab = ref<'generate' | 'understand'>('generate')
const prompt = ref('a white cat sitting under the moonlight, digital art, highly detailed')
const question = ref('What is in this picture?')
const imgSrc = ref('')
const answer = ref('')
const generatedUrl = ref('')
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const modelReady = ref(false)
const inferenceTime = ref(0)
const progressFile = ref('')
const progressPct = ref(0)
const webgpu = ref(false)
const fileInput = ref<HTMLInputElement>()

onMounted(() => { webgpu.value = hasWebGPU() })

const { locale } = useI18n()

/** 提示词示例：点击快速填充（按当前语言取中文/英文提示词） */
const promptExamples = computed(() => {
  const zh = locale.value === 'zh'
  return [
    zh ? '一只在月光下打盹的白色小猫，数字艺术，高清' : 'a white cat napping in the moonlight, digital art, highly detailed',
    zh ? '赛博朋克城市夜景，霓虹灯光，雨夜街道' : 'cyberpunk city at night, neon lights, rainy street',
    zh ? '水彩风格野花束，柔和自然光' : 'watercolor bouquet of wildflowers, soft natural light'
  ]
})

let processor: any = null
let model: any = null
let envReady = false

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'temperature',
    label: t('textToImage.temperature'),
    type: 'slider',
    default: 1,
    min: 0.1,
    max: 2,
    step: 0.05,
    disableWhileRunning: true
  },
  {
    key: 'maxTokens',
    label: t('textToImage.maxTokens'),
    type: 'slider',
    default: 256,
    min: 32,
    max: 1024,
    step: 16,
    disableWhileRunning: true
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

async function supportsFP16(): Promise<boolean> {
  try {
    const adapter = await (navigator as any).gpu?.requestAdapter()
    return Boolean(adapter?.features?.has('shader-f16'))
  } catch {
    return false
  }
}

const onProgress = (x: any) => {
  if (x?.status === 'progress' && x.file) {
    progressFile.value = String(x.file).split('/').pop() || x.file
    progressPct.value = x.total ? Math.round((x.loaded / x.total) * 100) : 0
  }
}

async function ensureModel() {
  if (model && processor) return
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { env, AutoProcessor, MultiModalityCausalLM } = await import('@huggingface/transformers')
    // Janus 模型未放在 public/model/transformers，跳过本地探测避免 404 噪音
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false
    const modelId = 'onnx-community/Janus-Pro-1B-ONNX'
    const fp16 = await supportsFP16()
    const dtype = fp16
      ? { prepare_inputs_embeds: 'q4', language_model: 'q4f16', lm_head: 'fp16', gen_head: 'fp16', gen_img_embeds: 'fp16', image_decode: 'fp32' }
      : { prepare_inputs_embeds: 'fp32', language_model: 'q4', lm_head: 'fp32', gen_head: 'fp32', gen_img_embeds: 'fp32', image_decode: 'fp32' }
    const device = webgpu.value
      ? { prepare_inputs_embeds: 'wasm', language_model: 'webgpu', lm_head: 'webgpu', gen_head: 'webgpu', gen_img_embeds: 'webgpu', image_decode: 'webgpu' }
      : { prepare_inputs_embeds: 'wasm', language_model: 'wasm', lm_head: 'wasm', gen_head: 'wasm', gen_img_embeds: 'wasm', image_decode: 'wasm' }
    processor = await AutoProcessor.from_pretrained(modelId, { progress_callback: onProgress })
    model = await MultiModalityCausalLM.from_pretrained(modelId, { dtype, device, progress_callback: onProgress })
    env.allowLocalModels = prevAllowLocal
    modelReady.value = true
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
    progressFile.value = ''
    progressPct.value = 0
  }
}

async function generate() {
  if (!prompt.value.trim()) return
  await ensureModel()
  if (!model || !processor) return
  running.value = true
  error.value = null
  generatedUrl.value = ''
  const ts = performance.now()
  try {
    const conversation = [{ role: '<|User|>', content: prompt.value }]
    const inputs = await processor(conversation, { chat_template: 'text_to_image' })
    const numImageTokens = processor.num_image_tokens
    const outputs = await model.generate_images({
      ...inputs,
      min_new_tokens: numImageTokens,
      max_new_tokens: numImageTokens,
      do_sample: true,
      temperature: Number(params.value.temperature)
    })
    const blob = await outputs[0].toBlob()
    if (generatedUrl.value) URL.revokeObjectURL(generatedUrl.value)
    generatedUrl.value = URL.createObjectURL(blob)
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    imgSrc.value = await processImageFile(file)
    answer.value = ''
  } catch (err: any) {
    error.value = err?.message || String(err)
  }
  input.value = ''
}

async function ask() {
  if (!imgSrc.value || !question.value.trim()) return
  await ensureModel()
  if (!model || !processor) return
  running.value = true
  error.value = null
  answer.value = ''
  const ts = performance.now()
  try {
    const { TextStreamer } = await import('@huggingface/transformers')
    const conversation = [{ role: '<|User|>', content: '<image_placeholder>\n' + question.value, images: [imgSrc.value] }]
    const inputs = await processor(conversation)
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => { answer.value += text }
    })
    await model.generate({
      ...inputs,
      max_new_tokens: Number(params.value.maxTokens),
      do_sample: false,
      streamer
    })
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}

function download() {
  if (!generatedUrl.value) return
  const a = document.createElement('a')
  a.href = generatedUrl.value
  a.download = 'janus-text-to-image.png'
  a.click()
}

onBeforeUnmount(async () => {
  try { if (generatedUrl.value) URL.revokeObjectURL(generatedUrl.value) } catch { /* ignore */ }
  try { if (model) await model.dispose() } catch { /* ignore */ }
  model = null
  processor = null
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UTabs
        v-model="tab"
        :items="[
          { label: t('textToImage.tabGenerate'), value: 'generate' },
          { label: t('textToImage.tabUnderstand'), value: 'understand' }
        ]"
      />
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM</UBadge>
      <UBadge v-if="modelReady" color="success" variant="subtle">
        {{ t('webllm.loaded') }}
      </UBadge>
      <UButton
        v-else
        icon="i-lucide-download"
        :label="t('textToImage.load')"
        color="primary"
        variant="subtle"
        :loading="loading"
        :disabled="loading || running"
        @click="ensureModel"
      />
      <span class="text-sm text-muted">{{ t('textToImage.modelHelp') }}</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-if="!webgpu && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('textToImage.noWebgpu')" />
    <UAlert v-if="!modelReady && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('textToImage.firstDownload')" />

    <!-- 模型下载进度 -->
    <div v-if="loading" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted truncate">{{ progressFile || t('textToImage.loadingModel') }}</span>
        <span class="text-muted">{{ progressPct }}%</span>
      </div>
      <UProgress :model-value="progressPct" />
    </div>

    <!-- 文生图 -->
    <UCard v-if="tab === 'generate'">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-image" class="size-4" />
          {{ t('textToImage.tabGenerate') }}
        </div>
      </template>
      <div class="space-y-4">
        <label class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('textToImage.prompt') }}</span>
          <div class="flex flex-wrap items-center gap-1.5 mb-2">
            <span class="text-xs text-muted">{{ t('textToImage.examples') }}</span>
            <UButton
              v-for="(ex, i) in promptExamples"
              :key="i"
              size="xs"
              variant="soft"
              color="neutral"
              class="max-w-56"
              :disabled="running"
              @click="prompt = ex"
            >
              <span class="truncate">{{ ex }}</span>
            </UButton>
          </div>
          <UTextarea
            v-model="prompt"
            :placeholder="t('textToImage.promptPlaceholder')"
            :rows="3"
            autoresize
            :maxrows="8"
            :ui="{ base: 'resize-none' }"
            :disabled="running"
          />
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            icon="i-lucide-sparkles"
            :label="t('textToImage.generate')"
            color="primary"
            :loading="running"
            :disabled="loading || running || !prompt.trim()"
            @click="generate"
          />
          <span v-if="inferenceTime" class="text-sm text-muted">
            {{ t('textToImage.time') }}: {{ inferenceTime }} ms
          </span>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-muted mb-2">{{ t('textToImage.result') }}</label>
            <div class="relative aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default flex items-center justify-center">
              <img v-if="generatedUrl" :src="generatedUrl" class="w-full h-full object-contain" alt="generated" />
              <div v-else class="flex flex-col items-center gap-2 text-muted">
                <UIcon v-if="running" name="i-lucide-loader-circle" class="size-8 animate-spin" />
                <UIcon v-else name="i-lucide-image-plus" class="size-8" />
                <span class="text-sm">{{ running ? t('textToImage.generating') : '384 × 384' }}</span>
              </div>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-muted mb-2">{{ t('textToImage.hint') }}</label>
            <UCard class="h-full">
              <p class="text-sm leading-relaxed text-muted">
                {{ t('textToImage.hint') }}
              </p>
            </UCard>
          </div>
        </div>

        <UButton
          v-if="generatedUrl"
          icon="i-lucide-download"
          :label="t('textToImage.download')"
          color="secondary"
          variant="subtle"
          @click="download"
        />
      </div>
    </UCard>

    <!-- 图像理解 -->
    <UCard v-else>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-scan" class="size-4" />
          {{ t('textToImage.tabUnderstand') }}
        </div>
      </template>
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-4">
          <UButton
            icon="i-lucide-upload"
            :label="t('mp.upload')"
            color="primary"
            variant="subtle"
            :disabled="loading || running"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-muted mb-2">{{ t('textToImage.inputImage') }}</label>
            <div class="relative aspect-video rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default flex items-center justify-center">
              <img v-if="imgSrc" :src="imgSrc" class="w-full h-full object-contain">
              <UIcon v-else name="i-lucide-image-plus" class="size-8 text-muted" />
            </div>
          </div>
          <div>
            <label class="block">
              <span class="block text-sm font-medium text-muted mb-1">{{ t('textToImage.question') }}</span>
              <UTextarea
                v-model="question"
                :placeholder="t('textToImage.questionPlaceholder')"
                :rows="2"
                autoresize
                :maxrows="4"
                :ui="{ base: 'resize-none' }"
                :disabled="running"
              />
            </label>
            <div class="flex flex-wrap items-center gap-3 mt-3">
              <UButton
                icon="i-lucide-message-circle"
                :label="t('textToImage.ask')"
                color="primary"
                :loading="running"
                :disabled="loading || running || !imgSrc || !question.trim()"
                @click="ask"
              />
              <span v-if="inferenceTime" class="text-sm text-muted">
                {{ t('textToImage.time') }}: {{ inferenceTime }} ms
              </span>
            </div>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-muted mb-2">{{ t('textToImage.answer') }}</label>
          <UCard>
            <div v-if="running" class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              {{ t('textToImage.analyzing') }}
            </div>
            <p v-else-if="answer" class="text-base leading-relaxed text-highlighted whitespace-pre-wrap">
              {{ answer }}
            </p>
            <p v-else class="text-sm text-muted">
              {{ t('textToImage.questionPlaceholder') }}
            </p>
          </UCard>
        </div>
      </div>
    </UCard>

    <DemoParams v-model="params" :specs="specs" :running="running || loading" />
  </MediaDemoShell>
</template>
