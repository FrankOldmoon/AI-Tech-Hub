<script setup lang="ts">
import { fetchSample } from '~/utils/samples'

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
// 在线录音
const recording = ref(false)
const recordSeconds = ref(0)
let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null

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

async function useSample() {
  try {
    const f = await fetchSample('/samples/audio/speech.wav')
    refFile.value = f
    if (refUrl.value) URL.revokeObjectURL(refUrl.value)
    refUrl.value = URL.createObjectURL(f)
    error.value = null
    resultUrl.value = ''
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
  }
}

async function startRecording() {
  if (recording.value) return
  error.value = null
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(recordStream)
    recordChunks = []
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size) recordChunks.push(e.data)
    }
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
      const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })
      refFile.value = file
      if (refUrl.value) URL.revokeObjectURL(refUrl.value)
      refUrl.value = URL.createObjectURL(blob)
      resultUrl.value = ''
      recordSeconds.value = 0
    }
    mediaRecorder.start()
    recording.value = true
    recordTimer = window.setInterval(() => {
      recordSeconds.value++
    }, 1000)
  } catch (e: any) {
    error.value = e?.message || '无法访问麦克风，请检查权限'
  }
}

function stopRecording() {
  mediaRecorder?.stop()
  recordStream?.getTracks().forEach((t) => t.stop())
  recordStream = null
  mediaRecorder = null
  recording.value = false
  if (recordTimer !== null) {
    clearInterval(recordTimer)
    recordTimer = null
  }
}

const { poll, stop: stopPolling } = useTaskPoller({
  progress,
  progressText,
  error,
  errorMessage: '合成失败',
  cancelledMessage: '已取消',
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => { if (task.audioUrl) resultUrl.value = task.audioUrl },
  onError: task => task.message || task.error
})

async function synthesize() {
  if (loading.value) return
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
    await poll(`/api/speech/voice-clone/${res.taskId}`)
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
  stopRecording()
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
            :label="t('voiceClone.uploadAudio')"
            color="primary"
            variant="subtle"
            @click="fileInput?.click()"
          />
          <UButton
            icon="i-lucide-flask-conical"
            :label="t('samples.trySample')"
            color="neutral"
            variant="soft"
            @click="useSample"
          />
          <UButton
            v-if="!recording"
            icon="i-lucide-mic"
            :label="t('voiceClone.recordStart')"
            color="secondary"
            variant="subtle"
            @click="startRecording"
          />
          <UButton
            v-else
            icon="i-lucide-square"
            :label="t('voiceClone.recordStop')"
            color="error"
            @click="stopRecording"
          />
          <span v-if="recording" class="flex items-center gap-1.5 text-sm text-error">
            <span class="size-2 rounded-full bg-error animate-pulse" />
            {{ recordSeconds }}s
          </span>
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
