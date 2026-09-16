<script setup lang="ts">
import { formatBytes, formatTime } from '~/utils/format'

/**
 * 视频提取音频：导入视频 → 抽出音轨转成 MP3 / WAV / OGG / M4A / FLAC → 下载。
 * 画面会被丢弃；转换在浏览器内由 ffmpeg.wasm 完成（见 ~/utils/ffmpeg），文件不上传。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'video-to-audio')!)

const bitrate = ref(192)
const { file, sourceUrl, sourceSize, sourceMeta, target, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'mp3',
  buildOptions: format => (losslessFor(format) ? {} : { audioBitrate: bitrate.value })
})

/** WAV/FLAC 是无损格式，不提供码率选项 */
function losslessFor(format: string): boolean {
  return format === 'wav' || format === 'flac'
}

const lossless = computed(() => losslessFor(target.value))

const targetOptions = computed(() => [
  { label: t('convert.targetMp3'), value: 'mp3' },
  { label: t('convert.targetWav'), value: 'wav' },
  { label: t('convert.targetOgg'), value: 'ogg' },
  { label: t('convert.targetM4a'), value: 'm4a' },
  { label: t('convert.targetFlac'), value: 'flac' }
])
const bitrateOptions = computed(() => [320, 192, 128, 96].map(v => ({ label: `${v} kbps`, value: v })))

function onMeta(e: Event) {
  const el = e.target as HTMLVideoElement
  const dims = el.videoWidth ? `${el.videoWidth} × ${el.videoHeight} · ` : ''
  sourceMeta.value = `${dims}${formatTime(el.duration)}`
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <MediaInput
        v-if="!file"
        accept="video/*"
        :hint="t('videoToAudio.hint')"
        @select="select"
      />

      <div
        v-else
        class="grid gap-6 md:grid-cols-2"
      >
        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('convert.input') }}
          </p>
          <video
            :src="sourceUrl"
            controls
            class="w-full max-h-80 rounded-lg bg-black"
            @loadedmetadata="onMeta"
          />
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="font-mono">{{ file.name }}</span>
            <span>{{ formatBytes(sourceSize) }}</span>
            <span v-if="sourceMeta">{{ sourceMeta }}</span>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            :label="t('convert.again')"
            color="neutral"
            variant="subtle"
            :disabled="converting"
            @click="reset"
          />
        </div>

        <div class="space-y-4">
          <p class="text-xs text-muted">
            {{ t('videoToAudio.note') }}
          </p>
          <div class="space-y-2">
            <p class="text-sm font-medium text-highlighted">
              {{ t('convert.target') }}
            </p>
            <USelect
              v-model="target"
              :items="targetOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>
          <div class="space-y-2">
            <p class="text-xs text-muted">
              {{ t('convert.audioBitrate') }}
            </p>
            <USelect
              v-model="bitrate"
              :items="bitrateOptions"
              class="w-full"
              :disabled="converting || lossless"
            />
            <p
              v-if="lossless"
              class="text-xs text-muted"
            >
              {{ t('convert.losslessBitrate') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-repeat"
              :label="converting ? t('convert.converting') : t('convert.start')"
              color="primary"
              :loading="converting"
              @click="convert"
            />
            <UButton
              v-if="outUrl"
              icon="i-lucide-download"
              :label="t('convert.download')"
              color="neutral"
              variant="subtle"
              @click="download"
            />
          </div>
          <UProgress
            v-if="converting"
            :model-value="Math.round(ratio * 100)"
            size="sm"
          />
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-triangle"
            :title="error"
          />

          <div
            v-if="outUrl"
            class="space-y-3 rounded-xl border border-default p-3"
          >
            <p class="text-sm font-medium text-highlighted">
              {{ t('convert.result') }}
            </p>
            <audio
              :src="outUrl"
              controls
              class="w-full"
            />
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <span class="font-mono">{{ outName }}</span>
              <span>{{ formatBytes(outSize) }}</span>
              <span
                v-if="delta !== null"
                :class="delta <= 0 ? 'text-primary' : ''"
              >
                {{ delta <= 0 ? t('convert.smaller', { n: Math.abs(delta) }) : t('convert.larger', { n: delta }) }}
              </span>
            </div>
          </div>

          <p class="text-xs text-muted">
            {{ t('convert.hint') }}
          </p>
          <pre
            v-if="log"
            class="max-h-24 overflow-auto rounded-lg bg-elevated/60 p-2 text-xs text-muted"
          >{{ log }}</pre>
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>
