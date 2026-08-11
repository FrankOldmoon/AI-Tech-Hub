<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'voice-clone')!)

const loading = ref(false)
const error = ref<string | null>(null)
const refFile = ref<File | null>(null)
const refUrl = ref('')
const fileInput = ref<HTMLInputElement>()
const text = ref('')
const lang = ref('zh-cn')
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const resultUrl = ref('')

const langItems = [
  { label: '中文 (zh-cn)', value: 'zh-cn' },
  { label: 'English (en)', value: 'en' },
  { label: '日本語 (ja)', value: 'ja' },
  { label: '한국어 (ko)', value: 'ko' },
  { label: 'Español (es)', value: 'es' },
  { label: 'Français (fr)', value: 'fr' },
  { label: 'Deutsch (de)', value: 'de' },
  { label: 'Русский (ru)', value: 'ru' },
]

function onRefChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  refFile.value = file
  if (refUrl.value) URL.revokeObjectURL(refUrl.value)
  refUrl.value = URL.createObjectURL(file)
  error.value = null
  resultUrl.value = ''
}

async function synthesize() {
  if (!refFile.value) {
    error.value = t('voiceClone.uploadRef')
    return
  }
  if (!text.value.trim()) {
    error.value = t('voiceClone.textRequired')
    return
  }
  error.value = null
  resultUrl.value = ''
  loading.value = true
  progress.value = 0
  progressText.value = t('voiceClone.processing')
  try {
    const formData = new FormData()
    formData.append('ref', refFile.value)
    formData.append('text', text.value)
    formData.append('lang', lang.value)

    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/voice-clone', {
      method: 'POST',
      body: formData
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || '提交失败'
      return
    }
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
    const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/speech/voice-clone/${id}`, {
      method: 'GET'
    }).catch(() => null)
    if (!res?.ok || !res.task) {
      error.value = res?.error || '任务查询失败'
      return
    }
    const task = res.task
    progress.value = task.progress || 0
    progressText.value = task.message || ''
    if (task.status === 'done' && task.audioUrl) {
      resultUrl.value = task.audioUrl
      return
    }
    if (task.status === 'error') {
      error.value = task.message || task.error || '合成失败'
      return
    }
    if (task.status === 'cancelled') {
      error.value = task.message || '已取消'
      return
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

async function cancel() {
  if (!taskId.value) return
  loading.value = false
  try {
    await $fetch(`/api/speech/voice-clone/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
  taskId.value = null
  progress.value = 0
  progressText.value = ''
  error.value = t('voiceClone.cancelled')
}

onBeforeUnmount(() => {
  taskId.value = null
  if (refUrl.value) URL.revokeObjectURL(refUrl.value)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <!-- 1. 参考音频 -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-mic-vocal" class="size-4 text-primary" />
          {{ t('voiceClone.uploadRef') }}
        </div>
      </template>
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            icon="i-lucide-upload"
            :label="t('mp.upload')"
            color="primary"
            variant="subtle"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept="audio/*" class="hidden" @change="onRefChange">
          <span class="text-sm text-muted">{{ t('voiceClone.uploadRefHint') }}</span>
        </div>
        <audio v-if="refUrl" :src="refUrl" controls class="w-full max-w-md" />
      </div>
    </UCard>

    <!-- 2. 文本 + 语言 -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-type" class="size-4 text-primary" />
          {{ t('voiceClone.text') }}
        </div>
      </template>
      <div class="space-y-4">
        <UTextarea
          v-model="text"
          :rows="3"
          :placeholder="t('voiceClone.textPlaceholder')"
          class="w-full"
        />
        <div class="flex items-center gap-3">
          <label class="text-sm text-muted">{{ t('voiceClone.lang') }}</label>
          <USelect v-model="lang" :items="langItems" class="w-48" />
        </div>
      </div>
    </UCard>

    <!-- 3. 操作 + 进度 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        icon="i-lucide-clapperboard"
        :label="t('voiceClone.synthesize')"
        color="primary"
        :loading="loading"
        :disabled="!refFile || !text.trim()"
        @click="synthesize"
      />
      <UButton
        v-if="loading && taskId"
        icon="i-lucide-x"
        :label="t('voiceClone.cancel')"
        color="error"
        variant="subtle"
        @click="cancel"
      />
    </div>
    <div v-if="loading" class="space-y-2">
      <UProgress :model-value="progress" />
      <p class="text-xs text-muted">{{ progressText }}</p>
    </div>

    <!-- 4. 结果 -->
    <UCard v-if="resultUrl">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-terminal" class="size-4" />
          {{ t('voiceClone.result') }}
        </div>
      </template>
      <div class="flex flex-wrap items-center gap-4">
        <audio :src="resultUrl" controls class="flex-1 min-w-64" />
        <UButton
          icon="i-lucide-download"
          :label="t('voiceClone.download')"
          color="neutral"
          variant="subtle"
          :to="resultUrl"
          target="_blank"
          download
        />
      </div>
    </UCard>
  </MediaDemoShell>
</template>
