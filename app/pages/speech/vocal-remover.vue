<script setup lang="ts">
import { AUDIO_ACCEPT, fileObjectUrl } from '~/utils/audio'
import { humanError } from '~/utils/errors'
import { formatBytes, formatTime } from '~/utils/format'
import { separateVocals, type VocalProgress } from '~/utils/vocal-remover'

/**
 * 人声分离：从歌曲里抽出「人声」与「伴奏」两轨。
 *
 * MDX-Net 模型在浏览器内由 onnxruntime-web 推理（WebGPU 优先、WASM 兜底），
 * 音频与模型都不上传；首次使用需要下载约 67MB 模型，之后走 CacheStorage。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'vocal-remover')!)

const file = ref<File | null>(null)
const sourceUrl = ref('')
const duration = ref('')
const vocalsUrl = ref('')
const instrumentalUrl = ref('')
const running = ref(false)
const error = ref<string | null>(null)
const progress = ref<VocalProgress | null>(null)
let disposed = false

const samples = computed(() => [
  { label: t('separation.sample'), url: '/samples/audio/music.wav' }
])

const stageText = computed(() => {
  if (!progress.value) return ''
  const key = `separation.stage${progress.value.stage.charAt(0).toUpperCase()}${progress.value.stage.slice(1)}` as const
  return t(key)
})

const baseName = computed(() => (file.value?.name ?? 'audio').replace(/\.[^.]+$/, ''))

function select(f: File) {
  reset()
  file.value = f
  sourceUrl.value = fileObjectUrl(f)
}

async function useSample(url: string) {
  try {
    const blob = await (await fetch(url)).blob()
    select(new File([blob], 'music.wav', { type: blob.type || 'audio/wav' }))
  } catch (e) {
    error.value = humanError(e, t)
  }
}

function onMeta(e: Event) {
  duration.value = formatTime((e.target as HTMLAudioElement).duration)
}

function revokeStems() {
  if (vocalsUrl.value) URL.revokeObjectURL(vocalsUrl.value)
  if (instrumentalUrl.value) URL.revokeObjectURL(instrumentalUrl.value)
  vocalsUrl.value = ''
  instrumentalUrl.value = ''
}

function reset() {
  revokeStems()
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  sourceUrl.value = ''
  file.value = null
  duration.value = ''
  error.value = null
  progress.value = null
}

async function run() {
  if (!file.value || running.value) return
  running.value = true
  error.value = null
  revokeStems()
  progress.value = { stage: 'loading', percent: 0 }
  try {
    const stems = await separateVocals(sourceUrl.value, (p) => {
      progress.value = p
    })
    if (disposed) {
      URL.revokeObjectURL(stems.vocals)
      URL.revokeObjectURL(stems.instrumental)
      return
    }
    vocalsUrl.value = stems.vocals
    instrumentalUrl.value = stems.instrumental
  } catch (e) {
    error.value = t('separation.fail', { msg: humanError(e, t) })
  } finally {
    running.value = false
    progress.value = null
  }
}

function download(url: string, kind: 'vocals' | 'instrumental') {
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName.value}_${kind}.wav`
  a.click()
}

onBeforeUnmount(() => {
  disposed = true
  revokeStems()
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <MediaInput
        v-if="!file"
        :accept="AUDIO_ACCEPT"
        :hint="t('separation.uploadHint')"
        :samples="samples"
        :max-size="60 * 1024 * 1024"
        @select="select"
        @sample="useSample"
      />

      <div
        v-else
        class="grid gap-6 md:grid-cols-2"
      >
        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('separation.source') }}
          </p>
          <audio
            :src="sourceUrl"
            controls
            class="w-full"
            @loadedmetadata="onMeta"
          />
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="font-mono">{{ file.name }}</span>
            <span>{{ formatBytes(file.size) }}</span>
            <span v-if="duration">{{ duration }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-wand-sparkles"
              :label="running ? t('separation.processing') : t('separation.separate')"
              color="primary"
              :loading="running"
              @click="run"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              :label="t('separation.again')"
              color="neutral"
              variant="subtle"
              :disabled="running"
              @click="reset"
            />
          </div>

          <UProgress
            v-if="running"
            :model-value="progress?.percent ?? 0"
            size="sm"
          />
          <p
            v-if="running"
            class="text-xs text-muted"
          >
            {{ stageText }}
          </p>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-triangle"
            :title="error"
          />

          <p class="text-xs text-muted">
            {{ t('separation.modelNote') }}
          </p>
        </div>

        <div class="space-y-4">
          <p class="text-sm font-medium text-highlighted">
            {{ t('separation.stems') }}
          </p>

          <template v-if="vocalsUrl">
            <div class="space-y-2 rounded-xl border border-default p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted">{{ t('separation.vocals') }}</span>
                <UButton
                  icon="i-lucide-download"
                  :label="t('separation.download')"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  @click="download(vocalsUrl, 'vocals')"
                />
              </div>
              <audio
                :src="vocalsUrl"
                controls
                class="w-full"
              />
            </div>

            <div class="space-y-2 rounded-xl border border-default p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted">{{ t('separation.no_vocals') }}</span>
                <UButton
                  icon="i-lucide-download"
                  :label="t('separation.download')"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  @click="download(instrumentalUrl, 'instrumental')"
                />
              </div>
              <audio
                :src="instrumentalUrl"
                controls
                class="w-full"
              />
            </div>
          </template>

          <p
            v-else
            class="rounded-xl border border-dashed border-default p-6 text-center text-sm text-muted"
          >
            {{ t('separation.empty') }}
          </p>
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>
