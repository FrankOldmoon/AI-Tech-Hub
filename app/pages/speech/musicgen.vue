<script setup lang="ts">
import { isRemoteDeploy } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'musicgen')!)

const loading = ref(false)
const error = ref<string | null>(null)
const cloudUnavailable = isRemoteDeploy()
const prompt = ref('upbeat electronic dance music with catchy melody')
const duration = ref(5)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const resultUrl = ref('')

const examples = [
  { label: '电子舞曲', value: 'upbeat electronic dance music with catchy melody' },
  { label: '钢琴独奏', value: 'calm piano solo, emotional and gentle' },
  { label: '爵士', value: 'smooth jazz with saxophone and bass, relaxing' },
  { label: '史诗电影配乐', value: 'epic orchestral movie soundtrack, dramatic' },
  { label: 'Lo-Fi', value: 'lofi hip hop beats, cozy and chill' },
  { label: '雨声环境', value: 'rain sounds with soft ambient pads' }
]

async function generate() {
  if (!prompt.value.trim()) {
    error.value = t('musicgen.promptRequired')
    return
  }
  error.value = null
  resultUrl.value = ''
  loading.value = true
  progress.value = 0
  progressText.value = t('musicgen.processing')
  try {
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/musicgen', {
      method: 'POST',
      body: { prompt: prompt.value.trim(), duration: Number(duration.value) }
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
    const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/speech/musicgen/${id}`, {
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
      resultUrl.value = task.audioUrl || ''
      return
    }
    if (task.status === 'error') {
      error.value = task.error || task.message || 'error'
      return
    }
    if (task.status === 'cancelled') {
      error.value = t('musicgen.cancelled')
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function cancel() {
  if (!taskId.value) return
  try {
    await $fetch(`/api/speech/musicgen/${taskId.value}`, { method: 'DELETE' })
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
        :notice="cloudUnavailable ? t('musicgen.cloudUnavailable') : null"
      >
        <!-- 输入 -->
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('musicgen.hint') }}</p>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-muted mb-1">{{ t('musicgen.prompt') }}</label>
              <UTextarea
                v-model="prompt"
                :rows="3"
                :placeholder="t('musicgen.promptPlaceholder')"
                class="w-full"
              />
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="ex in examples"
                :key="ex.label"
                :label="ex.label"
                size="xs"
                variant="soft"
                @click="prompt = ex.value"
              />
            </div>
            <div>
              <label class="flex items-center justify-between text-sm font-medium text-muted mb-1">
                <span>{{ t('musicgen.duration') }}</span>
                <span class="text-highlighted tabular-nums">{{ duration }}s</span>
              </label>
              <USlider v-model="duration" :min="3" :max="15" :step="1" />
            </div>
            <p class="text-xs text-dimmed">{{ t('musicgen.note') }}</p>
          </div>
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            icon="i-lucide-music-4"
            :label="t('musicgen.run')"
            color="primary"
            :loading="loading"
            :disabled="cloudUnavailable"
            @click="generate"
          />
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('musicgen.cancel')"
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
          <div v-else-if="resultUrl" class="space-y-3">
            <p class="text-sm font-medium text-highlighted">{{ t('musicgen.result') }}</p>
            <audio :src="resultUrl" controls class="w-full max-w-md" />
            <UButton
              icon="i-lucide-download"
              :label="t('musicgen.download')"
              size="sm"
              variant="outline"
              tag="a"
              :href="resultUrl"
              download
            />
          </div>
          <div v-else class="text-sm text-muted">{{ t('musicgen.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
