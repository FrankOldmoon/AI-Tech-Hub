<script setup lang="ts">
/**
 * 多模态对话（SmolVLM-256M）：浏览器本地运行视觉-语言模型
 * - 上传 1 张或多张图片，进行多轮图文对话
 * - 识别图表 / 手写 / 场景 / 物体
 */
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { processImageFile } from '~/utils/image'
import { setupTransformersEnv, preferredDevice, hasWebGPU } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'multimodal-chat')!)

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'maxTokens',
    label: t('multimodalChat.maxTokens'),
    type: 'slider',
    default: 512,
    min: 64,
    max: 1024,
    step: 32
  },
  {
    key: 'repetitionPenalty',
    label: t('multimodalChat.repetitionPenalty'),
    type: 'slider',
    default: 1.1,
    min: 1,
    max: 2,
    step: 0.05
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

const webgpu = ref(false)
const loading = ref(false)
const generating = ref(false)
const error = ref<string | null>(null)
const modelReady = ref(false)
const progressFile = ref('')
const progressPct = ref(0)
const input = ref('')
const stats = ref('')
const images = ref<string[]>([])
const fileInput = ref<HTMLInputElement>()

interface Msg {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}
const messages = ref<Msg[]>([])

let processor: any = null
let model: any = null
let stoppingCriteria: any = null
let envReady = false

onMounted(() => { webgpu.value = hasWebGPU() })

const onProgress = (x: any) => {
  if (x?.status === 'progress' && x.file) {
    progressFile.value = String(x.file).split('/').pop() || x.file
    progressPct.value = x.total ? Math.round((x.loaded / x.total) * 100) : 0
  }
}

async function ensureModel() {
  if (model && processor && stoppingCriteria) return
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { env, AutoProcessor, AutoModelForVision2Seq, InterruptableStoppingCriteria } = await import('@huggingface/transformers')
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false
    const modelId = 'HuggingFaceTB/SmolVLM-256M-Instruct'
    const device = webgpu.value ? 'webgpu' : 'wasm'
    processor = await AutoProcessor.from_pretrained(modelId, { progress_callback: onProgress })
    model = await AutoModelForVision2Seq.from_pretrained(modelId, {
      dtype: {
        vision_encoder: 'fp32',
        embed_tokens: 'q8',
        decoder_model_merged: 'q8'
      },
      device,
      progress_callback: onProgress
    })
    stoppingCriteria = new InterruptableStoppingCriteria()
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

async function onFileChange(e: Event) {
  const inputEl = e.target as HTMLInputElement
  const files = Array.from(inputEl.files || []).slice(0, 4)
  inputEl.value = ''
  if (!files.length) return
  try {
    for (const file of files) {
      const url = await processImageFile(file, 1024)
      images.value.push(url)
    }
  } catch (err: any) {
    error.value = err?.message || String(err)
  }
}

function removeImage(idx: number) {
  const url = images.value[idx]
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  images.value.splice(idx, 1)
}

async function send() {
  if (!input.value.trim() || generating.value) return
  await ensureModel()
  if (!model || !processor || !stoppingCriteria) return

  const userMsg: Msg = { role: 'user', content: input.value, images: [...images.value] }
  messages.value.push(userMsg)
  input.value = ''
  images.value = []
  const idx = messages.value.push({ role: 'assistant', content: '' }) - 1

  generating.value = true
  error.value = null
  stats.value = ''
  let startTime: number | null = null
  let numTokens = 0
  let tps = 0
  try {
    const { TextStreamer, load_image } = await import('@huggingface/transformers')
    const chatMessages = messages.value.slice(0, -1).map(m => {
      if (m.role === 'user' && m.images?.length) {
        return {
          role: 'user',
          content: [
            ...m.images.map((img) => ({ type: 'image', image: img })),
            { type: 'text', text: m.content }
          ]
        }
      }
      return { role: m.role, content: m.content }
    })
    const allImages = chatMessages
      .map((m: any) => m.content)
      .flat(Infinity)
      .filter((c: any) => c?.image !== undefined)
      .map((c: any) => c.image)
    const loadedImages = await Promise.all(allImages.map((url: string) => load_image(url)))

    const text = processor.apply_chat_template(chatMessages, { add_generation_prompt: true })
    const inputs = await processor(text, loadedImages, { do_image_splitting: false })

    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: () => {
        startTime ??= performance.now()
        numTokens++
        if (numTokens > 1) tps = (numTokens / (performance.now() - startTime)) * 1000
      },
      callback_function: (output: string) => {
        messages.value[idx]!.content += output
      }
    })

    await model.generate({
      ...inputs,
      max_new_tokens: Number(params.value.maxTokens),
      do_sample: false,
      repetition_penalty: Number(params.value.repetitionPenalty),
      streamer,
      stopping_criteria: stoppingCriteria,
      return_dict_in_generate: true
    })
    stats.value = `${numTokens} tok · ${tps.toFixed(1)} tok/s`
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    generating.value = false
  }
}

function stop() {
  stoppingCriteria?.interrupt?.()
}

function clearChat() {
  for (const m of messages.value) {
    for (const url of m.images || []) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }
  messages.value = []
  error.value = null
  stats.value = ''
}

onBeforeUnmount(async () => {
  try { if (model) await model.dispose() } catch { /* ignore */ }
  model = null
  processor = null
  stoppingCriteria = null
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM（较慢）</UBadge>
      <UBadge v-if="modelReady" color="success" variant="subtle">
        {{ t('multimodalChat.loaded') }}
      </UBadge>
      <UButton
        v-else
        icon="i-lucide-download"
        :label="t('multimodalChat.load')"
        color="primary"
        variant="subtle"
        :loading="loading"
        :disabled="loading || generating"
        @click="ensureModel"
      />
      <UButton
        icon="i-lucide-trash-2"
        :label="t('multimodalChat.clear')"
        color="neutral"
        variant="subtle"
        :disabled="!messages.length || generating"
        @click="clearChat"
      />
      <span class="text-sm text-muted">{{ t('multimodalChat.modelHelp') }}</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-if="!webgpu && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('multimodalChat.noWebgpu')" />
    <UAlert v-if="!modelReady && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('multimodalChat.firstDownload')" />

    <div v-if="loading" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted truncate">{{ progressFile || t('multimodalChat.loadingModel') }}</span>
        <span class="text-muted">{{ progressPct }}%</span>
      </div>
      <UProgress :model-value="progressPct" />
    </div>

    <DemoParams v-model="params" :specs="specs" :running="generating" />

    <!-- 图片区 -->
    <UCard v-if="images.length || !messages.length">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-image" class="size-4" />
          {{ t('multimodalChat.images') }}
        </div>
      </template>
      <div class="flex flex-wrap items-center gap-3">
        <div
          v-for="(img, i) in images"
          :key="i"
          class="relative size-24 rounded-lg overflow-hidden border border-default group"
        >
          <img :src="img" class="w-full h-full object-cover">
          <button
            class="absolute top-1 right-1 size-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            :disabled="generating"
            @click="removeImage(i)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>
        <UButton
          icon="i-lucide-upload"
          :label="t('multimodalChat.upload')"
          color="primary"
          variant="subtle"
          :disabled="loading || generating || images.length >= 4"
          @click="fileInput?.click()"
        />
        <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFileChange">
      </div>
    </UCard>

    <!-- 对话区 -->
    <UCard>
      <div class="space-y-4 min-h-64 max-h-[60vh] overflow-auto">
        <div
          v-for="(m, i) in messages"
          :key="i"
          class="flex gap-3"
          :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[85%] rounded-xl px-4 py-2 text-sm break-words"
            :class="m.role === 'user' ? 'bg-primary text-inverted' : 'bg-elevated text-highlighted'"
          >
            <div v-if="m.images?.length" class="flex flex-wrap gap-1.5 mb-2">
              <img
                v-for="(img, j) in m.images"
                :key="j"
                :src="img"
                class="size-16 rounded-lg object-cover border border-default"
                alt=""
              >
            </div>
            <p class="whitespace-pre-wrap">{{ m.content || (m.role === 'assistant' && generating ? '…' : '') }}</p>
          </div>
        </div>
        <div v-if="!messages.length" class="text-center text-muted py-12 text-sm">
          {{ t('multimodalChat.empty') }}
        </div>
      </div>
    </UCard>

    <UCard>
      <div class="flex items-end gap-2">
        <UTextarea
          v-model="input"
          :rows="3"
          :placeholder="t('multimodalChat.inputPlaceholder')"
          class="flex-1"
          @keydown.enter.exact.prevent="send"
        />
        <UButton
          v-if="generating"
          icon="i-lucide-square"
          :label="t('multimodalChat.stop')"
          color="neutral"
          variant="subtle"
          @click="stop"
        />
        <UButton
          v-else
          icon="i-lucide-send"
          :label="t('multimodalChat.send')"
          color="primary"
          :loading="generating"
          :disabled="!input.trim() || loading"
          @click="send"
        />
      </div>
      <p v-if="stats" class="mt-2 text-xs text-muted">{{ stats }}</p>
    </UCard>
  </MediaDemoShell>
</template>
