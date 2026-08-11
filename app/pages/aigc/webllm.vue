<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'webllm')!)

// ===== 模型列表（较小的 Llama / Qwen，浏览器可跑）=====
const modelItems = [
  { label: 'Qwen2.5 0.5B · q4f16', value: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' },
  { label: 'Qwen2.5 1.5B · q4f16', value: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' },
  { label: 'Llama 3.2 1B · q4f16', value: 'Llama-3.2-1B-Instruct-q4f16_1-MLC' },
  { label: 'Llama 3.2 3B · q4f16', value: 'Llama-3.2-3B-Instruct-q4f16_1-MLC' }
]

// ===== 可调参数 =====
const specs = computed<ParamSpec[]>(() => [
  {
    key: 'system',
    label: t('webllm.system'),
    type: 'text',
    default: 'You are a helpful assistant. 回答简洁。',
    disableWhileRunning: false
  },
  {
    key: 'temperature',
    label: t('webllm.temperature'),
    type: 'slider',
    default: 0.7,
    min: 0,
    max: 2,
    step: 0.05,
    help: t('webllm.temperatureHelp')
  },
  {
    key: 'top_p',
    label: t('webllm.topP'),
    type: 'slider',
    default: 0.95,
    min: 0,
    max: 1,
    step: 0.01,
    help: t('webllm.topPHelp')
  },
  {
    key: 'max_tokens',
    label: t('webllm.maxTokens'),
    type: 'slider',
    default: 512,
    min: 16,
    max: 2048,
    step: 16
  },
  {
    key: 'frequency_penalty',
    label: t('webllm.freqPenalty'),
    type: 'slider',
    default: 0,
    min: -2,
    max: 2,
    step: 0.1
  },
  {
    key: 'presence_penalty',
    label: t('webllm.presPenalty'),
    type: 'slider',
    default: 0,
    min: -2,
    max: 2,
    step: 0.1
  }
])

const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))
const modelId = ref(modelItems[0]!.value)

// ===== 状态 =====
const supported = ref(true)
const loading = ref(false) // 模型加载中
const generating = ref(false) // 生成中
const error = ref<string | null>(null)
const loadProgress = ref(0)
const loadText = ref('')
const input = ref('')
const stats = ref('')

interface Msg { role: 'user' | 'assistant', content: string }
const messages = ref<Msg[]>([])

let engine: any = null
let loadedModelId: string | null = null

onMounted(async () => {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
    supported.value = false
    return
  }
  // 检查 WebLLM 是否可用
  try {
    const { hasModelInCache } = await import('@mlc-ai/web-llm')
    // 仅做存在性探测，不强制
    void hasModelInCache
  } catch {
    supported.value = false
  }
})

async function loadModel() {
  if (loadedModelId === modelId.value && engine) return
  error.value = null
  loading.value = true
  loadProgress.value = 0
  loadText.value = ''
  try {
    const webllm = await import('@mlc-ai/web-llm')
    const { CreateMLCEngine, prebuiltAppConfig } = webllm
    if (engine) {
      engine.unload()
      engine = null
      loadedModelId = null
    }
    // 从本地 public/model/webllm/ 加载模型
    const localBase = '/model/webllm'
    const modelList = prebuiltAppConfig.model_list.map((m: any) => ({
      ...m,
      model: typeof m.model === 'string'
        ? m.model.replace('https://huggingface.co', localBase)
        : m.model,
      model_lib: typeof m.model_lib === 'string'
        ? m.model_lib.replace(
          /^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/main\/web-llm-models\/[^/]+\/base\//,
          '/model/webllm/libs/'
        )
        : m.model_lib
    }))
    engine = await CreateMLCEngine(modelId.value, {
      appConfig: { model_list: modelList },
      initProgressCallback: (r: any) => {
        loadProgress.value = Math.round((r.progress || 0) * 100)
        loadText.value = r.text || ''
      }
    })
    loadedModelId = modelId.value
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function send() {
  if (!input.value.trim() || generating.value) return
  if (!engine || loadedModelId !== modelId.value) {
    await loadModel()
    if (!engine) return
  }
  const userMsg: Msg = { role: 'user', content: input.value }
  messages.value.push(userMsg)
  input.value = ''
  generating.value = true
  error.value = null
  // 助手占位
  const assistantIdx = messages.value.push({ role: 'assistant', content: '' }) - 1
  try {
    const apiMessages = [
      { role: 'system', content: String(params.value.system) },
      ...messages.value.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
    ]
    const completion = await engine.chat.completions.create({
      messages: apiMessages,
      stream: true,
      temperature: Number(params.value.temperature),
      top_p: Number(params.value.top_p),
      max_tokens: Number(params.value.max_tokens),
      frequency_penalty: Number(params.value.frequency_penalty),
      presence_penalty: Number(params.value.presence_penalty)
    })
    for await (const chunk of completion) {
      const delta = chunk.choices?.[0]?.delta?.content || ''
      if (delta) {
        messages.value[assistantIdx]!.content += delta
      }
    }
    try {
      stats.value = await engine.runtimeStats()
    } catch { /* ignore */ }
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    generating.value = false
  }
}

function clearChat() {
  messages.value = []
  error.value = null
}

async function onModelChange() {
  if (engine) {
    generating.value = false
    engine.interruptGenerate?.()
  }
  messages.value = []
  // 模型切换需点击加载按钮触发，避免误触大模型下载
}

onBeforeUnmount(() => {
  if (engine) engine.unload()
})
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12 space-y-6">
      <!-- 标题区 -->
      <div class="flex items-start gap-4">
        <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UIcon :name="demo.icon" class="size-6" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ demo.title }}
            </h1>
            <DemoStatusBadge :status="demo.status" />
          </div>
          <p v-if="demo.description" class="mt-1 text-muted">
            {{ demo.description }}
          </p>
        </div>
      </div>

      <UAlert
        v-if="!supported"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="t('webllm.noWebgpu')"
      />

      <!-- 模型与控件 -->
      <UCard>
        <div class="flex flex-wrap items-end gap-4">
          <div class="min-w-56 flex-1">
            <label class="block text-sm font-medium text-muted mb-1">{{ t('webllm.model') }}</label>
            <USelect v-model="modelId" :items="modelItems" :disabled="loading || generating" class="w-full" @change="onModelChange" />
          </div>
          <UButton
            icon="i-lucide-download"
            :label="loadedModelId === modelId ? t('webllm.loaded') : t('webllm.load')"
            color="primary"
            :loading="loading"
            :disabled="!supported || loadedModelId === modelId"
            @click="loadModel"
          />
          <UButton
            icon="i-lucide-trash-2"
            :label="t('webllm.clear')"
            color="neutral"
            variant="subtle"
            :disabled="!messages.length || generating"
            @click="clearChat"
          />
        </div>
        <!-- 加载进度 -->
        <div v-if="loading" class="mt-4 space-y-2">
          <UProgress :model-value="loadProgress" />
          <p class="text-xs text-muted truncate">{{ loadText }}</p>
        </div>
      </UCard>

      <!-- 可调参数 -->
      <DemoParams v-model="params" :specs="specs" :running="generating" />

      <!-- 错误 -->
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

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
              class="max-w-[80%] rounded-xl px-4 py-2 text-sm whitespace-pre-wrap break-words"
              :class="m.role === 'user'
                ? 'bg-primary text-inverted'
                : 'bg-elevated text-highlighted'"
            >
              {{ m.content || (m.role === 'assistant' && generating ? '…' : '') }}
            </div>
          </div>
          <div v-if="!messages.length" class="text-center text-muted py-12 text-sm">
            {{ t('webllm.empty') }}
          </div>
        </div>
      </UCard>

      <!-- 输入 -->
      <UCard>
        <div class="flex items-end gap-2">
          <UTextarea
            v-model="input"
            :rows="3"
            :placeholder="t('webllm.inputPlaceholder')"
            class="flex-1"
            @keydown.enter.exact.prevent="send"
          />
          <UButton
            icon="i-lucide-send"
            :label="t('webllm.send')"
            color="primary"
            :loading="generating"
            :disabled="!input.trim() || loading"
            @click="send"
          />
        </div>
        <p v-if="stats" class="mt-2 text-xs text-muted">{{ stats }}</p>
      </UCard>

      <!-- 对应的 Python 最简实现源码 -->
      <PythonSourceViewer v-if="demo.pythonModule" :feature="demo.pythonModule" />
    </div>
  </UContainer>
</template>
