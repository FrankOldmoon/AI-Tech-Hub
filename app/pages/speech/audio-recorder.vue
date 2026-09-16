<script setup lang="ts">
import { humanError, mediaError } from '~/utils/errors'
import { convertMedia, mediaExt, type ConvertTarget } from '~/utils/ffmpeg'

/**
 * 录音工具：麦克风录制 → 试听 / 下载 → 浏览器内转格式（ffmpeg.wasm）。
 *
 * - 采集、chunk 累积、秒表、卸载关流全部交给 useRecorder（与 voiceprint / voice-clone /
 *   speech-translate 同一条路径），本页只额外做「电平表」与「转格式」两件事。
 * - 电平表要挂在**录音那条流**上，所以 useRecorder 会把实时 stream 暴露出来。
 * - 产物不经过服务器：MediaRecorder 原生编码（Chrome 是 webm/Opus、Safari 是 m4a/AAC），
 *   转码交给本地的 ffmpeg.wasm（见 ~/utils/ffmpeg）。
 */

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audio-recorder')!)

const error = ref<string | null>(null)
/** 这一段录了多久（秒）：useRecorder 的秒表在 onStop 之前就归零了，所以自己留住最后一个非零值 */
const elapsed = ref(0)
/** 输入电平 0..1，驱动那根条子 */
const level = ref(0)

const resultUrl = ref('')
const resultName = ref('')
const resultSize = ref(0)
let resultBlob: Blob | null = null

const target = ref<ConvertTarget>('mp3')
const converting = ref(false)
const convertRatio = ref(0)
const convertLog = ref('')
const convertedUrl = ref('')
const convertedName = ref('')

const recorder = useRecorder({
  namePrefix: 'audio',
  onStop: handleStopped,
  onError: (e) => { error.value = mediaError(e, t) }
})
const recording = recorder.recording
const seconds = recorder.seconds
const stream = recorder.stream

watch(seconds, (v) => {
  if (v > 0) elapsed.value = v
})

const targetOptions = computed(() => [
  { label: t('audioRecorder.targetMp3'), value: 'mp3' },
  { label: t('audioRecorder.targetWav'), value: 'wav' },
  { label: t('audioRecorder.targetOgg'), value: 'ogg' },
  { label: t('audioRecorder.targetM4a'), value: 'm4a' },
  { label: t('audioRecorder.targetFlac'), value: 'flac' }
])

const timerText = computed(() => formatTime(recording.value ? seconds.value : elapsed.value))
const resultSizeText = computed(() => formatSize(resultSize.value))
const levelPercent = computed(() => Math.round(level.value * 100))

function formatTime(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function handleStopped(file: File) {
  if (!file.size) {
    error.value = t('audioRecorder.emptyRecording')
    return
  }
  resultBlob = file
  resultSize.value = file.size
  // 后缀按真实容器取：Safari 录出来是 m4a/AAC，而 useRecorder 一律命名成 .webm
  resultName.value = `audio-${stamp()}.${mediaExt(file)}`
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = URL.createObjectURL(file)
}

function start() {
  if (recording.value) return
  error.value = null
  clearResult()
  if (typeof MediaRecorder === 'undefined') {
    error.value = t('audioRecorder.unsupported')
    return
  }
  void recorder.start()
}

function stop() {
  recorder.stop()
}

/** 清掉这一轮的录音与转换产物（不动采集状态） */
function clearResult() {
  resultBlob = null
  resultSize.value = 0
  elapsed.value = 0
  resultName.value = ''
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  if (convertedUrl.value) URL.revokeObjectURL(convertedUrl.value)
  convertedUrl.value = ''
  convertedName.value = ''
  convertRatio.value = 0
  convertLog.value = ''
}

function download(url: string, name: string) {
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

async function convert() {
  if (!resultBlob || converting.value) return
  converting.value = true
  error.value = null
  convertRatio.value = 0
  convertLog.value = ''
  try {
    const out = await convertMedia(resultBlob, target.value, {
      onLog: (message) => { convertLog.value = message },
      onProgress: (ratio) => {
        convertRatio.value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
      }
    })
    if (convertedUrl.value) URL.revokeObjectURL(convertedUrl.value)
    convertedUrl.value = URL.createObjectURL(out.blob)
    convertedName.value = out.name
  } catch (e: unknown) {
    error.value = humanError(e, t)
  } finally {
    converting.value = false
  }
}

// ---- 电平表 ----
let meterCtx: AudioContext | null = null
let meterRaf: number | null = null

function stopMeter() {
  if (meterRaf !== null) {
    cancelAnimationFrame(meterRaf)
    meterRaf = null
  }
  if (meterCtx) {
    void meterCtx.close()
    meterCtx = null
  }
  level.value = 0
}

/**
 * 把分析节点挂在录音那条流上：必须连到 destination 才会被拉取（与 useMicStream 里
 * ScriptProcessor 那条注释同一个原因），但 AnalyserNode 是直通的，直接接扬声器会把麦克风
 * 声音放出来形成啸叫 —— 所以中间串一个 gain=0 的「哑终端」。
 */
watch(stream, (s) => {
  stopMeter()
  if (!s) return
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = g.AudioContext ?? g.webkitAudioContext
  if (!Ctor) return
  const ctx = new Ctor()
  // 有些浏览器即使是在点击回调里创建也会停在 suspended，显式 resume 一次（失败也无害）
  void ctx.resume()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const mute = ctx.createGain()
  mute.gain.value = 0
  ctx.createMediaStreamSource(s).connect(analyser)
  analyser.connect(mute)
  mute.connect(ctx.destination)
  meterCtx = ctx
  const buf = new Float32Array(analyser.fftSize)
  const tick = () => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    // RMS × 3：正常说话时条子能走到七八成，不至于只有一点点动静
    level.value = Math.min(1, Math.sqrt(sum / buf.length) * 3)
    meterRaf = requestAnimationFrame(tick)
  }
  tick()
})

onBeforeUnmount(() => {
  stopMeter()
  clearResult()
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            v-if="!recording"
            icon="i-lucide-mic"
            :label="t('audioRecorder.start')"
            color="primary"
            @click="start"
          />
          <UButton
            v-else
            icon="i-lucide-square"
            :label="t('audioRecorder.stop')"
            color="error"
            @click="stop"
          />
          <span
            v-if="recording || elapsed"
            class="font-mono text-sm tabular-nums text-muted"
          >
            {{ timerText }}
          </span>
          <span
            v-if="recording"
            class="flex items-center gap-2 text-xs text-muted"
          >
            <span class="size-2 rounded-full bg-red-500 animate-pulse" />
            {{ t('audioRecorder.recording') }}
          </span>
        </div>

        <div>
          <div class="h-2.5 w-full max-w-xl overflow-hidden rounded-full bg-elevated">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-75"
              :style="{ width: `${levelPercent}%` }"
            />
          </div>
          <p class="mt-1 text-xs text-muted">
            {{ t('audioRecorder.level') }}
          </p>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <UCard v-if="resultUrl">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon
              name="i-lucide-audio-lines"
              class="size-4"
            />
            {{ t('audioRecorder.result') }}
          </div>
        </template>
        <div class="space-y-4">
          <audio
            :src="resultUrl"
            controls
            class="w-full"
          />
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span class="font-mono">{{ resultName }}</span>
            <span>{{ resultSizeText }}</span>
            <span class="tabular-nums">{{ formatTime(elapsed) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-download"
              :label="t('audioRecorder.download')"
              color="primary"
              @click="download(resultUrl, resultName)"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              :label="t('audioRecorder.recordAgain')"
              color="neutral"
              variant="subtle"
              @click="clearResult"
            />
          </div>

          <USeparator />

          <div class="space-y-3">
            <p class="text-sm font-medium text-highlighted">
              {{ t('audioRecorder.convertTitle') }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <USelect
                v-model="target"
                :items="targetOptions"
                class="w-64"
                :disabled="converting"
              />
              <UButton
                icon="i-lucide-repeat"
                :label="converting ? t('audioRecorder.converting') : t('audioRecorder.convert')"
                color="primary"
                variant="subtle"
                :loading="converting"
                @click="convert"
              />
              <UButton
                v-if="convertedUrl"
                icon="i-lucide-download"
                :label="t('audioRecorder.downloadConverted')"
                color="neutral"
                variant="subtle"
                @click="download(convertedUrl, convertedName)"
              />
            </div>
            <UProgress
              v-if="converting"
              :model-value="Math.round(convertRatio * 100)"
              size="sm"
            />
            <p class="text-xs text-muted">
              {{ t('audioRecorder.convertHint') }}
            </p>
            <pre
              v-if="convertLog"
              class="max-h-24 overflow-auto rounded-lg bg-elevated/60 p-2 text-xs text-muted"
            >
              {{ convertLog }}
            </pre>
          </div>
        </div>
      </UCard>

      <p
        v-else
        class="text-sm text-muted"
      >
        {{ t('audioRecorder.hint') }}
      </p>
    </div>
  </MediaDemoShell>
</template>
