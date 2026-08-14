<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'
import { validateUpload } from '~/utils/upload'
import { humanError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'meeting')!)

const loading = ref(false)
const error = ref<string | null>(null)
const cloudUnavailable = isRemoteDeploy()
const fileData = ref<File | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const segments = ref<Array<{ start: number, end: number, speaker: string, text: string }>>([])
const fullText = ref('')
const resultUrl = ref('')

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  const uploadErr = validateUpload(f, 'audio', t)
  if (uploadErr) {
    error.value = uploadErr
    input.value = ''
    return
  }
  fileData.value = f
  error.value = null
  segments.value = []
  fullText.value = ''
  resultUrl.value = ''
}

const { poll } = useTaskPoller({
  interval: 2000,
  progress,
  progressText,
  error,
  failMessage: t('demo.backendUnavailable'),
  cancelledMessage: t('meeting.cancelled'),
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => {
    segments.value = task.segments || []
    fullText.value = task.text || ''
    resultUrl.value = task.resultUrl || ''
  }
})

async function run() {
  if (loading.value) return
  if (!fileData.value) {
    error.value = t('meeting.upload')
    return
  }
  error.value = null
  segments.value = []
  loading.value = true
  progress.value = 0
  progressText.value = t('meeting.processing')
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/meeting', {
      method: 'POST',
      body: formData
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('demo.backendUnavailable')
      return
    }
    taskId.value = res.taskId
    await poll(`/api/speech/meeting/${res.taskId}`)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/meeting/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

function exportTxt() {
  if (!fullText.value) return
  const blob = new Blob([fullText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'meeting-notes.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="cloudUnavailable ? t('meeting.cloudUnavailable') : null"
      >
        <template #input>
          <p class="text-sm text-muted mb-4">
            {{ t('meeting.uploadHint') }}
          </p>
          <div>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
              class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
              @change="onFileChange"
            >
          </div>
        </template>

        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('meeting.run')"
            color="primary"
            :loading="loading"
            :disabled="!fileData || cloudUnavailable"
            @click="run"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('meeting.cancel')"
            color="neutral"
            variant="subtle"
            @click="cancel"
          />
        </template>

        <template #result>
          <div
            v-if="loading"
            class="space-y-3"
          >
            <div class="flex items-center justify-between text-sm text-muted">
              <span>{{ progressText }}</span>
              <span class="tabular-nums">{{ progress }}%</span>
            </div>
            <div class="h-2 w-full bg-default rounded-full overflow-hidden">
              <div
                class="h-full bg-primary transition-all"
                :style="{ width: progress + '%' }"
              />
            </div>
          </div>

          <div
            v-else-if="segments.length"
            class="space-y-4"
          >
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-lucide-file-text"
                :label="t('meeting.exportTxt')"
                size="sm"
                variant="outline"
                @click="exportTxt"
              />
              <UButton
                v-if="resultUrl"
                icon="i-lucide-download"
                :label="t('meeting.downloadJson')"
                size="sm"
                variant="outline"
                tag="a"
                :href="resultUrl"
                download
              />
            </div>
            <div class="space-y-2">
              <div
                v-for="(s, i) in segments"
                :key="i"
                class="border border-default rounded-lg p-3"
              >
                <div class="flex items-center gap-2 text-xs text-muted mb-1">
                  <span class="font-mono text-primary">{{ s.speaker }}</span>
                  <span class="tabular-nums">{{ fmt(s.start) }} → {{ fmt(s.end) }}</span>
                </div>
                <p class="text-sm text-highlighted">
                  {{ s.text }}
                </p>
              </div>
            </div>
          </div>
          <div
            v-else
            class="text-sm text-muted"
          >
            {{ t('meeting.noResult') }}
          </div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
