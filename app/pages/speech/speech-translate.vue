<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'speech-translate')!)

const loading = ref(false)
const error = ref<string | null>(null)
const cloudUnavailable = isRemoteDeploy()
const fileData = ref<File | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const translation = ref('')
const language = ref('')

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files[0]) {
    fileData.value = input.files[0]
    error.value = null
    translation.value = ''
    language.value = ''
  }
}

async function run() {
  if (!fileData.value) {
    error.value = t('translate.upload')
    return
  }
  error.value = null
  translation.value = ''
  loading.value = true
  progress.value = 0
  progressText.value = t('translate.processing')
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/speech-translate', {
      method: 'POST',
      body: formData
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('demo.backendUnavailable')
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
    const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/speech/speech-translate/${id}`, {
      method: 'GET'
    }).catch(() => null)
    if (!res?.ok || !res.task) {
      error.value = res?.error || t('demo.backendUnavailable')
      return
    }
    const task = res.task
    progress.value = task.progress || 0
    progressText.value = task.message || ''
    if (task.status === 'done') {
      translation.value = task.translation || ''
      language.value = task.language || ''
      return
    }
    if (task.status === 'error') {
      error.value = task.error || task.message || 'error'
      return
    }
    if (task.status === 'cancelled') {
      error.value = t('translate.cancelled')
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/speech-translate/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

function copyText() {
  if (!translation.value) return
  navigator.clipboard.writeText(translation.value).catch(() => {})
}
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="cloudUnavailable ? t('translate.cloudUnavailable') : null"
      >
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('translate.uploadHint') }}</p>
          <div>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
              class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
              @change="onFileChange"
            />
          </div>
        </template>

        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('translate.run')"
            color="primary"
            :loading="loading"
            :disabled="!fileData || cloudUnavailable"
            @click="run"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('translate.cancel')"
            color="neutral"
            variant="subtle"
            @click="cancel"
          />
        </template>

        <template #result>
          <div v-if="loading" class="space-y-3">
            <div class="flex items-center justify-between text-sm text-muted">
              <span>{{ progressText }}</span>
              <span class="tabular-nums">{{ progress }}%</span>
            </div>
            <div class="h-2 w-full bg-default rounded-full overflow-hidden">
              <div class="h-full bg-primary transition-all" :style="{ width: progress + '%' }" />
            </div>
          </div>

          <div v-else-if="translation" class="space-y-3">
            <p v-if="language" class="text-xs text-muted">{{ t('translate.detected') }}: {{ language }}</p>
            <p class="text-base text-highlighted whitespace-pre-wrap break-words leading-relaxed">{{ translation }}</p>
            <UButton icon="i-lucide-copy" :label="t('translate.copy')" size="sm" variant="outline" @click="copyText" />
          </div>
          <div v-else class="text-sm text-muted">{{ t('translate.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
