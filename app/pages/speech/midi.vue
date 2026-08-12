<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'midi')!)

const loading = ref(false)
const error = ref<string | null>(null)
const cloudUnavailable = isRemoteDeploy()
const fileData = ref<File | null>(null)
const instrument = ref('piano')
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const midiUrl = ref('')

const instruments = [
  { label: '钢琴 Piano', value: 'piano' },
  { label: '吉他 Guitar', value: 'guitar' },
  { label: '贝斯 Bass', value: 'bass' },
  { label: '萨克斯 Saxophone', value: 'saxophone' }
]

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files[0]) {
    fileData.value = input.files[0]
    error.value = null
    midiUrl.value = ''
  }
}

async function run() {
  if (!fileData.value) {
    error.value = t('midi.upload')
    return
  }
  error.value = null
  midiUrl.value = ''
  loading.value = true
  progress.value = 0
  progressText.value = t('midi.processing')
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    formData.append('instrument', instrument.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/midi', {
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
    const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/speech/midi/${id}`, {
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
      midiUrl.value = task.midiUrl || ''
      return
    }
    if (task.status === 'error') {
      error.value = task.error || task.message || 'error'
      return
    }
    if (task.status === 'cancelled') {
      error.value = t('midi.cancelled')
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/midi/${taskId.value}`, { method: 'DELETE' })
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
        :notice="cloudUnavailable ? t('midi.cloudUnavailable') : null"
      >
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('midi.uploadHint') }}</p>
          <div class="space-y-4">
            <div>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
                class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
                @change="onFileChange"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-muted mb-1">{{ t('midi.instrument') }}</label>
              <USelect v-model="instrument" :items="instruments" class="w-full max-w-xs" />
            </div>
          </div>
        </template>

        <template #controls>
          <UButton
            icon="i-lucide-music"
            :label="t('midi.run')"
            color="primary"
            :loading="loading"
            :disabled="!fileData || cloudUnavailable"
            @click="run"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('midi.cancel')"
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

          <div v-else-if="midiUrl" class="space-y-3">
            <p class="text-sm font-medium text-highlighted">{{ t('midi.result') }}</p>
            <UButton
              icon="i-lucide-download"
              :label="t('midi.download')"
              size="sm"
              variant="outline"
              tag="a"
              :href="midiUrl"
              download
            />
          </div>
          <div v-else class="text-sm text-muted">{{ t('midi.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
