<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'forecast')!)

const fileInput = ref<HTMLInputElement>()
const fileName = ref('')
const columns = ref<string[]>([])
const dateCol = ref('')
const valueCol = ref('')
const horizon = ref(30)
const submitting = ref(false)
const error = ref<string | null>(null)
const taskId = ref('')
const progress = ref(0)
const message = ref('')
const report = ref<any>(null)

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
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result || '')
    columns.value = parseCsvHeader(text)
    if (columns.value.length >= 2) {
      dateCol.value = columns.value[0]
      valueCol.value = columns.value[1]
    }
  }
  reader.readAsText(file.slice(0, 65536))
}

const { poll, stop: stopPolling } = useTaskPoller({
  interval: 1800,
  progress,
  progressText: message,
  error,
  timeoutMessage: t('demo.taskTimeout'),
  failMessage: t('ml.forecast.error'),
  errorMessage: t('ml.forecast.error'),
  onCancelled: () => t('ml.forecast.cancelled'),
  onDone: async (task) => {
    if (task.reportUrl) report.value = await $fetch(task.reportUrl)
  }
})

async function submit() {
  const file = fileInput.value?.files?.[0]
  if (!file) { error.value = t('ml.forecast.noFile'); return }
  if (!dateCol.value || !valueCol.value) { error.value = t('ml.forecast.noColumns'); return }
  error.value = null
  report.value = null
  submitting.value = true
  const form = new FormData()
  form.append('file', file)
  form.append('dateCol', dateCol.value)
  form.append('valueCol', valueCol.value)
  form.append('horizon', String(horizon.value))
  try {
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/ml/forecast', {
      method: 'POST',
      body: form
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('ml.forecast.error')
      submitting.value = false
      return
    }
    taskId.value = res.taskId
    await poll(`/api/ml/forecast/${res.taskId}`)
    submitting.value = false
  } catch (e: any) {
    error.value = e?.message || String(e)
    submitting.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  try { await $fetch(`/api/ml/forecast/${taskId.value}`, { method: 'DELETE' }) } catch { /* ignore */ }
  stopPolling()
  submitting.value = false
}

// SVG 图表计算
const chart = computed(() => {
  const r = report.value
  if (!r) return null
  const allDates = [...r.dates, ...r.forecast_dates]
  const allValues = [...r.history, ...r.forecast]
  const allLower = [...r.history, ...r.lower]
  const allUpper = [...r.history, ...r.upper]
  const min = Math.min(...allLower)
  const max = Math.max(...allUpper)
  const span = max - min || 1
  const W = 800
  const H = 300
  const PAD = 30
  const x = (i: number) => PAD + (i / Math.max(allDates.length - 1, 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const histLine = r.dates.map((_: string, i: number) => `${x(i).toFixed(1)},${y(allValues[i]).toFixed(1)}`).join(' ')
  const fcLine = r.dates.map((_: string, i: number) => `${x(i).toFixed(1)},${y(allValues[i]).toFixed(1)}`).join(' ') + ' ' +
    r.forecast_dates.map((_: string, i: number) => `${x(r.dates.length + i).toFixed(1)},${y(allValues[r.dates.length + i]).toFixed(1)}`).join(' ')
  const band = r.dates.map((_: string, i: number) => `${x(i).toFixed(1)},${y(allLower[i]).toFixed(1)}`).join(' ') + ' ' +
    r.forecast_dates.map((_: string, i: number) => `${x(r.dates.length + i).toFixed(1)},${y(allLower[r.dates.length + i]).toFixed(1)}`).join(' ') + ' ' +
    [...r.forecast_dates].reverse().map((_: string, i: number) => {
      const j = r.dates.length + r.forecast_dates.length - 1 - i
      return `${x(j).toFixed(1)},${y(allUpper[j]).toFixed(1)}`
    }).join(' ') + ' ' +
    [...r.dates].reverse().map((_: string, i: number) => {
      const j = r.dates.length - 1 - i
      return `${x(j).toFixed(1)},${y(allUpper[j]).toFixed(1)}`
    }).join(' ')
  return { W, H, PAD, histLine, fcLine, band, splitX: x(r.dates.length - 1), min, max, allDates, allValues, historyCount: r.dates.length }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UCard>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-upload"
            :label="fileName || t('ml.forecast.upload')"
            color="primary"
            variant="subtle"
            :disabled="submitting"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange">
          <p class="text-sm text-muted">{{ t('ml.forecast.uploadHint') }}</p>
        </div>

        <div class="grid sm:grid-cols-3 gap-4">
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.forecast.dateCol') }}</p>
            <USelect
              v-model="dateCol"
              :items="columns.map(c => ({ label: c, value: c }))"
              class="w-full"
              :disabled="!columns.length || submitting"
            />
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.forecast.valueCol') }}</p>
            <USelect
              v-model="valueCol"
              :items="columns.map(c => ({ label: c, value: c }))"
              class="w-full"
              :disabled="!columns.length || submitting"
            />
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.forecast.horizon') }}: {{ horizon }}</p>
            <USlider v-model="horizon" :min="5" :max="180" :step="5" :disabled="submitting" />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-trending-up"
            :label="t('ml.forecast.run')"
            color="primary"
            :loading="submitting"
            :disabled="!fileName || !dateCol || !valueCol"
            @click="submit"
          />
          <UButton
            v-if="submitting"
            icon="i-lucide-x"
            :label="t('ml.forecast.cancel')"
            color="error"
            variant="subtle"
            @click="cancel"
          />
        </div>
      </div>
    </UCard>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <UCard v-if="submitting">
      <div class="space-y-2">
        <div class="flex justify-between text-sm">
          <span class="text-muted">{{ message }}</span>
          <span class="tabular-nums">{{ progress }}%</span>
        </div>
        <UProgress :model-value="progress" size="sm" />
      </div>
    </UCard>

    <template v-if="report && chart">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-chart-line" class="size-4" />
            {{ t('ml.forecast.chart') }}
          </div>
        </template>
        <svg :viewBox="`0 0 ${chart.W} ${chart.H}`" class="w-full" preserveAspectRatio="none">
          <!-- 置信区间 -->
          <polygon :points="chart.band" fill="rgba(0,220,130,0.12)" stroke="none" />
          <!-- 历史线 -->
          <polyline :points="chart.histLine" fill="none" stroke="#3B82F6" stroke-width="2" />
          <!-- 预测线 -->
          <polyline :points="chart.fcLine" fill="none" stroke="#00DC82" stroke-width="2.5" stroke-dasharray="6 3" />
          <!-- 分界线 -->
          <line
            :x1="chart.splitX" :y1="chart.PAD" :x2="chart.splitX" :y2="chart.H - chart.PAD"
            stroke="rgba(128,128,128,0.5)" stroke-dasharray="4 4"
          />
        </svg>
        <p class="mt-2 text-xs text-muted text-center">
          {{ t('ml.forecast.legend') }}
        </p>
      </UCard>

      <UCard>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.forecast.horizon') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.horizon }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">MAE</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.metrics.mae }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">MAPE</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.metrics.mape }}%</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.forecast.samples') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.dates.length }}</p>
          </div>
        </div>
      </UCard>
    </template>
  </MediaDemoShell>
</template>
