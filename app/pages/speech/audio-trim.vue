<script setup lang="ts">
import { humanError } from '~/utils/errors'
import { AUDIO_ACCEPT, decodeToRate } from '~/utils/audio'
import { mediaExt, type ConvertTarget } from '~/utils/ffmpeg'
import { formatBytes, formatTimeMs } from '~/utils/format'

/**
 * 音频裁剪：在波形上拖出要保留的一段，只导出这一段。
 *
 * 波形由解码后的样本算每列峰值画出来（不依赖播放，静音时也能看到形状）；
 * 时长以解码结果为准（MediaRecorder 出来的 webm 元素 duration 常是 Infinity）。
 * 输出格式默认跟随源文件（避免无损源被悄悄转成有损），也可以手动换。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audio-trim')!)

const canvasRef = ref<HTMLCanvasElement>()
const audioRef = ref<HTMLAudioElement>()
/** 源文件总长（秒），由解码结果得出 */
const duration = ref(0)
const start = ref(0)
const end = ref(0)
const playing = ref(false)
/** 每列峰值 0..1，只在换文件时算一次 */
let peaks: Float32Array | null = null
let dragging = false

const { file, sourceUrl, sourceSize, sourceMeta, target, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'mp3',
  buildOptions: () => ({ startTime: start.value, endTime: end.value })
})

const selected = computed(() => Math.max(0, end.value - start.value))
const tooShort = computed(() => selected.value < 0.2)

const targetOptions = computed(() => [
  { label: t('convert.targetMp3'), value: 'mp3' },
  { label: t('convert.targetWav'), value: 'wav' },
  { label: t('convert.targetOgg'), value: 'ogg' },
  { label: t('convert.targetM4a'), value: 'm4a' },
  { label: t('convert.targetFlac'), value: 'flac' }
])

/** 在波形上取位置 → 时间 */
function posToTime(clientX: number): number {
  const cv = canvasRef.value
  if (!cv || !duration.value) return 0
  const r = cv.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  return ratio * duration.value
}

function draw() {
  const cv = canvasRef.value
  if (!cv || !peaks) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = cv.clientWidth || 600
  const h = 96
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const mid = h / 2
  ctx.fillStyle = 'rgba(148,163,184,.9)'
  for (let x = 0; x < w; x++) {
    const peak = peaks[Math.floor((x / w) * peaks.length)] ?? 0
    const bar = Math.max(1, peak * (h - 10))
    ctx.fillRect(x, mid - bar / 2, 1, bar)
  }
  if (duration.value > 0 && end.value > start.value) {
    const x1 = (start.value / duration.value) * w
    const x2 = (end.value / duration.value) * w
    ctx.fillStyle = 'rgba(59,130,246,.22)'
    ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h)
    ctx.fillStyle = 'rgba(59,130,246,1)'
    ctx.fillRect(x1, 0, 1.5, h)
    ctx.fillRect(Math.max(0, x2 - 1.5), 0, 1.5, h)
  }
}

/** 解码一次拿峰值与总时长 */
async function loadWaveform(f: File) {
  try {
    const samples = await decodeToRate(f, 16000)
    const cols = 1200
    const step = Math.max(1, Math.floor(samples.length / cols))
    const out = new Float32Array(cols)
    for (let c = 0; c < cols; c++) {
      let peak = 0
      const base = c * step
      for (let i = 0; i < step; i++) {
        const v = Math.abs(samples[base + i] ?? 0)
        if (v > peak) peak = v
      }
      out[c] = peak
    }
    peaks = out
    duration.value = samples.length / 16000
    sourceMeta.value = formatTimeMs(duration.value)
    start.value = 0
    end.value = duration.value
    await nextTick()
    draw()
  } catch (e: unknown) {
    error.value = humanError(e, t)
  }
}

function onPointerDown(e: PointerEvent) {
  if (!duration.value) return
  dragging = true
  const pos = posToTime(e.clientX)
  start.value = pos
  end.value = pos
  canvasRef.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  const pos = posToTime(e.clientX)
  if (pos < start.value) start.value = pos
  else end.value = pos
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  canvasRef.value?.releasePointerCapture(e.pointerId)
  // 只是点了一下（几乎零长度选区）：当成「选整段」而不是留个不可用的空选区
  if (end.value - start.value < 0.2) {
    start.value = 0
    end.value = duration.value
  }
}

/** 预览选区：跳到起点播放，到终点自动暂停 */
function previewSelection() {
  const a = audioRef.value
  if (!a) return
  a.currentTime = start.value
  playing.value = true
  void a.play()
}

function onTimeUpdate(e: Event) {
  const a = e.target as HTMLAudioElement
  if (playing.value && a.currentTime >= end.value) {
    a.pause()
    playing.value = false
  }
}

function onSelect(f: File) {
  peaks = null
  duration.value = 0
  start.value = 0
  end.value = 0
  playing.value = false
  select(f)
  // 输出格式默认跟随源文件：无损源别被悄悄转成有损
  const ext = mediaExt(f)
  target.value = (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) ? ext : 'mp3') as ConvertTarget
  void loadWaveform(f)
}

watch([start, end], draw)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <MediaInput
        v-if="!file"
        :accept="AUDIO_ACCEPT"
        :hint="t('audioTrim.hint')"
        @select="onSelect"
      />

      <div
        v-else
        class="space-y-4"
      >
        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('convert.input') }}
          </p>
          <audio
            ref="audioRef"
            :src="sourceUrl"
            controls
            class="w-full"
            @timeupdate="onTimeUpdate"
          />
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="font-mono">{{ file.name }}</span>
            <span>{{ formatBytes(sourceSize) }}</span>
            <span v-if="sourceMeta">{{ sourceMeta }}</span>
          </div>
        </div>

        <div class="space-y-2">
          <canvas
            ref="canvasRef"
            class="h-24 w-full cursor-crosshair touch-none rounded-lg bg-elevated/60"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          />
          <p class="text-xs text-muted">
            {{ t('audioTrim.dragHint') }}
          </p>
          <p class="text-xs tabular-nums text-muted">
            {{ t('trim.selection', { len: formatTimeMs(selected), total: formatTimeMs(duration) }) }}
          </p>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
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
          <div class="flex flex-wrap items-end gap-2">
            <UButton
              icon="i-lucide-play"
              :label="t('trim.preview')"
              color="neutral"
              variant="subtle"
              :disabled="converting || !duration || tooShort"
              @click="previewSelection"
            />
            <UButton
              icon="i-lucide-scissors"
              :label="converting ? t('convert.converting') : t('trim.trim')"
              color="primary"
              :loading="converting"
              :disabled="!duration || tooShort"
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
            <UButton
              icon="i-lucide-refresh-cw"
              :label="t('convert.again')"
              color="neutral"
              variant="ghost"
              :disabled="converting"
              @click="reset"
            />
          </div>
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
  </MediaDemoShell>
</template>
