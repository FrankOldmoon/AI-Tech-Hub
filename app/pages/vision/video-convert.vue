<script setup lang="ts">
import { formatBytes, formatTime } from '~/utils/format'

/**
 * 视频格式转换：导入视频 → 转 MP4（可调分辨率/码率）或 GIF（可调帧率/宽度）→ 下载。
 * 转换在浏览器内由 ffmpeg.wasm 完成（见 ~/utils/ffmpeg），文件不上传。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'video-convert')!)

/** 0 = 保持原尺寸；其余是「长边上限」，等比缩放 */
const dimension = ref(0)
const videoBitrate = ref(2000)
const gifFps = ref(12)
const gifWidth = ref(480)

const { file, sourceUrl, sourceSize, sourceMeta, target, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'mp4',
  buildOptions: format => (format === 'gif'
    ? { gifFps: gifFps.value, gifWidth: gifWidth.value }
    : { maxDimension: dimension.value || undefined, videoBitrate: videoBitrate.value })
})

const isGif = computed(() => target.value === 'gif')

const targetOptions = computed(() => [
  { label: t('convert.targetMp4'), value: 'mp4' },
  { label: t('convert.targetGif'), value: 'gif' }
])
const dimensionOptions = computed(() => [
  { label: t('convert.dimOriginal'), value: 0 },
  { label: '1080p', value: 1920 },
  { label: '720p', value: 1280 },
  { label: '480p', value: 854 }
])
const bitrateOptions = computed(() => [
  { label: '4 Mbps', value: 4000 },
  { label: '2 Mbps', value: 2000 },
  { label: '1 Mbps', value: 1000 }
])
const gifFpsOptions = computed(() => [8, 12, 15, 24].map(v => ({ label: `${v} fps`, value: v })))
const gifWidthOptions = computed(() => [320, 480, 640].map(v => ({ label: `${v} px`, value: v })))

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
        :hint="t('videoConvert.hint')"
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

          <div
            v-if="!isGif"
            class="space-y-3"
          >
            <div class="space-y-2">
              <p class="text-xs text-muted">
                {{ t('convert.dimension') }}
              </p>
              <USelect
                v-model="dimension"
                :items="dimensionOptions"
                class="w-full"
                :disabled="converting"
              />
            </div>
            <div class="space-y-2">
              <p class="text-xs text-muted">
                {{ t('convert.videoBitrate') }}
              </p>
              <USelect
                v-model="videoBitrate"
                :items="bitrateOptions"
                class="w-full"
                :disabled="converting"
              />
            </div>
          </div>

          <div
            v-else
            class="space-y-3"
          >
            <div class="space-y-2">
              <p class="text-xs text-muted">
                {{ t('convert.gifFps') }}
              </p>
              <USelect
                v-model="gifFps"
                :items="gifFpsOptions"
                class="w-full"
                :disabled="converting"
              />
            </div>
            <div class="space-y-2">
              <p class="text-xs text-muted">
                {{ t('convert.gifWidth') }}
              </p>
              <USelect
                v-model="gifWidth"
                :items="gifWidthOptions"
                class="w-full"
                :disabled="converting"
              />
            </div>
            <p class="text-xs text-muted">
              {{ t('videoConvert.gifNote') }}
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
            <img
              v-if="isGif"
              :src="outUrl"
              :alt="outName"
              class="w-full max-h-72 rounded-lg bg-black object-contain"
            >
            <video
              v-else
              :src="outUrl"
              controls
              class="w-full max-h-72 rounded-lg bg-black"
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
