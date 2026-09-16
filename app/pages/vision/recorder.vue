<script setup lang="ts">
import { humanError, mediaError } from '~/utils/errors'
import { convertRecording, type ConvertTarget } from '~/utils/ffmpeg'
import { transcribeToSrt, type SubtitleStage, type WhisperSubtitleModel } from '~/utils/whisper-subtitles'

/**
 * 录制工具：摄像头 / 屏幕 / 摄像头+屏幕（画中画合成）。
 *
 * - 摄像头录制自带音频（用户要求）；屏幕录制能否带声音取决于共享时是否勾选「分享音频」，
 *   拿不到音轨时给一句提示，不当作错误。
 * - 摄像头+屏幕：两路视频用 canvas 合成（屏幕铺底 + 摄像头右下角画中画），
 *   录的是 canvas.captureStream()；音频经 WebAudio 混成一路（只接 MediaStreamDestination，
 *   不接扬声器，否则麦克风会立刻啸叫）。
 * - 产物是浏览器原生编码的 webm（Safari 下是 mp4），转其它格式交给 ffmpeg.wasm（见 ~/utils/ffmpeg）。
 */

type RecordMode = 'camera' | 'screen' | 'both'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'recorder')!)

const mode = ref<RecordMode>('camera')
const starting = ref(false)
const recording = ref(false)
const error = ref<string | null>(null)
const note = ref('')
const elapsed = ref(0)

const liveRef = ref<HTMLVideoElement>()
const stageRef = ref<HTMLCanvasElement>()

const resultUrl = ref('')
const resultName = ref('')
const resultSize = ref(0)
const resultDuration = ref(0)
let resultBlob: Blob | null = null

const target = ref<ConvertTarget>('mp4')
const converting = ref(false)
const convertRatio = ref(0)
const convertLog = ref('')
const convertedUrl = ref('')
const convertedName = ref('')
/** 这次录制的流里有没有音轨：没有（例如屏幕共享未勾选「分享音频」）就不提供 MP3 选项 */
const hadAudio = ref(true)

// 字幕（本地 Whisper，见 ~/utils/whisper-subtitles）
const subtitleEnabled = ref(false)
const whisperModel = ref<WhisperSubtitleModel>('Xenova/whisper-base')
const subtitleBusy = ref(false)
const subtitleStage = ref<SubtitleStage | ''>('')
const subtitlePercent = ref(0)
const srt = ref('')
const srtSegments = ref(0)

let liveStream: MediaStream | null = null
let extraStreams: MediaStream[] = []
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let drawRaf: number | null = null
let timer: ReturnType<typeof setInterval> | null = null
let startedAt = 0
let audioCtx: AudioContext | null = null

const modeOptions = computed<Array<{ label: string, value: RecordMode, icon: string }>>(() => [
  { label: t('recorder.modeCamera'), value: 'camera', icon: 'i-lucide-video' },
  { label: t('recorder.modeScreen'), value: 'screen', icon: 'i-lucide-monitor' },
  { label: t('recorder.modeBoth'), value: 'both', icon: 'i-lucide-picture-in-picture-2' }
])

const targetOptions = computed(() => {
  const options = [
    { label: t('recorder.targetMp4'), value: 'mp4' },
    { label: t('recorder.targetGif'), value: 'gif' }
  ]
  // 没有音轨时抽音频必然失败，干脆不给这个选项，避免用户撞到一个费解的退出码
  if (hadAudio.value) options.push({ label: t('recorder.targetMp3'), value: 'mp3' })
  return options
})

const currentIcon = computed(() => modeOptions.value.find(o => o.value === mode.value)?.icon ?? 'i-lucide-video')

const whisperModelOptions = computed(() => [
  { label: t('recorder.modelTiny'), value: 'Xenova/whisper-tiny' },
  { label: t('recorder.modelBase'), value: 'Xenova/whisper-base' },
  { label: t('recorder.modelSmall'), value: 'Xenova/whisper-small' }
])

/** 识别语言跟随界面语言（Whisper 用的是语言名而非 BCP-47） */
const subtitleLanguage = computed(() => (locale.value.startsWith('zh') ? 'chinese' : 'english'))

const stageText = computed(() => {
  if (subtitleStage.value === 'decode') return t('recorder.subtitleStageDecode')
  if (subtitleStage.value === 'load') return t('recorder.subtitleStageLoad')
  if (subtitleStage.value === 'transcribe') return t('recorder.subtitleStageTranscribe')
  return t('recorder.subtitleGenerate')
})

// 用显式三分支而不是拼 key：check:i18n 只校验字符串字面量的 key，动态拼接会被跳过
const modeHint = computed(() => {
  if (mode.value === 'screen') return t('recorder.hintScreen')
  if (mode.value === 'both') return t('recorder.hintBoth')
  return t('recorder.hintCamera')
})
const elapsedText = computed(() => formatTime(elapsed.value))
const resultSizeText = computed(() => formatSize(resultSize.value))

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
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

/** 挑一个当前浏览器支持的容器；顺序即优先级 */
function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ]
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c
    } catch {
      // 个别实现会在不支持时抛异常而不是返回 false
    }
  }
  return ''
}

function stopSources() {
  if (drawRaf !== null) {
    cancelAnimationFrame(drawRaf)
    drawRaf = null
  }
  const all = [liveStream, ...extraStreams]
  for (const s of all) {
    if (s) s.getTracks().forEach(track => track.stop())
  }
  liveStream = null
  extraStreams = []
  if (audioCtx) {
    void audioCtx.close()
    audioCtx = null
  }
  const live = liveRef.value
  if (live) live.srcObject = null
}

/** 停采集 + 停计时 + 丢掉未完成的录音机（不改动已生成的结果） */
function resetCapture() {
  stopSources()
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (recorder) {
    recorder.ondataavailable = null
    recorder.onstop = null
    if (recorder.state !== 'inactive') recorder.stop()
    recorder = null
  }
  chunks = []
  recording.value = false
  elapsed.value = 0
}

function clearResult() {
  resetCapture()
  resultBlob = null
  resultSize.value = 0
  resultDuration.value = 0
  resultName.value = ''
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  if (convertedUrl.value) URL.revokeObjectURL(convertedUrl.value)
  convertedUrl.value = ''
  convertedName.value = ''
  convertRatio.value = 0
  convertLog.value = ''
  srt.value = ''
  srtSegments.value = 0
  subtitleStage.value = ''
  subtitlePercent.value = 0
  note.value = ''
}

/** 摄像头+屏幕：canvas 合成（屏幕铺底 + 摄像头画中画），音频混音 */
async function composeScreenAndCamera(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  extraStreams.push(display)
  let camera: MediaStream
  try {
    camera = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    })
  } catch (e: unknown) {
    // 摄像头没授权就别继续留着屏幕共享
    stopSources()
    throw e
  }
  extraStreams.push(camera)

  const canvas = stageRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) throw new Error(t('recorder.canvasMissing'))
  const settings = display.getVideoTracks()[0]?.getSettings() ?? {}
  canvas.width = Math.round(settings.width ?? 1280)
  canvas.height = Math.round(settings.height ?? 720)

  const screenVideo = document.createElement('video')
  screenVideo.autoplay = true
  screenVideo.muted = true
  screenVideo.playsInline = true
  screenVideo.srcObject = display
  await screenVideo.play()

  const cameraVideo = document.createElement('video')
  cameraVideo.autoplay = true
  cameraVideo.muted = true
  cameraVideo.playsInline = true
  cameraVideo.srcObject = camera
  await cameraVideo.play()

  startDrawLoop(ctx, canvas, screenVideo, cameraVideo)

  const canvasStream = canvas.captureStream(30)
  const mixed = mixAudio([camera, display])
  return new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(mixed ? mixed.getAudioTracks() : [])
  ])
}

function startDrawLoop(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  screenVideo: HTMLVideoElement,
  cameraVideo: HTMLVideoElement
) {
  const draw = () => {
    const w = canvas.width
    const h = canvas.height
    if (w && h) {
      if (screenVideo.readyState >= 2) ctx.drawImage(screenVideo, 0, 0, w, h)
      else {
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(0, 0, w, h)
      }
      if (cameraVideo.readyState >= 2) drawPip(ctx, cameraVideo, w, h)
    }
    drawRaf = requestAnimationFrame(draw)
  }
  draw()
}

/** 摄像头画中画：右下角、宽 26%、圆角白描边 */
function drawPip(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number) {
  const pw = Math.round(w * 0.26)
  const ph = Math.round(pw * (video.videoHeight || 720) / (video.videoWidth || 1280))
  const px = w - pw - Math.round(w * 0.03)
  const py = h - ph - Math.round(h * 0.05)
  const r = Math.round(pw * 0.06)
  ctx.save()
  traceRoundRect(ctx, px, py, pw, ph, r)
  ctx.clip()
  ctx.drawImage(video, px, py, pw, ph)
  ctx.restore()
  ctx.lineWidth = Math.max(2, Math.round(w * 0.003))
  ctx.strokeStyle = 'rgba(255,255,255,.9)'
  traceRoundRect(ctx, px, py, pw, ph, r)
  ctx.stroke()
}

function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** 多路音频混成一路；只有一路时直接用，省掉一次 WebAudio */
function mixAudio(streams: MediaStream[]): MediaStream | null {
  const withAudio = streams.filter(s => s.getAudioTracks().length > 0)
  const first = withAudio[0]
  if (!first) return null
  if (withAudio.length === 1) return first
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = g.AudioContext ?? g.webkitAudioContext
  if (!Ctor) return first
  audioCtx = new Ctor()
  const dest = audioCtx.createMediaStreamDestination()
  for (const s of withAudio) {
    audioCtx.createMediaStreamSource(s).connect(dest)
  }
  return dest.stream
}

function startRecorder(stream: MediaStream, mime: string) {
  chunks = []
  const rec = new MediaRecorder(stream, { mimeType: mime })
  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data.size) chunks.push(e.data)
  }
  rec.onstop = () => {
    finish(rec.mimeType || mime)
  }
  recorder = rec
  rec.start(1000)
  recording.value = true
  startedAt = Date.now()
  elapsed.value = 0
  timer = setInterval(() => {
    elapsed.value = (Date.now() - startedAt) / 1000
  }, 200)
}

function finish(mime: string) {
  recording.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const seconds = elapsed.value
  const blob = new Blob(chunks, { type: mime || 'video/webm' })
  chunks = []
  recorder = null
  stopSources()
  if (!hadAudio.value && target.value === 'mp3') target.value = 'mp4'
  if (!blob.size) {
    error.value = t('recorder.emptyRecording')
    return
  }
  resultBlob = blob
  resultSize.value = blob.size
  resultDuration.value = seconds
  const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm'
  resultName.value = `recording-${stamp()}.${ext}`
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = URL.createObjectURL(blob)
  // 勾了「自动生成字幕」就直接跑：开关本身就是用户的同意，进度条会告诉他现在的阶段
  if (subtitleEnabled.value && hadAudio.value) void generateSubtitles()
}

async function start() {
  if (recording.value || starting.value) return
  error.value = null
  note.value = ''
  clearResult()
  starting.value = true
  try {
    let stream: MediaStream
    if (mode.value === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      if (!stream.getAudioTracks().length) note.value = t('recorder.noScreenAudio')
    } else if (mode.value === 'camera') {
      // 摄像头录制自带音频
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      })
    } else {
      stream = await composeScreenAndCamera()
    }
    liveStream = stream
    hadAudio.value = stream.getAudioTracks().length > 0
    if (mode.value !== 'both') {
      const live = liveRef.value
      if (live) {
        live.srcObject = stream
        await live.play()
      }
    }
    const mime = pickMime()
    if (!mime) throw new Error(t('recorder.unsupported'))
    startRecorder(stream, mime)
  } catch (e: unknown) {
    resetCapture()
    error.value = mediaError(e, t)
  } finally {
    starting.value = false
  }
}

function stop() {
  if (recorder && recorder.state !== 'inactive') recorder.stop()
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
    const out = await convertRecording(resultBlob, target.value, {
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

/** 用本地 Whisper 对「录制文件里的音轨」做识别并生成 SRT */
async function generateSubtitles() {
  const blob = resultBlob
  if (!blob || subtitleBusy.value) return
  if (!hadAudio.value) {
    error.value = t('recorder.subtitleNoAudio')
    return
  }
  subtitleBusy.value = true
  error.value = null
  srt.value = ''
  srtSegments.value = 0
  subtitlePercent.value = 0
  try {
    const out = await transcribeToSrt(
      blob,
      { model: whisperModel.value, language: subtitleLanguage.value },
      {
        onProgress: (percent) => { subtitlePercent.value = percent },
        onStage: (stage) => { subtitleStage.value = stage }
      }
    )
    srt.value = out.srt
    srtSegments.value = out.segments.length
    if (!out.srt) error.value = t('recorder.subtitleEmpty')
  } catch (e: unknown) {
    error.value = humanError(e, t)
  } finally {
    subtitleBusy.value = false
    subtitleStage.value = ''
  }
}

function downloadSrt() {
  if (!srt.value) return
  const blob = new Blob([srt.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  download(url, `${resultName.value.replace(/\.[^.]+$/, '')}.srt`)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

onBeforeUnmount(() => {
  resetCapture()
  clearResult()
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 模式选择 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-for="opt in modeOptions"
        :key="opt.value"
        :label="opt.label"
        :icon="opt.icon"
        :color="mode === opt.value ? 'primary' : 'neutral'"
        :variant="mode === opt.value ? 'solid' : 'subtle'"
        :disabled="recording || starting"
        @click="mode = opt.value"
      />
      <div class="ms-auto flex items-center gap-2">
        <UButton
          v-if="!recording"
          icon="i-lucide-circle-dot"
          :label="starting ? t('recorder.starting') : t('recorder.start')"
          color="primary"
          :loading="starting"
          @click="start"
        />
        <UButton
          v-else
          icon="i-lucide-square"
          :label="t('recorder.stop')"
          color="error"
          @click="stop"
        />
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="error"
    />
    <UAlert
      v-if="note"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      :title="note"
    />

    <!-- 预览 / 合成画布 -->
    <div class="relative w-full max-w-3xl mx-auto rounded-xl overflow-hidden bg-black aspect-video">
      <video
        v-show="mode !== 'both'"
        ref="liveRef"
        class="w-full h-full object-contain"
        playsinline
        muted
      />
      <canvas
        v-show="mode === 'both'"
        ref="stageRef"
        class="w-full h-full object-contain"
      />
      <div
        v-if="!recording && !resultUrl"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60"
      >
        <UIcon :name="currentIcon" class="size-10" />
        <p class="text-sm">
          {{ modeHint }}
        </p>
      </div>
      <div
        v-if="recording"
        class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white backdrop-blur"
      >
        <span class="size-2 rounded-full bg-red-500 animate-pulse" />
        <span class="text-sm tabular-nums">{{ elapsedText }}</span>
      </div>
    </div>

    <!-- 结果 + 下载 + 转格式 -->
    <UCard v-if="resultUrl">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-film" class="size-4" />
          {{ t('recorder.result') }}
        </div>
      </template>
      <div class="space-y-4">
        <video
          :src="resultUrl"
          controls
          class="w-full rounded-lg bg-black max-h-80"
        />
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span class="font-mono">{{ resultName }}</span>
          <span>{{ resultSizeText }}</span>
          <span class="tabular-nums">{{ formatTime(resultDuration) }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-download"
            :label="t('recorder.download')"
            color="primary"
            @click="download(resultUrl, resultName)"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            :label="t('recorder.recordAgain')"
            color="neutral"
            variant="subtle"
            @click="clearResult"
          />
        </div>

        <USeparator />

        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('recorder.convertTitle') }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <USelect
              v-model="target"
              :items="targetOptions"
              class="w-48"
              :disabled="converting"
            />
            <UButton
              icon="i-lucide-repeat"
              :label="converting ? t('recorder.converting') : t('recorder.convert')"
              color="primary"
              variant="subtle"
              :loading="converting"
              @click="convert"
            />
            <UButton
              v-if="convertedUrl"
              icon="i-lucide-download"
              :label="t('recorder.downloadConverted')"
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
            {{ t('recorder.convertHint') }}
          </p>
          <p v-if="!hadAudio" class="text-xs text-muted">
            {{ t('recorder.noAudioForMp3') }}
          </p>
          <pre
            v-if="convertLog"
            class="max-h-24 overflow-auto rounded-lg bg-elevated/60 p-2 text-xs text-muted"
          >
            {{ convertLog }}
          </pre>
        </div>

        <USeparator />

        <!-- 字幕（本地 Whisper，数据不出设备） -->
        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('recorder.subtitleTitle') }}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <USwitch
              v-model="subtitleEnabled"
              :label="t('recorder.subtitleEnable')"
              :disabled="subtitleBusy"
            />
            <USelect
              v-model="whisperModel"
              :items="whisperModelOptions"
              class="w-64"
              :disabled="subtitleBusy"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-captions"
              :label="subtitleBusy ? stageText : t('recorder.subtitleGenerate')"
              color="primary"
              variant="subtle"
              :loading="subtitleBusy"
              :disabled="!hadAudio"
              @click="generateSubtitles"
            />
            <UButton
              v-if="srt"
              icon="i-lucide-download"
              :label="t('recorder.subtitleDownload')"
              color="neutral"
              variant="subtle"
              @click="downloadSrt"
            />
            <span v-if="srtSegments" class="text-xs text-muted">
              {{ t('recorder.subtitleSegments') }}: {{ srtSegments }}
            </span>
          </div>
          <UProgress
            v-if="subtitleBusy && subtitleStage === 'load'"
            :model-value="subtitlePercent"
            size="sm"
          />
          <p class="text-xs text-muted">
            {{ t('recorder.subtitleHint') }}
          </p>
          <pre
            v-if="srt"
            class="max-h-40 overflow-auto rounded-lg bg-elevated/60 p-2 text-xs text-muted"
          >
            {{ srt }}
          </pre>
        </div>
      </div>
    </UCard>
  </MediaDemoShell>
</template>
