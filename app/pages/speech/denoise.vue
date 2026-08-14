<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'
import { fetchSample } from '~/utils/samples'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'denoise')!)

const loading = ref(false)
const error = ref<string | null>(null)
// 云端（Vercel）无 Python 环境：直接提示
const cloudUnavailable = isRemoteDeploy()
const fileName = ref('')
const fileData = ref<File | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const originalUrl = ref('')
const resultUrl = ref('')

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files[0]) {
    fileData.value = input.files[0]
    fileName.value = input.files[0].name
    error.value = null
    resultUrl.value = ''
    if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
    originalUrl.value = URL.createObjectURL(input.files[0])
  }
}

async function useSample() {
  try {
    const f = await fetchSample('/samples/audio/noisy-speech.wav')
    fileData.value = f
    fileName.value = f.name
    error.value = null
    resultUrl.value = ''
    if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
    originalUrl.value = URL.createObjectURL(f)
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
  }
}

const { poll } = useTaskPoller({
  interval: 2000,
  progress,
  progressText,
  error,
  failMessage: t('demo.backendUnavailable'),
  cancelledMessage: t('denoise.cancelled'),
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => { resultUrl.value = task.audioUrl || '' }
})

async function denoise() {
  if (loading.value) return
  if (!fileData.value) {
    error.value = t('denoise.upload')
    return
  }
  error.value = null
  resultUrl.value = ''
  loading.value = true
  progress.value = 0
  progressText.value = t('denoise.processing')
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/denoise', {
      method: 'POST',
      body: formData
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('demo.backendUnavailable')
      return
    }
    taskId.value = res.taskId
    await poll(`/api/speech/denoise/${res.taskId}`)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/denoise/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

onBeforeUnmount(() => {
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
})
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="cloudUnavailable ? t('denoise.cloudUnavailable') : null"
      >
        <!-- 输入 -->
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('denoise.uploadHint') }}</p>
          <div>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
              class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
              @change="onFileChange"
            />
            <div class="mt-3">
              <UButton
                icon="i-lucide-flask-conical"
                :label="t('samples.trySample')"
                color="neutral"
                variant="soft"
                size="sm"
                :disabled="loading"
                @click="useSample"
              />
            </div>
          </div>
          <audio v-if="originalUrl" :src="originalUrl" controls class="mt-4 w-full max-w-md" />
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('denoise.run')"
            color="primary"
            :loading="loading"
            :disabled="!fileData || cloudUnavailable"
            @click="denoise"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('denoise.cancel')"
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
          <div v-else-if="resultUrl" class="space-y-4">
            <p class="text-sm font-medium text-highlighted">{{ t('denoise.result') }}</p>
            <div class="grid sm:grid-cols-2 gap-4">
              <div class="space-y-2">
                <p class="text-xs text-muted">{{ t('denoise.original') }}</p>
                <audio v-if="originalUrl" :src="originalUrl" controls class="w-full" />
              </div>
              <div class="space-y-2">
                <p class="text-xs text-muted">{{ t('denoise.enhanced') }}</p>
                <audio :src="resultUrl" controls class="w-full" />
              </div>
            </div>
            <UButton
              icon="i-lucide-download"
              :label="t('denoise.download')"
              size="sm"
              variant="outline"
              :to="resultUrl"
              target="_blank"
            />
          </div>
          <div v-else class="text-sm text-muted">{{ t('denoise.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
