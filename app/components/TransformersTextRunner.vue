<script setup lang="ts">
import { humanError } from '~/utils/errors'
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import {
  setupTransformersEnv,
  preferredDevice,
  hasWebGPU
} from '~/utils/transformers'
import type { TransformersTextTaskConfig, TransformersInputSpec } from '~/utils/transformers'

/**
 * 通用 transformers.js 文本演示运行器
 * - 支持 NLP 文本任务（ner / zero-shot / summarization / qa / fill-mask 等）
 * - 多输入控件（text / textarea）
 * - 可调参数面板
 * - 仅负责交互面；页面外壳（标题/HowItWorks/面包屑/SEO/上下篇）由 MediaDemoShell 提供。
 * - 结果通过 #result scoped slot 暴露（result 为 pipeline 返回值）
 */

const props = defineProps<{
  config: TransformersTextTaskConfig
}>()

const { t } = useI18n()

// 输入控件值：以 input.key 为字段
const inputValues = ref<Record<string, string>>({})
// 初始化默认值
for (const inp of props.config.inputs) {
  inputValues.value[inp.key] = inp.default ?? ''
}

// 可调参数
const paramSpecs = computed<ParamSpec[]>(() => props.config.params ? props.config.params(t) : [])
const paramValues = ref<Record<string, number | string | boolean>>(
  paramSpecs.value.length ? paramDefaults(paramSpecs.value) : {}
)
watch(paramSpecs, (specs) => {
  paramValues.value = specs.length ? paramDefaults(specs) : {}
})

const loading = ref(false) // 模型加载中
const running = ref(false) // 推理中
const loadProgress = ref(0)
const loadFile = ref('')
const error = ref<string | null>(null)
const result = ref<unknown>(null)
const inferenceTime = ref(0)
const copied = ref(false)
const webgpu = ref(hasWebGPU())

let pipe: ((...args: unknown[]) => Promise<unknown>) & { dispose?: () => Promise<void> } | null = null
let envReady = false

async function copyResult() {
  try {
    const text = typeof result.value === 'string'
      ? result.value
      : JSON.stringify(result.value, null, 2)
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch { /* clipboard 不可用时静默 */ }
}

function onProgress(x: { status?: string, file?: string, loaded?: number, total?: number }) {
  if (x?.status === 'progress' && x.file) {
    loadFile.value = String(x.file).split('/').pop() || x.file
    loadProgress.value = x.total ? Math.round(((x.loaded ?? 0) / x.total) * 100) : 0
  }
}

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
    const task = props.config.task
    const opts = {
      device: preferredDevice(),
      dtype: 'q8' as const,
      progress_callback: onProgress
    }
    pipe = await (pipeline as unknown as (
      task: string, model?: string, opts?: Record<string, unknown>
    ) => Promise<(...args: unknown[]) => Promise<unknown>>)(task, props.config.model, opts)
  } catch (e: unknown) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
  return pipe
}

function inputLabel(inp: TransformersInputSpec): string {
  return t(inp.labelKey)
}

function inputPlaceholder(inp: TransformersInputSpec): string | undefined {
  return inp.placeholderKey ? t(inp.placeholderKey) : undefined
}

async function run() {
  // 校验必填
  for (const inp of props.config.inputs) {
    if (!inputValues.value[inp.key]?.trim()) {
      error.value = t('tf.inputRequired')
      return
    }
  }
  const p = await ensurePipeline()
  if (!p) return
  running.value = true
  error.value = null
  result.value = null
  const ts = performance.now()
  try {
    const args = props.config.buildArgs(inputValues.value)
    const opts = props.config.callOptions
      ? props.config.callOptions(inputValues.value, paramValues.value)
      : {}
    result.value = await p(...args, opts)
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: unknown) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}

onBeforeUnmount(async () => {
  try {
    if (pipe) await pipe.dispose?.()
  } catch { /* ignore */ }
})
</script>

<template>
  <div class="space-y-6">
    <!-- 运行环境徽标（WebGPU / WASM） -->
    <div class="flex items-center gap-2">
      <UBadge
        v-if="webgpu"
        color="primary"
        variant="subtle"
        size="sm"
      >
        WebGPU
      </UBadge>
      <UBadge
        v-else
        color="neutral"
        variant="subtle"
        size="sm"
      >
        WASM
      </UBadge>
    </div>

    <!-- 输入区 -->
    <div class="space-y-3">
      <div
        v-for="inp in config.inputs"
        :key="inp.key"
      >
        <label class="block text-sm font-medium text-muted mb-1">{{ inputLabel(inp) }}</label>
        <UTextarea
          v-if="inp.type === 'textarea'"
          v-model="inputValues[inp.key]"
          :placeholder="inputPlaceholder(inp)"
          :rows="4"
          class="w-full"
        />
        <UInput
          v-else
          v-model="inputValues[inp.key]"
          :placeholder="inputPlaceholder(inp)"
          class="w-full"
        />
      </div>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-play"
          :label="loading ? t('demo.loadingModel') : (running ? t('demo.inferring') : t('demo.run'))"
          color="primary"
          :loading="loading || running"
          @click="run"
        />
        <div
          v-if="loading"
          class="min-w-40 flex-1 max-w-64"
        >
          <UProgress
            :model-value="loadProgress"
            size="sm"
          />
          <p class="text-xs text-muted truncate mt-1">
            {{ loadFile || t('demo.loadingModel') }}
          </p>
        </div>
        <span
          v-if="inferenceTime"
          class="text-sm text-muted ms-2 tabular-nums"
        >{{ inferenceTime }} ms</span>
      </div>
    </div>

    <!-- 错误 -->
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="error"
    />

    <!-- 可调参数 -->
    <DemoParams
      v-if="paramSpecs.length"
      v-model="paramValues"
      :specs="paramSpecs"
      :running="running"
    />

    <!-- 结果 -->
    <UCard v-if="$slots.result">
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon
              name="i-lucide-terminal"
              class="size-4"
            />
            {{ t('demo.result') }}
          </div>
          <UButton
            v-if="result"
            :label="copied ? t('demo.copied') : t('demo.copy')"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="copyResult"
          />
        </div>
      </template>
      <div
        v-if="!result"
        class="py-8 text-center text-sm text-muted"
      >
        {{ t('demo.emptyResult') }}
      </div>
      <slot
        v-else
        name="result"
        :result="result"
        :inference-time="inferenceTime"
      />
    </UCard>
  </div>
</template>
