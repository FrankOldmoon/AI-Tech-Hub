<script setup lang="ts">
import { formatBytes, formatTimeMs } from '~/utils/format'

/**
 * 视频压缩：把体积压小，两种给法 ——
 * - 按目标体积：由「目标字节 × 8 ÷ 时长 − 音频码率」反推视频码率（体积 ≈ 总码率 ÷ 8 × 时长）
 * - 按清晰度：直接给档位码率
 * 与「视频格式转换」的分工：那边手动挑分辨率/码率，这边是为「变小」服务，并先把预计体积算给你看。
 *
 * 注意码率是**平均目标**：ABR 的实际结果会随画面复杂度浮动（一般 ±10~20%），所以压完会告诉你实际体积。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'video-compress')!)

type Mode = 'size' | 'quality'

const mode = ref<Mode>('size')
const targetMb = ref(2)
const presetKbps = ref(1000)
const dimension = ref(0)
const audioKbps = ref(128)
const duration = ref(0)

const { file, sourceUrl, sourceSize, sourceMeta, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'mp4',
  buildOptions: () => ({
    maxDimension: dimension.value || undefined,
    videoBitrate: videoKbps.value,
    audioBitrate: audioKbps.value
  })
})

/** 目标体积 → 视频码率（kbps）；下限 200，免得压成马赛克 */
const videoKbps = computed(() => {
  if (mode.value === 'quality' || !duration.value) return presetKbps.value
  const totalKbps = (targetMb.value * 1024 * 1024 * 8) / duration.value / 1000
  return Math.max(200, Math.round(totalKbps - audioKbps.value))
})

const targetBytes = computed(() => (mode.value === 'size' ? targetMb.value * 1024 * 1024 : 0))
const estimatedBytes = computed(() =>
  duration.value ? Math.round(((videoKbps.value + audioKbps.value) * 1000 / 8) * duration.value) : 0
)
/** 压完实际体积明显超出目标（ABR 有浮动，留 5% 容差，免得 0.9% 的偏差也报警） */
const overTarget = computed(() => targetBytes.value > 0 && outSize.value > targetBytes.value * 1.05)
/** 源文件的平均码率，方便判断还能压多少 */
const sourceKbps = computed(() => (duration.value > 0 ? Math.round((sourceSize.value * 8) / duration.value / 1000) : 0))

const modeOptions = computed(() => [
  { label: t('videoCompress.modeSize'), value: 'size' as Mode, icon: 'i-lucide-target' },
  { label: t('videoCompress.modeQuality'), value: 'quality' as Mode, icon: 'i-lucide-gauge' }
])
const sizeOptions = computed(() => [500, 1024, 2 * 1024, 5 * 1024, 10 * 1024]
  .map(kb => ({ label: formatBytes(kb * 1024), value: kb / 1024 })))
const presetOptions = computed(() => [4000, 2000, 1000, 500].map(v => ({ label: `${v} kbps`, value: v })))
const dimensionOptions = computed(() => [
  { label: t('convert.dimOriginal'), value: 0 },
  { label: '1080p', value: 1920 },
  { label: '720p', value: 1280 },
  { label: '480p', value: 854 }
])
const audioOptions = computed(() => [192, 128, 96, 64].map(v => ({ label: `${v} kbps`, value: v })))

function onMeta(e: Event) {
  const el = e.target as HTMLVideoElement
  duration.value = Number.isFinite(el.duration) ? el.duration : 0
  const dims = el.videoWidth ? `${el.videoWidth} × ${el.videoHeight} · ` : ''
  sourceMeta.value = `${dims}${formatTimeMs(duration.value)}`
}

function onSelect(f: File) {
  duration.value = 0
  select(f)
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <MediaInput
        v-if="!file"
        accept="video/*"
        :hint="t('videoCompress.hint')"
        @select="onSelect"
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
            <span v-if="sourceKbps">{{ t('audioCompress.sourceBitrate', { kbps: sourceKbps }) }}</span>
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
            {{ t('videoCompress.mode') }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-for="opt in modeOptions"
              :key="opt.value"
              :label="opt.label"
              :icon="opt.icon"
              :color="mode === opt.value ? 'primary' : 'neutral'"
              :variant="mode === opt.value ? 'solid' : 'subtle'"
              :disabled="converting"
              @click="mode = opt.value"
            />
          </div>

          <div class="space-y-2">
            <p class="text-xs text-muted">
              {{ mode === 'size' ? t('compress.targetSize') : t('convert.videoBitrate') }}
            </p>
            <USelect
              v-if="mode === 'size'"
              v-model="targetMb"
              :items="sizeOptions"
              class="w-full"
              :disabled="converting"
            />
            <USelect
              v-else
              v-model="presetKbps"
              :items="presetOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>
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
              {{ t('convert.audioBitrate') }}
            </p>
            <USelect
              v-model="audioKbps"
              :items="audioOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>

          <p
            v-if="estimatedBytes"
            class="text-xs text-primary"
          >
            {{ t('compress.estimated', { size: formatBytes(estimatedBytes) }) }}
            <span class="text-muted">（{{ videoKbps }} kbps）</span>
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-repeat"
              :label="converting ? t('convert.converting') : t('compress.start')"
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
            <video
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
            <p
              v-if="overTarget"
              class="text-xs text-amber-600"
            >
              {{ t('videoCompress.over') }}
            </p>
          </div>

          <p class="text-xs text-muted">
            {{ t('videoCompress.note') }}
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
