<script setup lang="ts">
/**
 * 推理对话（DeepSeek-R1 蒸馏 / MiniThinky）：浏览器本地运行推理 LLM
 * - 流式输出：先展示"思考过程"，再给出答案
 * - WebGPU 优先（q4f16），WASM 兜底（q4）
 */
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { setupTransformersEnv, preferredDevice, hasWebGPU } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'reasoning-chat')!)

interface ModelItem {
  label: string
  value: string
  system?: string
}

const modelItems: ModelItem[] = [
  {
    label: 'DeepSeek-R1-Distill-Qwen-1.5B',
    value: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX'
  },
  {
    label: 'MiniThinky-v2-1B (Llama-3.2)',
    value: 'ngxson/MiniThinky-v2-1B-Llama-3.2',
    system: 'You are MiniThinky, a helpful AI assistant. You always think before giving the answer. Use <|thinking|> before thinking and <|answer|> before giving the answer.'
  }
]

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'system',
    label: t('reasoningChat.system'),
    type: 'text',
    default: modelItems[0]!.system || 'You are a helpful reasoning assistant. Think step by step before answering.',
    disableWhileRunning: false
  },
  {
    key: 'temperature',
    label: t('reasoningChat.temperature'),
    type: 'slider',
    default: 0.6,
    min: 0,
    max: 2,
    step: 0.05,
    help: t('reasoningChat.temperatureHelp')
  },
  {
    key: 'maxTokens',
    label: t('reasoningChat.maxTokens'),
    type: 'slider',
    default: 1024,
    min: 128,
    max: 2048,
    step: 64
  },
  {
    key: 'repetitionPenalty',
    label: t('reasoningChat.repetitionPenalty'),
    type: 'slider',
    default: 1.1,
    min: 1,
    max: 2,
    step: 0.05
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))
const modelId = ref(modelItems[0]!.value)

const webgpu = ref(false)
const loading = ref(false)
const generating = ref(false)
const error = ref<string | null>(null)
const modelReady = ref(false)
const progressFile = ref('')
const progressPct = ref(0)
const input = ref('')
const stats = ref('')

interface Msg {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
}
const messages = ref<Msg[]>([])

let tokenizer: any = null
let model: any = null
let stoppingCriteria: any = null
let envReady = false
let startThinkId = -1
let endThinkId = -1

onMounted(() => { webgpu.value = hasWebGPU() })

const onProgress = (x: any) => {
  if (x?.status === 'progress' && x.file) {
    progressFile.value = String(x.file).split('/').pop() || x.file
    progressPct.value = x.total ? Math.round((x.loaded / x.total) * 100) : 0
  }
}

async function supportsFP16(): Promise<boolean> {
  try {
    const adapter = await (navigator as any).gpu?.requestAdapter()
    return Boolean(adapter?.features?.has('shader-f16'))
  } catch {
    return false
  }
}

async function ensureModel() {
  if (model && tokenizer && stoppingCriteria) return
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { env, AutoTokenizer, AutoModelForCausalLM, InterruptableStoppingCriteria } = await import('@huggingface/transformers')
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false // 这些模型不预下载，走 /api/hf 代理，避免本地 404 噪音
    const useGpu = webgpu.value
    const fp16 = await supportsFP16()
    const dtype = useGpu && fp16 ? 'q4f16' : 'q4'
    const device = useGpu ? 'webgpu' : 'wasm'
    tokenizer = await AutoTokenizer.from_pretrained(modelId.value, { progress_callback: onProgress })
    model = await AutoModelForCausalLM.from_pretrained(modelId.value, { dtype, device, progress_callback: onProgress })
    stoppingCriteria = new InterruptableStoppingCriteria()
    env.allowLocalModels = prevAllowLocal

    // 识别"思考"标记：DeepSeek 用 <think>；MiniThinky 用 <|thinking|>/<|answer|>
    const marker = modelId.value.includes('MiniThinky') ? '<|thinking|><|answer|>' : '<think></think>'
    const ids = tokenizer.encode(marker, { add_special_tokens: false })
    startThinkId = ids[0]
    endThinkId = ids[1]
    modelReady.value = true
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
    progressFile.value = ''
    progressPct.value = 0
  }
}

async function onModelChange() {
  error.value = null
  messages.value = []
  stats.value = ''
  try {
    if (model) await model.dispose()
  } catch { /* ignore */ }
  model = null
  tokenizer = null
  stoppingCriteria = null
  modelReady.value = false
  // 切换模型后需重新加载
}

async function send() {
  if (!input.value.trim() || generating.value) return
  await ensureModel()
  if (!model || !tokenizer || !stoppingCriteria) return

  const userMsg: Msg = { role: 'user', content: input.value }
  messages.value.push(userMsg)
  input.value = ''
  const idx = messages.value.push({ role: 'assistant', content: '', thinking: '' }) - 1

  generating.value = true
  error.value = null
  stats.value = ''
  let state: 'thinking' | 'answering' = 'thinking'
  let startTime: number | null = null
  let numTokens = 0
  let tps = 0

  try {
    const chatMessages = [
      { role: 'system', content: String(params.value.system) },
      ...messages.value.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
    ]
    const inputs = tokenizer.apply_chat_template(chatMessages, {
      add_generation_prompt: true,
      return_dict: true
    })

    const { TextStreamer } = await import('@huggingface/transformers')
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: (tokens: number[]) => {
        startTime ??= performance.now()
        numTokens++
        if (numTokens > 1) tps = (numTokens / (performance.now() - startTime)) * 1000
        if (tokens[0] === endThinkId) state = 'answering'
      },
      callback_function: (output: string) => {
        const msg = messages.value[idx]!
        if (state === 'thinking') msg.thinking = (msg.thinking || '') + output
        else msg.content = (msg.content || '') + output
      }
    })

    await model.generate({
      ...inputs,
      max_new_tokens: Number(params.value.maxTokens),
      do_sample: Number(params.value.temperature) > 0,
      temperature: Number(params.value.temperature),
      repetition_penalty: Number(params.value.repetitionPenalty),
      streamer,
      stopping_criteria: stoppingCriteria,
      return_dict_in_generate: true
    })
    stats.value = `${numTokens} tok · ${tps.toFixed(1)} tok/s`
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    generating.value = false
  }
}

function stop() {
  stoppingCriteria?.interrupt?.()
}

function clearChat() {
  messages.value = []
  error.value = null
  stats.value = ''
}

const examples = computed(() => {
  const zh = useI18n().locale.value === 'zh'
  return zh
    ? ['解方程 x² - 3x + 2 = 0', '小明比妹妹大 3 岁，5 年后两人年龄和是 25，现在各几岁？', '写一段 Python 代码计算斐波那契数列第 n 项']
    : ['Solve the equation x^2 - 3x + 2 = 0', 'Lily is three times older than her son. In 15 years, she will be twice as old as him. How old is she now?', 'Write python code to compute the nth fibonacci number.']
})

onBeforeUnmount(async () => {
  try { if (model) await model.dispose() } catch { /* ignore */ }
  model = null
  tokenizer = null
  stoppingCriteria = null
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM（较慢）</UBadge>
      <UBadge v-if="modelReady" color="success" variant="subtle">
        {{ t('reasoningChat.loaded') }}
      </UBadge>
      <UButton
        v-else
        icon="i-lucide-download"
        :label="t('reasoningChat.load')"
        color="primary"
        variant="subtle"
        :loading="loading"
        :disabled="loading || generating"
        @click="ensureModel"
      />
      <UButton
        icon="i-lucide-trash-2"
        :label="t('reasoningChat.clear')"
        color="neutral"
        variant="subtle"
        :disabled="!messages.length || generating"
        @click="clearChat"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-if="!webgpu && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('reasoningChat.noWebgpu')" />
    <UAlert v-if="!modelReady && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('reasoningChat.firstDownload')" />

    <div v-if="loading" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted truncate">{{ progressFile || t('reasoningChat.loadingModel') }}</span>
        <span class="text-muted">{{ progressPct }}%</span>
      </div>
      <UProgress :model-value="progressPct" />
    </div>

    <UCard>
      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-56 flex-1">
          <label class="block text-sm font-medium text-muted mb-1">{{ t('reasoningChat.model') }}</label>
          <USelect v-model="modelId" :items="modelItems" :disabled="loading || generating" class="w-full" @change="onModelChange" />
        </div>
      </div>
    </UCard>

    <DemoParams v-model="params" :specs="specs" :running="generating" />

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
            :class="m.role === 'user' ? 'bg-primary text-inverted whitespace-pre-wrap' : 'bg-elevated text-highlighted'"
          >
            <!-- 思考过程 -->
            <div v-if="m.thinking" class="mb-2">
              <div class="flex items-center gap-1.5 text-xs text-muted mb-1">
                <UIcon name="i-lucide-brain" class="size-3.5" />
                {{ t('reasoningChat.thinking') }}
              </div>
              <p class="text-xs leading-relaxed text-muted whitespace-pre-wrap border-s-2 border-default ps-3">
                {{ m.thinking }}
              </p>
            </div>
            <!-- 回答 -->
            <p v-if="m.content" class="whitespace-pre-wrap">{{ m.content }}</p>
            <p v-else-if="m.role === 'assistant' && generating" class="text-muted">
              {{ t('reasoningChat.working') }}
            </p>
          </div>
        </div>
        <div v-if="!messages.length" class="text-center text-muted py-12 text-sm">
          {{ t('reasoningChat.empty') }}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-muted">{{ t('reasoningChat.examples') }}</span>
        <UButton
          v-for="(ex, i) in examples"
          :key="i"
          size="xs"
          variant="soft"
          color="neutral"
          class="max-w-64"
          :disabled="generating"
          @click="input = ex"
        >
          <span class="truncate">{{ ex }}</span>
        </UButton>
      </div>
    </UCard>

    <UCard>
      <div class="flex items-end gap-2">
        <UTextarea
          v-model="input"
          :rows="3"
          :placeholder="t('reasoningChat.inputPlaceholder')"
          class="flex-1"
          @keydown.enter.exact.prevent="send"
        />
        <UButton
          v-if="generating"
          icon="i-lucide-square"
          :label="t('reasoningChat.stop')"
          color="neutral"
          variant="subtle"
          @click="stop"
        />
        <UButton
          v-else
          icon="i-lucide-send"
          :label="t('reasoningChat.send')"
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
