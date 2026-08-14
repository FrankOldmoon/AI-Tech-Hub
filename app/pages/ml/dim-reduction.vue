import { humanError } from '~/utils/errors'
<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'dim-reduction')!)

const fileInput = ref<HTMLInputElement>()
const fileName = ref('')
const method = ref('pca')
const clusters = ref(3)
const submitting = ref(false)
const error = ref<string | null>(null)
const taskId = ref('')
const progress = ref(0)
const message = ref('')
const report = ref<any>(null)

const methodOptions = computed(() => [
  { label: 'PCA', value: 'pca' },
  { label: 't-SNE', value: 'tsne' }
])

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  error.value = null
  report.value = null
}

const { poll, stop: stopPolling } = useTaskPoller({
  interval: 1800,
  progress,
  progressText: message,
  error,
  timeoutMessage: t('demo.taskTimeout'),
  failMessage: t('ml.dimReduction.error'),
  errorMessage: t('ml.dimReduction.error'),
  onCancelled: () => t('ml.dimReduction.cancelled'),
  onDone: async (task) => {
    if (task.reportUrl) report.value = await $fetch(task.reportUrl)
  }
})

async function submit() {
  const file = fileInput.value?.files?.[0]
  if (!file) { error.value = t('ml.dimReduction.noFile'); return }
  error.value = null
  report.value = null
  submitting.value = true
  const form = new FormData()
  form.append('file', file)
  form.append('method', method.value)
  form.append('clusters', String(clusters.value))
  try {
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/ml/dim-reduction', {
      method: 'POST',
      body: form
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('ml.dimReduction.error')
      submitting.value = false
      return
    }
    taskId.value = res.taskId
    await poll(`/api/ml/dim-reduction/${res.taskId}`)
    submitting.value = false
  } catch (e: any) {
    error.value = humanError(e, t)
    submitting.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  try { await $fetch(`/api/ml/dim-reduction/${taskId.value}`, { method: 'DELETE' }) } catch { /* ignore */ }
  stopPolling()
  submitting.value = false
}

const SIZE = 400
const COLORS = ['#3B82F6', '#F97316', '#22C55E', '#EAB308', '#A855F7', '#EC4899', '#14B8A6', '#F43F5E']

function drawReport() {
  const canvas = document.getElementById('dim-canvas') as HTMLCanvasElement | null
  const r = report.value
  if (!canvas || !r) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // 归一化坐标
  const xs = r.points.map((p: number[]) => p[0])
  const ys = r.points.map((p: number[]) => p[1])
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const sx = (v: number) => ((v - minX) / (maxX - minX || 1)) * (SIZE - 20) + 10
  const sy = (v: number) => SIZE - 10 - ((v - minY) / (maxY - minY || 1)) * (SIZE - 20)
  for (let i = 0; i < r.points.length; i++) {
    ctx.beginPath()
    ctx.arc(sx(r.points[i][0]), sy(r.points[i][1]), 4, 0, Math.PI * 2)
    ctx.fillStyle = COLORS[r.labels[i] % COLORS.length]
    ctx.fill()
  }
}

watch(report, () => {
  if (report.value) nextTick(drawReport)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UCard>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-upload"
            :label="fileName || t('ml.dimReduction.upload')"
            color="primary"
            variant="subtle"
            :disabled="submitting"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange">
          <p class="text-sm text-muted">{{ t('ml.dimReduction.uploadHint') }}</p>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.dimReduction.method') }}</p>
            <USelect v-model="method" :items="methodOptions" class="w-full" :disabled="submitting" />
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ t('ml.dimReduction.clusters') }}: {{ clusters }}</p>
            <USlider v-model="clusters" :min="2" :max="8" :step="1" :disabled="submitting" />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-scatter-chart"
            :label="t('ml.dimReduction.run')"
            color="primary"
            :loading="submitting"
            :disabled="!fileName"
            @click="submit"
          />
          <UButton
            v-if="submitting"
            icon="i-lucide-x"
            :label="t('ml.dimReduction.cancel')"
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
          id="dim-canvas"
          :width="SIZE"
          :height="SIZE"
          class="rounded-xl border border-default bg-elevated/40 max-w-full"
        />
        <UCard>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-xs text-muted">{{ t('ml.dimReduction.method') }}</p>
              <p class="text-lg font-bold text-highlighted uppercase">{{ report.method }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.dimReduction.samples') }}</p>
              <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.samples }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.dimReduction.features') }}</p>
              <p class="text-lg font-bold text-highlighted tabular-nums">{{ report.features }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.dimReduction.variance') }}</p>
              <p v-if="report.variance?.length" class="text-lg font-bold text-highlighted tabular-nums">
                {{ (report.variance[0] * 100).toFixed(1) }}% / {{ (report.variance[1] * 100).toFixed(1) }}%
              </p>
              <p v-else class="text-lg text-muted">-</p>
            </div>
          </div>
          <p class="mt-4 text-sm text-muted">{{ t('ml.dimReduction.legend') }}</p>
        </UCard>
      </div>
    </template>
  </MediaDemoShell>
</template>
