<script setup lang="ts">
/**
 * 云端 LLM 对话（Kimi K3 / DeepSeek）
 * - 通过本地 Nitro 代理调用云端 API（密钥只存服务端 .env，浏览器不接触）
 * - 服务商 + 模型随时切换；Kimi K3 等思考模型先展示"思考过程"再给答案
 * - SSE 流式输出
 */
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { llmProviders } from '~/utils/llm-providers'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'llm-chat')!)

interface Msg {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
}

const providerId = ref<'moonshot' | 'deepseek'>('moonshot')
const modelId = ref(llmProviders[0]!.models[0]!.value)

const provider = computed(() => llmProviders.find(p => p.id === providerId.value)!)
const currentModel = computed(() => provider.value.models.find(m => m.value === modelId.value))
/** 思考模型（如 kimi-k3）上游只允许 temperature=1，锁定该滑块 */
const disabledKeys = computed(() => currentModel.value?.thinking ? ['temperature'] : [])

interface SseChunk {
  choices?: { delta?: { reasoning_content?: string, content?: string } }[]
}

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'system',
    label: t('llmChat.systemPrompt'),
    type: 'text',
    default: 'You are a helpful assistant.',
    disableWhileRunning: false
  },
  {
    key: 'temperature',
    label: t('llmChat.temperature'),
    type: 'slider',
    default: 0.7,
    min: 0,
    max: 2,
    step: 0.05
  },
  {
    key: 'maxTokens',
    label: t('llmChat.maxTokens'),
    type: 'slider',
    default: 4096,
    min: 256,
    max: 16384,
    step: 256
  }
])
// 默认模型为 kimi-k3（思考模型，temperature 只允许 1），初始化即为 1
const params = ref<Record<string, number | string | boolean>>({ ...paramDefaults(specs.value), temperature: 1 })

const input = ref('')
const messages = ref<Msg[]>([])
const generating = ref(false)
const error = ref<string | null>(null)
const stats = ref('')

let controller: AbortController | null = null

function onProviderChange() {
  modelId.value = provider.value.models[0]!.value
  onModelChange()
}

function onModelChange() {
  if (currentModel.value?.thinking) {
    params.value.temperature = 1
  } else if (params.value.temperature === 1) {
    params.value.temperature = 0.7
  }
}

function clearChat() {
  messages.value = []
  error.value = null
  stats.value = ''
}

async function send() {
  if (!input.value.trim() || generating.value) return
  const userMsg: Msg = { role: 'user', content: input.value }
  messages.value.push(userMsg)
  input.value = ''
  const idx = messages.value.push({ role: 'assistant', content: '', thinking: '' }) - 1

  generating.value = true
  error.value = null
  stats.value = ''
  const start = performance.now()
  let chars = 0

  controller = new AbortController()
  try {
    const res = await fetch('/api/aigc/llm-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        provider: providerId.value,
        model: modelId.value,
        messages: [
          { role: 'system', content: String(params.value.system) },
          ...messages.value.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
        ],
        stream: true,
        temperature: Number(params.value.temperature),
        maxTokens: Number(params.value.maxTokens)
      })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(t('llmChat.apiError', { message: detail.slice(0, 300) || `HTTP ${res.status}` }))
    }
    if (!res.body) throw new Error(t('llmChat.noStream'))

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          finished = true
          break
        }
        let chunk: SseChunk | undefined
        try {
          chunk = JSON.parse(data) as SseChunk
        } catch {
          continue
        }
        const delta = chunk?.choices?.[0]?.delta
        if (!delta) continue
        const r = delta.reasoning_content
        const c = delta.content
        if (r) {
          messages.value[idx]!.thinking = (messages.value[idx]!.thinking || '') + r
          chars += r.length
        }
        if (c) {
          messages.value[idx]!.content = (messages.value[idx]!.content || '') + c
          chars += c.length
        }
      }
    }
    // 流可能在最后一个分片没有换行符就结束，flush 残留 buffer
    if (!finished && buffer.trim()) {
      const data = buffer.startsWith('data:') ? buffer.slice(5).trim() : ''
      if (data && data !== '[DONE]') {
        try {
          const chunk = JSON.parse(data) as SseChunk
          const delta = chunk?.choices?.[0]?.delta
          if (delta?.reasoning_content) {
            messages.value[idx]!.thinking = (messages.value[idx]!.thinking || '') + delta.reasoning_content
            chars += delta.reasoning_content.length
          }
          if (delta?.content) {
            messages.value[idx]!.content = (messages.value[idx]!.content || '') + delta.content
            chars += delta.content.length
          }
        } catch { /* ignore trailing partial */ }
      }
    }
    try {
      await reader.cancel()
    } catch {
      /* 流已结束 */
    }
    const elapsed = ((performance.now() - start) / 1000).toFixed(1)
    stats.value = t('llmChat.stats', { model: modelId.value, elapsed, chars: String(chars) })
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      const elapsed = ((performance.now() - start) / 1000).toFixed(1)
      stats.value = t('llmChat.stopped', { elapsed })
    } else {
      error.value = humanError(e, t)
    }
  } finally {
    controller = null
    generating.value = false
  }
}

function stop() {
  controller?.abort()
}

const examples = computed(() => {
  const zh = locale.value === 'zh'
  return zh
    ? ['用一句话解释什么是神经网络', '帮我写一个 Python 快速排序', '比较一下 Kimi 和 DeepSeek 有什么不同']
    : ['Explain what a neural network is in one sentence', 'Write a Python quicksort', 'Compare Kimi and DeepSeek']
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UBadge color="primary" variant="subtle" icon="i-lucide-cloud">
        {{ t('llmChat.cloudBadge') }}
      </UBadge>
      <UBadge v-if="currentModel?.thinking" color="info" variant="subtle" icon="i-lucide-brain">
        {{ t('llmChat.thinkingBadge') }}
      </UBadge>
      <UButton
        icon="i-lucide-trash-2"
        :label="t('llmChat.clear')"
        color="neutral"
        variant="subtle"
        :disabled="!messages.length || generating"
        @click="clearChat"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-else color="info" variant="subtle" icon="i-lucide-info" :title="t('llmChat.configNote')" />

    <UCard>
      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-44 flex-1">
          <label class="block text-sm font-medium text-muted mb-1">{{ t('llmChat.provider') }}</label>
          <USelect
            v-model="providerId"
            :items="llmProviders.map(p => ({ label: p.label, value: p.id }))"
            :disabled="generating"
            class="w-full"
            @change="onProviderChange"
          />
        </div>
        <div class="min-w-56 flex-1">
          <label class="block text-sm font-medium text-muted mb-1">{{ t('llmChat.model') }}</label>
          <USelect
            v-model="modelId"
            :items="provider.models.map(m => ({ label: m.label, value: m.value }))"
            :disabled="generating"
            class="w-full"
            @change="onModelChange"
          />
        </div>
      </div>
    </UCard>

    <DemoParams v-model="params" :specs="specs" :running="generating" :disabled-keys="disabledKeys" />

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
            <div v-if="m.thinking" class="mb-2">
              <div class="flex items-center gap-1.5 text-xs text-muted mb-1">
                <UIcon name="i-lucide-brain" class="size-3.5" />
                {{ t('llmChat.thinking') }}
              </div>
              <p class="text-xs leading-relaxed text-muted whitespace-pre-wrap border-s-2 border-default ps-3">
                {{ m.thinking }}
              </p>
            </div>
            <p v-if="m.content" class="whitespace-pre-wrap">
              {{ m.content }}
            </p>
            <p v-else-if="m.role === 'assistant' && generating" class="text-muted">
              {{ t('llmChat.working') }}
            </p>
          </div>
        </div>
        <div v-if="!messages.length" class="text-center text-muted py-12 text-sm">
          {{ t('llmChat.empty') }}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-muted">{{ t('llmChat.examples') }}</span>
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
          :placeholder="t('llmChat.inputPlaceholder')"
          class="flex-1"
          @keydown.enter.exact.prevent="send"
        />
        <UButton
          v-if="generating"
          icon="i-lucide-square"
          :label="t('llmChat.stop')"
          color="neutral"
          variant="subtle"
          @click="stop"
        />
        <UButton
          v-else
          icon="i-lucide-send"
          :label="t('llmChat.send')"
          color="primary"
          :loading="generating"
          :disabled="!input.trim()"
          @click="send"
        />
      </div>
      <p v-if="stats" class="mt-2 text-xs text-muted">
        {{ stats }}
      </p>
    </UCard>
  </MediaDemoShell>
</template>
