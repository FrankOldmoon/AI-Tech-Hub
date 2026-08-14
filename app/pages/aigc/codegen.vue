<script setup lang="ts">
/**
 * 代码生成与执行：
 * - Qwen2.5-Coder / StarCoder 在浏览器本地补全代码（transformers.js）
 * - 生成的 Python 可直接用 Pyodide 在浏览器运行（数据不出本机）
 */
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { setupTransformersEnv, preferredDevice, hasWebGPU } from '~/utils/transformers'
import { ensurePyodide, runPyodide } from '~/composables/usePyodide'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'codegen')!)

const modelItems = [
  { label: 'Qwen2.5-Coder-0.5B', value: 'onnx-community/Qwen2.5-Coder-0.5B-ONNX' },
  { label: 'tiny_starcoder_py', value: 'Xenova/tiny_starcoder_py' },
  { label: 'codegen-350M-mono', value: 'Xenova/codegen-350M-mono' }
]

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'maxTokens',
    label: t('codegen.maxTokens'),
    type: 'slider',
    default: 128,
    min: 16,
    max: 512,
    step: 16
  },
  {
    key: 'temperature',
    label: t('codegen.temperature'),
    type: 'slider',
    default: 0.5,
    min: 0,
    max: 2,
    step: 0.05
  },
  {
    key: 'topK',
    label: t('codegen.topK'),
    type: 'slider',
    default: 5,
    min: 1,
    max: 50,
    step: 1
  },
  {
    key: 'doSample',
    label: t('codegen.doSample'),
    type: 'switch',
    default: false,
    help: t('codegen.doSampleHelp')
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))
const modelId = ref(modelItems[0]!.value)

const DEFAULT_CODE = `# 在这里写代码，然后点"生成补全"
def fib(n):
    """Calculates the nth Fibonacci number"""
`

const code = ref(DEFAULT_CODE)
const result = ref('')
const loading = ref(false)
const generating = ref(false)
const error = ref<string | null>(null)
const modelReady = ref(false)
const progressFile = ref('')
const progressPct = ref(0)
const webgpu = ref(false)

// Pyodide 状态
const pyReady = ref(false)
const pyLoading = ref(false)
const runningPy = ref(false)
const pyOutput = ref('')
const pyError = ref(false)

onMounted(() => { webgpu.value = hasWebGPU() })

let generator: any = null
let loadedModelId: string | null = null
let envReady = false

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
  if (generator && loadedModelId === modelId.value) return
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { env, pipeline } = await import('@huggingface/transformers')
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false
    if (generator) {
      try { await generator.dispose() } catch { /* ignore */ }
      generator = null
    }
    const useGpu = webgpu.value
    const fp16 = await supportsFP16()
    const dtype = useGpu && fp16 ? 'q4f16' : 'q8'
    const device = useGpu ? 'webgpu' : 'wasm'
    generator = await pipeline('text-generation', modelId.value, { dtype, device, progress_callback: onProgress })
    env.allowLocalModels = prevAllowLocal
    loadedModelId = modelId.value
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
  result.value = ''
  try {
    if (generator) await generator.dispose()
  } catch { /* ignore */ }
  generator = null
  loadedModelId = null
  modelReady.value = false
}

async function complete() {
  if (!code.value.trim()) return
  await ensureModel()
  if (!generator) return
  generating.value = true
  error.value = null
  result.value = ''
  try {
    const { TextStreamer } = await import('@huggingface/transformers')
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      callback_function: (x: string) => {
        result.value += x
      }
    })
    await generator(code.value, {
      max_new_tokens: Number(params.value.maxTokens),
      temperature: Number(params.value.temperature),
      top_k: Number(params.value.topK),
      do_sample: Boolean(params.value.doSample),
      streamer
    })
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    generating.value = false
  }
}

function applyResult() {
  if (!result.value) return
  code.value += result.value
  result.value = ''
}

async function loadPyodide() {
  if (pyReady.value) return
  pyLoading.value = true
  pyError.value = false
  try {
    await ensurePyodide()
    pyReady.value = true
  } catch (e: any) {
    pyError.value = true
    error.value = e?.message || String(e)
  } finally {
    pyLoading.value = false
  }
}

async function runPython() {
  const target = result.value || code.value
  if (!target.trim()) return
  if (!pyReady.value) await loadPyodide()
  if (!pyReady.value) return
  runningPy.value = true
  pyOutput.value = ''
  pyError.value = false
  try {
    const res = await runPyodide(target)
    pyOutput.value = res.output
    pyError.value = res.hasError
  } finally {
    runningPy.value = false
  }
}

function copyResult() {
  navigator.clipboard?.writeText(result.value).catch(() => { /* ignore */ })
}

onBeforeUnmount(async () => {
  try { if (generator) await generator.dispose() } catch { /* ignore */ }
  generator = null
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM</UBadge>
      <UBadge v-if="modelReady" color="success" variant="subtle">
        {{ t('codegen.loaded') }}
      </UBadge>
      <UBadge v-if="pyReady" color="success" variant="subtle">
        <UIcon name="i-lucide-check" class="size-3" />
        Pyodide
      </UBadge>
      <UBadge v-else-if="pyLoading" color="neutral" variant="subtle">
        <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
        {{ t('codegen.loadingPy') }}
      </UBadge>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-if="!modelReady && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('codegen.firstDownload')" />

    <div v-if="loading" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted truncate">{{ progressFile || t('codegen.loadingModel') }}</span>
        <span class="text-muted">{{ progressPct }}%</span>
      </div>
      <UProgress :model-value="progressPct" />
    </div>

    <UCard>
      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-56 flex-1">
          <label class="block text-sm font-medium text-muted mb-1">{{ t('codegen.model') }}</label>
          <USelect v-model="modelId" :items="modelItems" :disabled="loading || generating" class="w-full" @change="onModelChange" />
        </div>
        <UButton
          icon="i-lucide-download"
          :label="modelReady ? t('codegen.loaded') : t('codegen.load')"
          color="primary"
          :loading="loading"
          :disabled="loading || generating || modelReady"
          @click="ensureModel"
        />
      </div>
    </UCard>

    <DemoParams v-model="params" :specs="specs" :running="generating" />

    <div class="grid lg:grid-cols-2 gap-4">
      <!-- 编辑器 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-code-xml" class="size-4" />
            {{ t('codegen.editor') }}
          </div>
        </template>
        <textarea
          v-model="code"
          spellcheck="false"
          class="w-full h-64 resize-y rounded-lg border border-default bg-elevated/60 p-3 font-mono text-sm text-highlighted focus:outline-none focus:border-primary"
        />
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('codegen.complete')"
            color="primary"
            :loading="generating"
            :disabled="loading || generating || !code.trim()"
            @click="complete"
          />
          <UButton
            v-if="!pyReady"
            icon="i-lucide-download"
            :label="t('codegen.loadPy')"
            variant="subtle"
            color="neutral"
            :loading="pyLoading"
            @click="loadPyodide"
          />
          <UButton
            icon="i-lucide-play"
            :label="t('codegen.runPython')"
            color="secondary"
            variant="subtle"
            :loading="runningPy"
            :disabled="runningPy || (!result && !code.trim())"
            @click="runPython"
          />
        </div>
      </UCard>

      <!-- AI 输出 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-sparkles" class="size-4" />
            {{ t('codegen.output') }}
          </div>
        </template>
        <pre class="h-64 overflow-auto rounded-lg border border-default bg-elevated/60 p-3 font-mono text-sm text-highlighted whitespace-pre-wrap"><code>{{ result || (generating ? '…' : t('codegen.outputHint')) }}</code></pre>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <UButton
            v-if="result"
            icon="i-lucide-corner-down-left"
            :label="t('codegen.apply')"
            color="primary"
            variant="subtle"
            @click="applyResult"
          />
          <UButton
            v-if="result"
            icon="i-lucide-copy"
            :label="t('codegen.copy')"
            color="neutral"
            variant="subtle"
            @click="copyResult"
          />
          <UButton
            v-if="result"
            icon="i-lucide-rotate-ccw"
            :label="t('codegen.retry')"
            color="neutral"
            variant="subtle"
            :disabled="generating"
            @click="complete"
          />
        </div>
      </UCard>
    </div>

    <!-- Pyodide 运行输出 -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-terminal" class="size-4" />
          {{ t('codegen.runOutput') }}
        </div>
      </template>
      <pre
        class="min-h-24 max-h-64 overflow-auto rounded-lg border border-default bg-elevated/60 p-3 font-mono text-sm whitespace-pre-wrap"
        :class="pyError ? 'text-error' : 'text-highlighted'"
      ><code>{{ runningPy ? t('codegen.runningPy') : (pyOutput || t('codegen.runOutputHint')) }}</code></pre>
    </UCard>
  </MediaDemoShell>
</template>
