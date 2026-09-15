<script setup lang="ts">
import { humanError } from '~/utils/errors'
import { mediapipeWasm } from '~/utils/mediapipe'
import type { TextClassifier, LanguageDetector } from '@mediapipe/tasks-text'

type TextTask = TextClassifier | LanguageDetector
/** WasmFileset 类型（库内声明未导出，经 createFromOptions 参数推导） */
type WasmFileset = Parameters<typeof TextClassifier.createFromOptions>[0]

/** MediaPipe 文本任务结果（classify/detect 两种形态，供 #result slot 使用） */
export interface MediaTextResult {
  classifications?: Array<{ categories?: Array<{ categoryName?: string, score: number }> }>
  languages?: Array<{ languageCode: string, probability: number }>
}

const props = defineProps<{
  createTask: (resolver: WasmFileset) => Promise<TextTask>
  method: 'classify' | 'detect'
  placeholder?: string
  /** 模型名（教学向展示）；为空时不显示模型卡 */
  model?: string
  /** 示例文本（label + text），未配置时回落通用默认 */
  samples?: Array<{ label: string, text: string }> | null
}>()

const { t } = useI18n()

const input = ref(t('samples.textDefault'))
const downloading = ref(false) // 模型下载/加载中
const running = ref(false) // 推理中
const error = ref<string | null>(null)
const result = ref<MediaTextResult | null>(null)
const inferenceTime = ref(0)
const copied = ref(false)

let task: TextTask | null = null

/** 应用示例文本（填充输入框；乐学场景点击即运行） */
async function useSample(s: { text: string }) {
  input.value = s.text
  await run()
}

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

async function ensureTask() {
  if (task) return task
  downloading.value = true
  error.value = null
  try {
    const { FilesetResolver } = await import('@mediapipe/tasks-text')
    const text = await FilesetResolver.forTextTasks(mediapipeWasm.text)
    task = await props.createTask(text)
  } catch (e: unknown) {
    error.value = humanError(e, t)
  } finally {
    downloading.value = false
  }
  return task
}

async function run() {
  if (!input.value.trim()) return
  const t0 = await ensureTask()
  if (!t0) return
  running.value = true
  error.value = null
  result.value = null
  const ts = performance.now()
  try {
    const taskImpl = t0 as TextTask & { classify?: (text: string) => MediaTextResult, detect?: (text: string) => MediaTextResult }
    const fn = props.method === 'classify' ? taskImpl.classify : taskImpl.detect
    result.value = (fn as (text: string) => MediaTextResult)?.(input.value) ?? null
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: unknown) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 模型信息（教学向：模型名 / 来源 / 本地推理） -->
    <div
      v-if="props.model"
      class="flex flex-wrap items-center gap-2 text-sm"
    >
      <span class="text-muted">{{ t('demo.model') }}:</span>
      <code class="px-1.5 py-0.5 rounded bg-default ring-1 ring-inset ring-muted/40 font-mono text-xs break-all">{{ props.model }}</code>
      <span class="text-xs text-dimmed">{{ t('demo.modelNote') }}</span>
    </div>

    <!-- 输入 -->
    <div class="space-y-2">
      <UTextarea
        v-model="input"
        :placeholder="placeholder || t('mp.textPlaceholder')"
        :rows="4"
        class="w-full"
      />
      <div class="flex items-center gap-2">
        <span
          v-if="samples?.length"
          class="text-xs text-dimmed me-1"
        >{{ t('samples.trySample') }}:</span>
        <UButton
          v-for="s in samples"
          :key="s.label"
          :label="s.label"
          icon="i-lucide-wand-2"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="!input.trim() || downloading || running"
          @click="useSample(s)"
        />
      </div>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-play"
          :label="downloading ? t('demo.loadingModel') : running ? t('demo.inferring') : t('demo.run')"
          color="primary"
          :loading="downloading || running"
          :disabled="!input.trim() || downloading || running"
          @click="run"
        />
        <span
          v-if="inferenceTime"
          class="text-sm text-muted ms-2 tabular-nums"
        >{{ inferenceTime }} ms</span>
      </div>
      <!-- 模型下载/推理进度（MediaPipe 无百分比回调，用不确定进度条 + 三态文案） -->
      <UProgress
        v-if="downloading || running"
        :value="null"
        size="sm"
        class="max-w-2xl"
      />
    </div>

    <!-- 错误 -->
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="error"
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
