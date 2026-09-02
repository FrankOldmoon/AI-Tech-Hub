<script setup lang="ts">
import { humanError } from '~/utils/errors'
import { mediapipeWasm } from '~/utils/mediapipe'

/**
 * 通用 MediaPipe 文本演示运行器
 * - 单文本输入，同步推理
 * - 仅负责交互面；页面外壳（标题/HowItWorks/面包屑/SEO/上下篇）由 MediaDemoShell 提供。
 * - 通过 props 注入 createTask / method
 * - 结果通过 #result scoped slot 暴露
 */

const props = defineProps<{
  createTask: (text: any) => Promise<any>
  method: 'classify' | 'detect'
  placeholder?: string
}>()

const { t } = useI18n()

const input = ref(t('samples.textDefault'))
const downloading = ref(false) // 模型下载/加载中
const running = ref(false) // 推理中
const error = ref<string | null>(null)
const result = ref<any>(null)
const inferenceTime = ref(0)
const copied = ref(false)

let task: any = null

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
  } catch (e: any) {
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
    result.value = t0[props.method](input.value)
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 输入 -->
    <div class="space-y-2">
      <UTextarea
        v-model="input"
        :placeholder="placeholder || t('mp.textPlaceholder')"
        :rows="4"
        class="w-full"
      />
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
          class="text-sm text-muted ms-2"
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
