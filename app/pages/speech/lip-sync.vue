<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'lip-sync')!)

const loading = ref(false)
const error = ref<string | null>(null)
const cloudUnavailable = isRemoteDeploy()
const videoFile = ref<File | null>(null)
const audioFile = ref<File | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const resultUrl = ref('')
const videoInput = ref<HTMLInputElement>()
const audioInput = ref<HTMLInputElement>()

function onVideo(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    videoFile.value = input.files[0]
    error.value = null
    resultUrl.value = ''
  }
}
function onAudio(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    audioFile.value = input.files[0]
    error.value = null
    resultUrl.value = ''
  }
}

async function run() {
  if (!videoFile.value || !audioFile.value) {
    error.value = t('lipSync.upload')
    return
  }
  error.value = null
  resultUrl.value = ''
  loading.value = true
  progress.value = 0
  progressText.value = t('lipSync.processing')
  try {
    const formData = new FormData()
    formData.append('video', videoFile.value)
    formData.append('audio', audioFile.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/lip-sync', {
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
    const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/speech/lip-sync/${id}`, {
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
      resultUrl.value = task.videoUrl || ''
      return
    }
    if (task.status === 'error') {
      error.value = task.error || task.message || 'error'
      return
    }
    if (task.status === 'cancelled') {
      error.value = t('lipSync.cancelled')
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/lip-sync/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="cloudUnavailable ? t('lipSync.cloudUnavailable') : null"
      >
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('lipSync.uploadHint') }}</p>
          <div class="space-y-3">
            <div>
              <label class="text-sm font-medium text-muted mb-1 block">{{ t('lipSync.video') }}</label>
              <input
                type="file"
                accept="video/*,.mp4,.webm,.mov"
                class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
                @change="onVideo"
              />
            </div>
            <div>
              <label class="text-sm font-medium text-muted mb-1 block">{{ t('lipSync.audio') }}</label>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
                class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
                @change="onAudio"
              />
            </div>
          </div>
        </template>

        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('lipSync.run')"
            color="primary"
            :loading="loading"
            :disabled="!videoFile || !audioFile || cloudUnavailable"
            @click="run"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('lipSync.cancel')"
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

          <div v-else-if="resultUrl" class="space-y-3">
            <p class="text-sm font-medium text-highlighted">{{ t('lipSync.result') }}</p>
            <video :src="resultUrl" controls class="w-full max-w-md rounded-lg border border-default" />
            <UButton
              icon="i-lucide-download"
              :label="t('lipSync.download')"
              size="sm"
              variant="outline"
              tag="a"
              :href="resultUrl"
              download
            />
          </div>
          <div v-else class="text-sm text-muted">{{ t('lipSync.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
