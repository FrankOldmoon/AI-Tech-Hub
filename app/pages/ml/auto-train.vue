<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'auto-train')!)

const fileInput = ref<HTMLInputElement>()
const fileName = ref('')
const columns = ref<string[]>([])
const target = ref('')
const task = ref('auto')
const submitting = ref(false)
const error = ref<string | null>(null)
const taskId = ref('')
const progress = ref(0)
const message = ref('')
const report = ref<any>(null)

const maxMatrixCell = computed(() => {
  const cm = report.value?.confusion_matrix
  if (!cm) return 1
  return Math.max(...cm.matrix.flat().map(Number), 1)
})

function metricEntries(m: Record<string, unknown>): Record<string, number> {
  const entries: Record<string, number> = {}
  for (const key of ['accuracy', 'f1', 'precision', 'recall', 'r2', 'mae', 'mse']) {
    if (typeof m[key] === 'number') entries[key] = m[key] as number
  }
  return entries
}

function metricLabel(key: string): string {
  const labels: Record<string, string> = {
    accuracy: 'ACC', f1: 'F1', precision: 'P', recall: 'R', r2: 'R²', mae: 'MAE', mse: 'MSE'
  }
  return labels[key] || key
}

function metricValue(key: string, v: number): number {
  return key === 'mae' || key === 'mse' ? Math.min(v, 1) : Math.max(0, Math.min(v, 1))
}

const taskOptions = computed(() => [
  { label: t('ml.autoTrain.taskAuto'), value: 'auto' },
  { label: t('ml.autoTrain.taskClassification'), value: 'classification' },
  { label: t('ml.autoTrain.taskRegression'), value: 'regression' }
])

function parseCsvHeader(text: string): string[] {
  const firstLine = text.split(/\r?\n/).find(line => line.trim().length > 0) || ''
  return firstLine.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  error.value = null
  report.value = null
  // 读取前 64KB 解析表头
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result || '')
    columns.value = parseCsvHeader(text)
    target.value = columns.value[columns.value.length - 1] || ''
  }
  reader.readAsText(file.slice(0, 65536))
}

const { poll, stop: stopPolling } = useTaskPoller({
  interval: 1800,
  progress,
  progressText: message,
  error,
  timeoutMessage: t('demo.taskTimeout'),
  failMessage: t('ml.autoTrain.error'),
  errorMessage: t('ml.autoTrain.error'),
  onCancelled: () => t('ml.autoTrain.cancelled'),
  onDone: async (task) => {
    if (task.reportUrl) report.value = await $fetch(task.reportUrl)
  }
})

async function submit() {
  const file = fileInput.value?.files?.[0]
  if (!file) {
    error.value = t('ml.autoTrain.noFile')
    return
  }
  if (!target.value) {
    error.value = t('ml.autoTrain.noTarget')
    return
  }
  error.value = null
  report.value = null
  submitting.value = true
  const form = new FormData()
  form.append('file', file)
  form.append('target', target.value)
  form.append('task', task.value)
  try {
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/ml/auto-train', {
      method: 'POST',
      body: form
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('ml.autoTrain.error')
      submitting.value = false
      return
    }
    taskId.value = res.taskId
    await poll(`/api/ml/auto-train/${res.taskId}`)
    submitting.value = false
  } catch (e: any) {
    error.value = e?.message || String(e)
    submitting.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/ml/auto-train/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
  stopPolling()
  submitting.value = false
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 上传与参数 -->
    <UCard>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-upload"
            :label="fileName || t('ml.autoTrain.upload')"
            color="primary"
            variant="subtle"
            :disabled="submitting"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange">
          <p class="text-sm text-muted">{{ t('ml.autoTrain.uploadHint') }}</p>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.autoTrain.target') }}</p>
            <USelect
              v-model="target"
              :items="columns.map(c => ({ label: c, value: c }))"
              class="w-full"
              :disabled="!columns.length || submitting"
            />
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.autoTrain.task') }}</p>
            <USelect
              v-model="task"
              :items="taskOptions"
              class="w-full"
              :disabled="submitting"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-brain"
            :label="t('ml.autoTrain.train')"
            color="primary"
            :loading="submitting"
            :disabled="!fileName || !target"
            @click="submit"
          />
          <UButton
            v-if="submitting"
            icon="i-lucide-x"
            :label="t('ml.autoTrain.cancel')"
            color="error"
            variant="subtle"
            @click="cancel"
          />
        </div>
      </div>
    </UCard>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <!-- 进度 -->
    <UCard v-if="submitting">
      <div class="space-y-2">
        <div class="flex justify-between text-sm">
          <span class="text-muted">{{ message }}</span>
          <span class="tabular-nums">{{ progress }}%</span>
        </div>
        <UProgress :model-value="progress" size="sm" />
      </div>
    </UCard>

    <!-- 报告 -->
    <template v-if="report">
      <!-- 概览 -->
      <UCard>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.autoTrain.overviewTask') }}</p>
            <p class="text-lg font-bold text-highlighted">{{ report.task === 'classification' ? t('ml.autoTrain.taskClassification') : t('ml.autoTrain.taskRegression') }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.autoTrain.samples') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.samples }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.autoTrain.features') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.features }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.autoTrain.target') }}</p>
            <p class="text-lg font-bold text-highlighted truncate">{{ report.target }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.autoTrain.best') }}</p>
            <p class="text-lg font-bold text-primary truncate">{{ report.best }}</p>
          </div>
        </div>
      </UCard>

      <!-- 模型对比 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-git-compare" class="size-4" />
            {{ t('ml.autoTrain.models') }}
          </div>
        </template>
        <div class="space-y-4">
          <div
            v-for="(m, i) in report.models"
            :key="i"
            class="flex items-center gap-3"
          >
            <span class="text-sm font-medium w-28 shrink-0 truncate">{{ m.name }}</span>
            <div class="flex-1 space-y-1">
              <div v-if="m.error" class="text-xs text-error">{{ m.error }}</div>
              <template v-else>
                <div
                  v-for="(v, key) in metricEntries(m)"
                  :key="key"
                  class="flex items-center gap-2"
                >
                  <span class="text-xs text-muted w-14 shrink-0">{{ metricLabel(key) }}</span>
                  <UProgress :model-value="metricValue(key, v) * 100" size="xs" class="flex-1" />
                  <span class="text-xs text-muted w-12 text-right tabular-nums">{{ v.toFixed(4) }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </UCard>

      <!-- 混淆矩阵（分类） -->
      <UCard v-if="report.confusion_matrix">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-grid-3x3" class="size-4" />
            {{ t('ml.autoTrain.confusionMatrix') }}
          </div>
        </template>
        <div class="overflow-x-auto">
          <table class="text-sm">
            <thead>
              <tr>
                <th class="p-1"></th>
                <th
                  v-for="(label, j) in report.confusion_matrix.labels"
                  :key="j"
                  class="p-1 font-medium text-muted text-center"
                >
                  {{ label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in report.confusion_matrix.matrix" :key="i">
                <th class="p-1 font-medium text-muted text-right">{{ report.confusion_matrix.labels[i] }}</th>
                <td
                  v-for="(cell, j) in row"
                  :key="j"
                  class="p-1 text-center tabular-nums rounded"
                  :style="{ background: `rgba(0, 220, 130, ${Math.min(cell / maxMatrixCell, 1) * 0.55})` }"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <!-- 特征重要性 -->
      <UCard v-if="report.feature_importance?.length">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-bar-chart-3" class="size-4" />
            {{ t('ml.autoTrain.featureImportance') }}
          </div>
        </template>
        <div class="space-y-2">
          <div
            v-for="(f, i) in report.feature_importance"
            :key="i"
            class="flex items-center gap-3"
          >
            <span class="text-sm font-medium w-40 shrink-0 truncate">{{ f.name }}</span>
            <UProgress :model-value="f.importance * 100" size="sm" class="flex-1" />
            <span class="text-sm text-muted w-14 text-right tabular-nums">{{ (f.importance * 100).toFixed(1) }}%</span>
          </div>
        </div>
      </UCard>

      <!-- 示例预测 -->
      <UCard v-if="report.sample_predictions?.length">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-table" class="size-4" />
            {{ t('ml.autoTrain.samplePredictions') }}
          </div>
        </template>
        <div class="overflow-x-auto">
          <table class="text-sm w-full">
            <thead>
              <tr class="text-muted">
                <th class="text-start p-1">{{ t('ml.autoTrain.actual') }}</th>
                <th class="text-start p-1">{{ t('ml.autoTrain.predicted') }}</th>
                <th class="text-start p-1">{{ t('ml.autoTrain.correct') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in report.sample_predictions"
                :key="i"
                :class="String(row.actual) === String(row.predicted) ? '' : 'text-error'"
              >
                <td class="p-1">{{ row.actual }}</td>
                <td class="p-1">{{ row.predicted }}</td>
                <td class="p-1">
                  <UIcon
                    :name="String(row.actual) === String(row.predicted) ? 'i-lucide-check' : 'i-lucide-x'"
                    :class="String(row.actual) === String(row.predicted) ? 'text-success' : 'text-error'"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>
  </MediaDemoShell>
</template>
