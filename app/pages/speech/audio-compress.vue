<script setup lang="ts">
import { AUDIO_ACCEPT } from '~/utils/audio'
import { formatBytes, formatTime } from '~/utils/format'

/**
 * 音频压缩：降码率 / 降采样 / 转单声道 —— 三条都是缩体积的正经手段，适合把录音压成便于传播的大小。
 * 与「音频格式转换」的分工：那边是挑格式，这边只为「变小」服务，并给出预计体积。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audio-compress')!)

const bitrate = ref(96)
/** 0 = 保持原样 */
const sampleRate = ref(0)
const mono = ref(true)
const duration = ref(0)

const { file, sourceUrl, sourceSize, sourceMeta, target, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'mp3',
  buildOptions: () => ({
    audioBitrate: bitrate.value,
    sampleRate: sampleRate.value || undefined,
    channels: mono.value ? 1 : undefined
  })
})

/** WAV/FLAC 是无损格式，没有码率可调 */
function losslessFor(format: string): boolean {
  return format === 'wav' || format === 'flac'
}

const lossless = computed(() => losslessFor(target.value))

const targetOptions = computed(() => [
  { label: t('convert.targetMp3'), value: 'mp3' },
  { label: t('convert.targetOgg'), value: 'ogg' },
  { label: t('convert.targetM4a'), value: 'm4a' },
  { label: t('convert.targetWav'), value: 'wav' },
  { label: t('convert.targetFlac'), value: 'flac' }
])
const bitrateOptions = computed(() => [32, 64, 96, 128, 192].map(v => ({ label: `${v} kbps`, value: v })))
const sampleRateOptions = computed(() => [
  { label: t('audioCompress.sampleRateKeep'), value: 0 },
  { label: '44100 Hz', value: 44100 },
  { label: '24000 Hz', value: 24000 },
  { label: '16000 Hz', value: 16000 }
])

/** 预计体积 = 码率/8 × 时长（有损格式才可算；无损看内容，估不准就不显示） */
const estimated = computed(() =>
  duration.value > 0 && !lossless.value
    ? Math.round((bitrate.value * 1000 / 8) * duration.value)
    : 0
)
/** 源文件的平均码率，方便对比该压到多少 */
const sourceKbps = computed(() =>
  duration.value > 0 ? Math.round((sourceSize.value * 8) / duration.value / 1000) : 0
)

function onMeta(e: Event) {
  const el = e.target as HTMLAudioElement
  duration.value = Number.isFinite(el.duration) ? el.duration : 0
  sourceMeta.value = formatTime(duration.value)
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
        :accept="AUDIO_ACCEPT"
        :hint="t('audioCompress.hint')"
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
          <audio
            :src="sourceUrl"
            controls
            class="w-full"
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
          <div class="space-y-2">
            <p class="text-xs text-muted">
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
          <div class="space-y-2">
            <p class="text-xs text-muted">
              {{ t('audioCompress.sampleRate') }}
            </p>
            <USelect
              v-model="sampleRate"
              :items="sampleRateOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>
          <USwitch
            v-model="mono"
            :label="t('audioCompress.mono')"
            :disabled="converting"
          />

          <p
            v-if="estimated"
            class="text-xs text-primary"
          >
            {{ t('compress.estimated', { size: formatBytes(estimated) }) }}
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
            {{ t('audioCompress.note') }}
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
