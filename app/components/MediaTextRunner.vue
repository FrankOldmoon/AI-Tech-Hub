<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'
import { mediapipeWasm } from '~/utils/mediapipe'

/**
 * 通用 MediaPipe 文本演示运行器
 * - 单文本输入，同步推理
 * - 通过 props 注入 createTask / method
 * - 结果通过 #result scoped slot 暴露
 */
interface RunnerDemo {
  title: string
  description?: string
  icon: string
  status: DemoStatus
  /** 对应 python 下的模块路径，用于展示最简 Python 实现 */
  pythonModule?: string
}

const props = defineProps<{
  demo: RunnerDemo
  createTask: (text: any) => Promise<any>
  method: 'classify' | 'detect'
  placeholder?: string
}>()

const { t } = useI18n()
const input = ref(t('samples.textDefault'))
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<any>(null)
const inferenceTime = ref(0)

let task: any = null

async function ensureTask() {
  if (task) return task
  loading.value = true
  error.value = null
  try {
    const { FilesetResolver } = await import('@mediapipe/tasks-text')
    const text = await FilesetResolver.forTextTasks(mediapipeWasm.text)
    task = await props.createTask(text)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
  return task
}

async function run() {
  if (!input.value.trim()) return
  const t0 = await ensureTask()
  if (!t0) return
  loading.value = true
  error.value = null
  result.value = null
  const ts = performance.now()
  try {
    result.value = t0[props.method](input.value)
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}
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
            :label="t('demo.run')"
            color="primary"
            :loading="loading"
            :disabled="!input.trim()"
            @click="run"
          />
          <span v-if="inferenceTime" class="text-sm text-muted ms-2">{{ inferenceTime }} ms</span>
        </div>
      </div>

      <!-- 错误 -->
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

      <!-- 结果 -->
      <UCard v-if="$slots.result">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-terminal" class="size-4" />
            {{ t('demo.result') }}
          </div>
        </template>
        <slot name="result" :result="result" :inference-time="inferenceTime" />
      </UCard>

      <!-- 对应的 Python 最简实现源码 -->
      <PythonSourceViewer v-if="demo.pythonModule" :feature="demo.pythonModule" />
    </div>
  </UContainer>
</template>
