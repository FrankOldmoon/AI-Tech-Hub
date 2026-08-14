<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'
import { humanError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'vad')!)

const loading = ref(false)
const error = ref<string | null>(null)
const cloudUnavailable = isRemoteDeploy()
const fileName = ref('')
const fileData = ref<File | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const audioUrl = ref('')
const segments = ref<Array<{ start: number, end: number }>>([])
const speechSeconds = ref(0)
const totalSeconds = ref(0)

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files[0]) {
    fileData.value = input.files[0]
    fileName.value = input.files[0].name
    error.value = null
    segments.value = []
    if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
    audioUrl.value = URL.createObjectURL(input.files[0])
  }
}

const { poll } = useTaskPoller({
  interval: 2000,
  progress,
  progressText,
  error,
  failMessage: t('demo.backendUnavailable'),
  cancelledMessage: t('vad.cancelled'),
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => {
    segments.value = task.segments || []
    speechSeconds.value = task.speechSeconds || 0
    totalSeconds.value = task.totalSeconds || 0
  }
})

async function detect() {
  if (loading.value) return
  if (!fileData.value) {
    error.value = t('vad.upload')
    return
  }
  error.value = null
  segments.value = []
  loading.value = true
  progress.value = 0
  progressText.value = t('vad.processing')
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/vad', {
      method: 'POST',
      body: formData
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('demo.backendUnavailable')
      return
    }
    taskId.value = res.taskId
    await poll(`/api/speech/vad/${res.taskId}`)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/vad/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

onBeforeUnmount(() => {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="cloudUnavailable ? t('vad.cloudUnavailable') : null"
      >
        <!-- 输入 -->
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('vad.uploadHint') }}</p>
          <div>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
              class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
              @change="onFileChange"
            />
          </div>
          <audio v-if="audioUrl" :src="audioUrl" controls class="mt-4 w-full max-w-md" />
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('vad.run')"
            color="primary"
            :loading="loading"
            :disabled="!fileData || cloudUnavailable"
            @click="detect"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('vad.cancel')"
            color="neutral"
            variant="subtle"
            @click="cancel"
          />
        </template>

        <!-- 结果 -->
        <template #result>
          <!-- 进度 -->
          <div v-if="loading" class="space-y-3">
            <div class="flex items-center justify-between text-sm text-muted">
              <span>{{ progressText }}</span>
              <span class="tabular-nums">{{ progress }}%</span>
            </div>
            <div class="h-2 w-full bg-default rounded-full overflow-hidden">
              <div class="h-full bg-primary transition-all" :style="{ width: progress + '%' }" />
            </div>
          </div>

          <!-- 结果 -->
          <div v-else-if="segments.length" class="space-y-4">
            <!-- 统计 -->
            <div class="flex flex-wrap gap-4 text-sm">
              <span class="text-muted">{{ t('vad.segmentsCount') }}: <b class="text-highlighted">{{ segments.length }}</b></span>
              <span class="text-muted">{{ t('vad.speechTime') }}: <b class="text-highlighted">{{ fmt(speechSeconds) }}</b></span>
              <span class="text-muted">{{ t('vad.totalTime') }}: <b class="text-highlighted">{{ fmt(totalSeconds) }}</b></span>
            </div>

            <!-- 时间轴 -->
            <div class="relative h-10 bg-default/40 rounded-lg overflow-hidden">
              <div
                v-for="(s, i) in segments"
                :key="i"
                class="absolute top-1 bottom-1 bg-primary/70 rounded"
                :style="{
                  left: (s.start / totalSeconds) * 100 + '%',
                  width: Math.max(((s.end - s.start) / totalSeconds) * 100, 1) + '%'
                }"
                :title="`${fmt(s.start)} - ${fmt(s.end)}`"
              />
            </div>

            <!-- 列表 -->
            <div class="grid sm:grid-cols-2 gap-2">
              <div
                v-for="(s, i) in segments"
                :key="i"
                class="flex items-center gap-2 text-xs text-muted border border-default rounded-lg px-3 py-2"
              >
                <UIcon name="i-lucide-mic" class="size-3 text-primary" />
                <span class="tabular-nums">#{{ i + 1 }}</span>
                <span class="tabular-nums">{{ fmt(s.start) }} → {{ fmt(s.end) }}</span>
                <span class="ms-auto tabular-nums">{{ ((s.end - s.start)).toFixed(1) }}s</span>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-muted">{{ t('vad.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
