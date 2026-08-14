<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'photo-restore')!)

const inputFile = ref<File | null>(null)
const previewUrl = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const resultUrl = ref('')
const fileInput = ref<HTMLInputElement>()

const fidelity = ref(0.5)
const upscale = ref(2)

const upscaleItems = [
  { label: '1 ×（不放大）', value: 1 },
  { label: '2 ×', value: 2 }
]

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  inputFile.value = file
  error.value = null
  resultUrl.value = ''
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(file)
  input.value = ''
}

const { poll, stop: stopPolling } = useTaskPoller({
  progress,
  progressText,
  error,
  timeoutMessage: t('demo.taskTimeout'),
  failMessage: t('demo.taskQueryFailed'),
  errorMessage: t('demo.processFailed'),
  cancelledMessage: t('demo.cancelled'),
  onDone: (task) => { if (task.resultUrl) resultUrl.value = task.resultUrl }
})

async function run() {
  if (loading.value) return
  if (!inputFile.value) { error.value = t('demo.inputRequired'); return }
  error.value = null
  resultUrl.value = ''
  loading.value = true
  progress.value = 0
  try {
    const formData = new FormData()
    formData.append('file', inputFile.value)
    formData.append('fidelity', String(fidelity.value))
    formData.append('upscale', String(upscale.value))
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/aigc/photo-restore', { method: 'POST', body: formData })
    if (!res.ok || !res.taskId) { error.value = res.error || t('demo.submitFailed'); return }
    taskId.value = res.taskId
    await poll(`/api/aigc/photo-restore/${res.taskId}`)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  stopPolling()
  loading.value = false
  try { await $fetch(`/api/aigc/photo-restore/${taskId.value}`, { method: 'DELETE' }) } catch { /* ignore */ }
  taskId.value = null
  error.value = t('demo.cancelled')
}

onBeforeUnmount(() => {
  try { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value) } catch { /* ignore */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert color="info" variant="subtle" icon="i-lucide-info" :title="t('photoRestore.modelHelp')" />

    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-keyboard" class="size-4" />
          {{ t('demo.input') }}
        </div>
      </template>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <UButton icon="i-lucide-upload" :label="t('mp.upload')" color="primary" variant="subtle" :disabled="loading" @click="fileInput?.click()" />
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
          <span v-if="inputFile" class="text-sm text-muted truncate">{{ inputFile.name }}</span>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <label class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('photoRestore.fidelity') }}: {{ fidelity.toFixed(2) }}</span>
            <input v-model.number="fidelity" type="range" min="0" max="1" step="0.05" class="w-full" :disabled="loading">
            <p class="text-xs text-muted mt-1">{{ t('photoRestore.fidelityHelp') }}</p>
          </label>
          <label class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('photoRestore.upscale') }}</span>
            <USelect v-model="upscale" :items="upscaleItems" :disabled="loading" class="w-full" />
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <UButton
            icon="i-lucide-play"
            :label="t('photoRestore.run')"
            color="primary"
            :loading="loading"
            :disabled="loading || !inputFile"
            @click="run"
          />
          <UButton v-if="loading && taskId" icon="i-lucide-x" :label="t('voiceClone.cancel')" color="error" variant="subtle" @click="cancel" />
        </div>
      </div>
    </UCard>

    <div v-if="loading" class="space-y-2">
      <UProgress :model-value="progress" />
      <p class="text-xs text-muted">{{ progressText }}</p>
    </div>

    <div v-if="previewUrl" class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('photoRestore.before') }}</label>
        <div class="aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default">
          <img :src="previewUrl" class="w-full h-full object-contain">
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('photoRestore.after') }}</label>
        <div class="aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default flex items-center justify-center">
          <img v-if="resultUrl" :src="resultUrl" class="w-full h-full object-contain">
          <UIcon v-else name="i-lucide-images" class="size-8 text-muted" />
        </div>
        <a v-if="resultUrl" :href="resultUrl" target="_blank" download class="inline-block mt-2 text-sm text-primary underline">
          {{ t('photoRestore.download') }}
        </a>
      </div>
    </div>
  </MediaDemoShell>
</template>
