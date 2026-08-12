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

async function run() {
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
    if (!res.ok || !res.taskId) { error.value = res.error || '提交失败'; return }
    taskId.value = res.taskId
    await pollTask(res.taskId)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function pollTask(id: string) {
  while (true) {
    const res = await $fetch<{ ok: boolean, task?: any }>(`/api/aigc/photo-restore/${id}`, { method: 'GET' }).catch(() => null)
    if (!res?.ok || !res.task) { error.value = res?.error || '任务查询失败'; return }
    progress.value = res.task.progress || 0
    progressText.value = res.task.message || ''
    if (res.task.status === 'done' && res.task.resultUrl) { resultUrl.value = res.task.resultUrl; return }
    if (res.task.status === 'error') { error.value = res.task.message || '处理失败'; return }
    if (res.task.status === 'cancelled') { error.value = '已取消'; return }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

async function cancel() {
  if (!taskId.value) return
  loading.value = false
  try { await $fetch(`/api/aigc/photo-restore/${taskId.value}`, { method: 'DELETE' }) } catch { /* ignore */ }
  taskId.value = null
  error.value = '已取消'
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