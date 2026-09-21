<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { isRemoteDeploy } from '~/utils/remote-models'

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

/**
 * Nuxt UI 的 Chat 组件按 AI SDK 的 UIMessage 形状取字段（role + parts）：
 * 助手先占位、parts 留空 → UChatMessages 显示「思考中」指示器，首个 token 到达再换成文本。
 */
interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  parts: { type: 'text', text: string }[]
}
const messages = ref<ChatMsg[]>([])
/** 递增 id，不用 crypto.randomUUID：内网 http 部署不是安全上下文，那个 API 会缺失 */
let msgSeq = 0
function newMsg(role: ChatMsg['role'], text = ''): ChatMsg {
  return { id: `m${++msgSeq}`, role, parts: text ? [{ type: 'text', text }] : [] }
}
/** 把 parts 拼回纯文本：既要喂给引擎的 {role, content}，也是 Markdown 渲染的入口 */
const textOf = (parts: ChatMsg['parts']) => parts.map(p => p.text).join('')

/** 流式状态交给 Chat 组件；UChatPromptSubmit 据此把「发送」换成「停止」 */
const chatStatus = computed<'ready' | 'streaming'>(() => (generating.value ? 'streaming' : 'ready'))

let engine: any = null
let loadedModelId: string | null = null
/** 生成中被用户打断：中断会让流抛错，用这个标记把那次错误吞掉 */
let stopRequested = false

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

/** WebLLM 预置模型记录（只声明用到的字段） */
interface WebllmModelRecord { model_id: string, model: string, model_lib?: string }

/**
 * 探测本地预置情况 —— 模型权重（mlc-chat-config.json）与 model_lib（.wasm）分别判断，
 * 两者可以独立选取本地/远程（lib 就在仓库里，不该因为权重没预取就跑去远端拉 5MB）。
 *
 * 必须探测，不能无条件把 URL 改成本地的：
 * - dev 模式**不预下载模型**（server/plugins/download-models.ts 只在 production 跑），
 * - 且 webllm/ 目录**故意没有服务端 302 回退**（见 server/utils/model-sources.ts：
 *   约定「由 web-llm 自己按 CDN 回退」）。
 * 无脑改写 → /model/webllm/... 直接 404 → WebLLM 的 Cache API 抛出一句完全没法照做的
 * "Failed to execute 'add' on 'Cache': Request failed"。
 */
async function probeLocal(record: WebllmModelRecord): Promise<{ model: boolean, lib: boolean }> {
  const origin = window.location.origin
  /** 只取 1 字节：够判断存在性，又不至于为几 MB 的 wasm 白下一遍（200/206 都算存在） */
  const probe = (url: string) => fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
    .then(r => r.ok)
    .catch(() => false)
  const libName = String(record.model_lib ?? '').split('/').pop() ?? ''
  const [model, lib] = await Promise.all([
    probe(`${origin}/model/webllm/mlc-ai/${record.model_id}/resolve/main/mlc-chat-config.json`),
    libName ? probe(`${origin}/model/webllm/libs/${libName}`) : Promise.resolve(false)
  ])
  return { model, lib }
}

/**
 * WebLLM 把模型写进 Cache API；下载失败（404 / 断网 / CORS）时抛的是一句读不懂的
 * "Failed to execute 'add' on 'Cache': Request failed"。认出来换成能照做的提示。
 */
function isCacheFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /on 'Cache'|'Cache': Request failed/i.test(msg)
}

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
    // 模型权重三级来源（注意：必须用绝对 URL —— WebLLM 内部 cleanModelUrl 会
    // new URL(相对路径) 且无 base，相对路径会抛 "Invalid URL"）：
    //   1) 本地 .models/webllm/（Range 服务，离线最快）
    //   2) 自家 /api/hf 代理：同源，服务端按 ModelScope → hf-mirror → huggingface
    //      逐个试（ModelScope 不带 CORS 头，浏览器直连不了，只能由服务端代理）
    //   3) 云端（Vercel）：保留原始 HuggingFace / GitHub raw 地址 —— 不能让函数实例
    //      去转发几百 MB 的权重
    let modelList = prebuiltAppConfig.model_list
    if (!isRemoteDeploy()) {
      const origin = window.location.origin
      const record = (prebuiltAppConfig.model_list as unknown as WebllmModelRecord[])
        .find(m => m.model_id === modelId.value)
      const local = record ? await probeLocal(record) : { model: false, lib: false }
      const hfBase = local.model ? `${origin}/model/webllm` : `${origin}/api/hf`
      const localLibBase = `${origin}/model/webllm/libs/`
      modelList = prebuiltAppConfig.model_list.map(m => ({
        ...m,
        model: typeof m.model === 'string'
          ? m.model.replace('https://huggingface.co', hfBase)
          : m.model,
        // model_lib 看本地有没有那份：远程的 GitHub raw / jsdelivr 本身带 CORS，
        // 而 /api/hf 只代理 HuggingFace，代理不了它
        model_lib: local.lib && typeof m.model_lib === 'string'
          ? m.model_lib.replace(
              /^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/main\/web-llm-models\/[^/]+\/base\//,
              localLibBase
            )
          : m.model_lib
      }))
    }
    engine = await CreateMLCEngine(modelId.value, {
      appConfig: { model_list: modelList },
      initProgressCallback: (r: any) => {
        loadProgress.value = Math.round((r.progress || 0) * 100)
        loadText.value = r.text || ''
      }
    })
    loadedModelId = modelId.value
  } catch (e: any) {
    error.value = isCacheFailure(e) ? t('webllm.loadFailed') : humanError(e, t)
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
  messages.value.push(newMsg('user', input.value))
  input.value = ''
  generating.value = true
  error.value = null
  stopRequested = false
  // 助手占位：parts 先留空，UChatMessages 会在上一条用户消息下面显示「思考中」
  messages.value.push(newMsg('assistant'))
  const assistant = messages.value[messages.value.length - 1]!
  try {
    const apiMessages = [
      { role: 'system', content: String(params.value.system) },
      ...messages.value.slice(0, -1).map(m => ({ role: m.role, content: textOf(m.parts) }))
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
      if (!delta) continue
      const first = assistant.parts[0]
      if (first) first.text += delta
      else assistant.parts.push({ type: 'text', text: delta })
    }
    try {
      stats.value = await engine.runtimeStats()
    } catch { /* ignore */ }
  } catch (e: any) {
    // 用户点了停止：中断本身会让流抛错，不该当成失败弹出来
    if (!stopRequested) error.value = humanError(e, t)
  } finally {
    stopRequested = false
    generating.value = false
  }
}

/** 生成中用户点「停止」（UChatPromptSubmit 在流式态会把按钮换成停止图标） */
function stopGenerate() {
  stopRequested = true
  engine?.interruptGenerate?.()
}

function clearChat() {
  messages.value = []
  error.value = null
}

async function onModelChange() {
  if (engine) {
    stopRequested = true
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
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <HeavyModelNotice :size-gb="1.5" />

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
            <USelect
              v-model="modelId"
              :items="modelItems"
              :disabled="loading || generating"
              class="w-full"
              @change="onModelChange"
            />
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
        <div
          v-if="loading"
          class="mt-4 space-y-2"
        >
          <UProgress :model-value="loadProgress" />
          <p class="text-xs text-muted truncate">
            {{ loadText }}
          </p>
        </div>
      </UCard>

      <!-- 可调参数 -->
      <DemoParams
        v-model="params"
        :specs="specs"
        :running="generating"
      />

      <!-- 错误 -->
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <!-- 对话区：气泡、角色侧别、流式「思考中」指示器、贴底滚动都由 Chat 组件负责
           （shouldAutoScroll 默认 false，不打开的话流式输出不会自动跟着滚） -->
      <UCard>
        <UChatMessages
          v-if="messages.length"
          :messages="messages"
          :status="chatStatus"
          should-auto-scroll
          class="min-h-64 max-h-[60vh] overflow-auto"
        >
          <!-- 助手回复按 Markdown 渲染 —— Chat 组件本身只出纯文本（默认 `<template v-for>` 直接打印 part.text）。
               原始 HTML / 危险协议已在 renderMarkdown 里收紧，产物可以安全 v-html；
               用户输入保持纯文本（自己敲的 ** 不该被当成语法）。
               样式用 Tailwind 子选择器变体给：v-html 的内容拿不到 scoped 属性，写 :deep 也白搭。 -->
          <template #content="{ role, parts }">
            <div
              v-if="role === 'assistant'"
              class="text-sm leading-relaxed
                [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
                [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold
                [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-semibold
                [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold
                [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:font-semibold
                [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-5
                [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-5
                [&_li]:my-0.5
                [&_strong]:font-semibold
                [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]
                [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-elevated [&_pre]:p-3
                [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.8rem]
                [&_blockquote]:my-2 [&_blockquote]:border-s-2 [&_blockquote]:border-default [&_blockquote]:ps-3 [&_blockquote]:text-muted
                [&_hr]:my-3 [&_hr]:border-default
                [&_table]:my-2 [&_table]:w-full [&_table]:text-xs
                [&_th]:border [&_th]:border-default [&_th]:px-2 [&_th]:py-1 [&_th]:text-start
                [&_td]:border [&_td]:border-default [&_td]:px-2 [&_td]:py-1
                [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded"
              v-html="renderMarkdown(textOf(parts))"
            />
            <span
              v-else
              class="whitespace-pre-wrap"
            >{{ textOf(parts) }}</span>
          </template>
        </UChatMessages>
        <div
          v-else
          class="text-center text-muted py-12 text-sm"
        >
          {{ t('webllm.empty') }}
        </div>
      </UCard>

      <!-- 输入：Enter 提交（对中文输入法安全，见组件的 IME guard）；流式时提交键自动变成「停止」 -->
      <UCard>
        <UChatPrompt
          v-model="input"
          :rows="3"
          :placeholder="t('webllm.inputPlaceholder')"
          :disabled="loading"
          @submit="send"
        >
          <UChatPromptSubmit
            :status="chatStatus"
            :disabled="loading"
            @stop="stopGenerate"
          />
        </UChatPrompt>
        <p
          v-if="stats"
          class="mt-2 text-xs text-muted"
        >
          {{ stats }}
        </p>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
