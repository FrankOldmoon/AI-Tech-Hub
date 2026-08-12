<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'anomaly')!)

const fileInput = ref<HTMLInputElement>()
const fileName = ref('')
const columns = ref<string[]>([])
const xCol = ref('')
const yCol = ref('')
const contamination = ref(0.1)
const submitting = ref(false)
const error = ref<string | null>(null)
const taskId = ref('')
const progress = ref(0)
const message = ref('')
const report = ref<any>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

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
      xCol.value = columns.value[0]
      yCol.value = columns.value[1]
    }
  }
  reader.readAsText(file.slice(0, 65536))
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function submit() {
  const file = fileInput.value?.files?.[0]
  if (!file) { error.value = t('ml.anomaly.noFile'); return }
  if (!xCol.value || !yCol.value) { error.value = t('ml.anomaly.noColumns'); return }
  error.value = null
  report.value = null
  submitting.value = true
  const form = new FormData()
  form.append('file', file)
  form.append('xCol', xCol.value)
  form.append('yCol', yCol.value)
  form.append('contamination', String(contamination.value))
  try {
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/ml/anomaly', {
      method: 'POST',
      body: form
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('ml.anomaly.error')
      submitting.value = false
      return
    }
    taskId.value = res.taskId
    poll()
  } catch (e: any) {
    error.value = e?.message || String(e)
    submitting.value = false
  }
}

function poll() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/ml/anomaly/${taskId.value}`)
      if (!res.ok || !res.task) {
        error.value = res.error || t('ml.anomaly.error')
        stopPolling(); submitting.value = false
        return
      }
      const td = res.task
      progress.value = td.progress
      message.value = td.message
      if (td.status === 'done') {
        stopPolling(); submitting.value = false
        if (td.reportUrl) report.value = await $fetch(td.reportUrl)
      } else if (td.status === 'error') {
        stopPolling(); submitting.value = false
        error.value = td.error || td.message
      } else if (td.status === 'cancelled') {
        stopPolling(); submitting.value = false
        error.value = t('ml.anomaly.cancelled')
      }
    } catch (e: any) {
      error.value = e?.message || String(e)
      stopPolling(); submitting.value = false
    }
  }, 1800)
}

async function cancel() {
  if (!taskId.value) return
  try { await $fetch(`/api/ml/anomaly/${taskId.value}`, { method: 'DELETE' }) } catch { /* ignore */ }
  stopPolling()
  submitting.value = false
}

const SIZE = 400

function drawReport() {
  const canvas = document.getElementById('anomaly-canvas') as HTMLCanvasElement | null
  const r = report.value
  if (!canvas || !r) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // 决策边界网格（归一化空间 -3..3）
  const cell = SIZE / 40
  for (let gy = 0; gy < 40; gy++) {
    for (let gx = 0; gx < 40; gx++) {
      const v = r.grid[gy][gx]
      ctx.fillStyle = v === -1 ? 'rgba(244,63,94,0.18)' : 'rgba(59,130,246,0.10)'
      ctx.fillRect(gx * cell, gy * cell, cell + 1, cell + 1)
    }
  }
  // 数据点：归一化坐标映射到画布
  const toPx = (v: number) => ((v - r.grid_min[0]) / (r.grid_max[0] - r.grid_min[0])) * SIZE
  for (let i = 0; i < r.points.length; i++) {
    const [px, py] = r.points[i]
    ctx.beginPath()
    ctx.arc(toPx(px), toPx(py), 4, 0, Math.PI * 2)
    ctx.fillStyle = r.labels[i] === -1 ? '#F43F5E' : '#3B82F6'
    ctx.fill()
    if (r.labels[i] === -1) {
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
}

watch(report, () => {
  if (report.value) {
    // 等待 DOM 渲染后绘制
    nextTick(drawReport)
  }
})

onBeforeUnmount(() => stopPolling())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UCard>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-upload"
            :label="fileName || t('ml.anomaly.upload')"
            color="primary"
            variant="subtle"
            :disabled="submitting"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange">
          <p class="text-sm text-muted">{{ t('ml.anomaly.uploadHint') }}</p>
        </div>

        <div class="grid sm:grid-cols-3 gap-4">
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.anomaly.xCol') }}</p>
            <USelect
              v-model="xCol"
              :items="columns.map(c => ({ label: c, value: c }))"
              class="w-full"
              :disabled="!columns.length || submitting"
            />
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.anomaly.yCol') }}</p>
            <USelect
              v-model="yCol"
              :items="columns.map(c => ({ label: c, value: c }))"
              class="w-full"
              :disabled="!columns.length || submitting"
            />
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.anomaly.contamination') }}: {{ contamination.toFixed(2) }}</p>
            <USlider v-model="contamination" :min="0.02" :max="0.5" :step="0.02" :disabled="submitting" />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-radar"
            :label="t('ml.anomaly.run')"
            color="primary"
            :loading="submitting"
            :disabled="!fileName || !xCol || !yCol"
            @click="submit"
          />
          <UButton
            v-if="submitting"
            icon="i-lucide-x"
            :label="t('ml.anomaly.cancel')"
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

    <template v-if="report">
      <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
        <canvas
          id="anomaly-canvas"
          :width="SIZE"
          :height="SIZE"
          class="rounded-xl border border-default bg-elevated/40 max-w-full"
        />
        <UCard>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <p class="text-xs text-muted">{{ t('ml.anomaly.total') }}</p>
              <p class="text-2xl font-bold tabular-nums text-highlighted">{{ report.total }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.anomaly.anomalies') }}</p>
              <p class="text-2xl font-bold tabular-nums text-error">{{ report.anomaly_count }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.anomaly.ratio') }}</p>
              <p class="text-2xl font-bold tabular-nums text-highlighted">{{ ((report.anomaly_count / report.total) * 100).toFixed(1) }}%</p>
            </div>
          </div>
          <p class="mt-4 text-sm text-muted">{{ t('ml.anomaly.legend') }}</p>
        </UCard>
      </div>
    </template>
  </MediaDemoShell>
</template>
