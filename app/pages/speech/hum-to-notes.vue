<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/**
 * 哼唱转简谱：麦克风实时识别（ScriptProcessor 逐帧 YIN → 半音量化 → 音符合并，
 * 边哼边出简谱），或上传文件整段分析（纯 WebAudio 本端）
 */
import { humanError, mediaError } from '~/utils/errors'
import { decodeTo16k } from '~/utils/audio'
import { freqToName, mergeLivePitch, yinPitch, type PitchNote } from '~/utils/pitch'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'hum-to-notes')!)

const source = ref<'mic' | 'file'>('mic')
const recordSeconds = ref(0)
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')
const analyzing = ref(false)
const error = ref<string | null>(null)

const notes = ref<PitchNote[]>([])
/** 实时模式下当前检测到的音高（用于边哼边反馈） */
const liveFreq = ref(0)
const liveNoteName = ref('')
const played = ref(false)
const isPlaying = ref(false)

/** 滑动窗口提调 + 分音（相邻帧落在同一半音内合并为一音） */
function extractNotes(samples: Float32Array): PitchNote[] {
  const hop = 1024
  const win = 2048
  const threshold = 0.15
  const frames: Array<{ freq: number, t: number }> = []
  const count = Math.max(0, Math.floor((samples.length - win) / hop) + 1)
  for (let i = 0; i < count; i++) {
    const r = yinPitch(samples.slice(i * hop, i * hop + win) as Float32Array, 16000, threshold, 70, 900)
    if (r && r.clarity > 0.5) frames.push({ freq: r.freq, t: (i * hop) / 16000 })
  }
  const out: PitchNote[] = []
  for (const f of frames) {
    mergeLivePitch(out, f, f.t)
  }
  return out
}

async function analyze() {
  if (!audioFile.value || analyzing.value) return
  error.value = null
  notes.value = []
  played.value = false
  analyzing.value = true
  try {
    const samples = await decodeTo16k(audioFile.value)
    notes.value = extractNotes(samples as Float32Array)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    analyzing.value = false
  }
}

// ---- 麦克风实时识别（边哼边出简谱）----
// 采集链（getUserMedia + AudioContext + ScriptProcessor + 卸载 teardown）改用公共 composable：
// 原先 audio-classifier / emotion / pitch-detector / 本页各有一份逐行相同的样板。
// 它的 running 正是模板里的「录音中」标志，直接改名复用，避免再维护一份会被写乱的本地状态。
const { running: recording, start: startMic, stop: stopMic } = useMicStream()

let recordTimer: number | null = null
/** 录音起始时刻（挂钟毫秒），用于把帧换算成相对时间 */
let liveStartMs = 0
/** 连续静音帧数（静音超过阈值则闭合当前音符） */
let silentFrames = 0
const LIVE_WIN = 2048

/**
 * 逐帧回调：composable 已切好 16kHz 单声道 4096 样本帧，算法一行不动。
 * 原实现用 AudioProcessingEvent.playbackTime 减 context 起始时刻来标记帧时间，而 composable
 * 的帧回调只给样本、不带时间戳，所以这里改用挂钟时间（并以第一帧为零点，等价于原实现
 * 「建完 context 才取 currentTime」）。音符起止时间只用于相对比较与回放排期，相差在毫秒级，
 * 简谱切分结果不受影响。
 */
function onFrame(frame: Float32Array) {
  if (liveStartMs === 0) liveStartMs = performance.now()
  const t = Math.max(0, (performance.now() - liveStartMs) / 1000)
  const res = yinPitch(frame.subarray(0, LIVE_WIN) as Float32Array, 16000, 0.15, 70, 900)
  const last = notes.value[notes.value.length - 1]
  if (res && res.clarity > 0.5) {
    silentFrames = 0
    liveFreq.value = Math.round(res.freq)
    const n = freqToName(res.freq)
    liveNoteName.value = `${n.syll} (${n.name})`
    if (last && last.name === n.name) {
      last.end = t
    } else {
      // 上一音已静音闭合，或直接开新音
      notes.value.push({ freq: res.freq, name: n.name, syll: n.syll, start: t, end: t })
    }
  } else if (last) {
    silentFrames++
    if (silentFrames >= 6) {
      last.end = t
      silentFrames = 0
      liveNoteName.value = ''
    }
  }
}

async function startRecording() {
  if (recording.value) return
  error.value = null
  notes.value = []
  liveFreq.value = 0
  liveNoteName.value = ''
  played.value = false
  silentFrames = 0
  liveStartMs = 0
  await startMic({
    // 显式 16kHz：本页吃的是 YIN 在 70–900Hz 的分析结果，与文件模式的 decodeTo16k 同源
    sampleRate: 16000,
    onFrame,
    // 采集失败（权限/设备）由 composable 回调，此时它已停掉流、关掉 context
    onError: (e) => { error.value = mediaError(e, t) }
  })
  if (!recording.value) return
  recordTimer = window.setInterval(() => { recordSeconds.value++ }, 1000)
}

/** 结束录音：采集链的 teardown 由 composable 负责，这里只收本页自己的秒表与显示状态 */
function stopRecording() {
  stopMic()
  if (recordTimer !== null) { clearInterval(recordTimer); recordTimer = null }
  recordSeconds.value = 0
  liveFreq.value = 0
  liveNoteName.value = ''
  // 收尾：丢弃过短的首音（启动噪声）
  notes.value = notes.value.filter(n => n.end - n.start > 0.12)
}

function setFile(f: File) {
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  notes.value = []
  played.value = false
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) setFile(f)
}

async function useSample() {
  try {
    const res = await fetch('/samples/audio/speech.wav')
    setFile(new File([await res.blob()], 'speech.wav', { type: 'audio/wav' }))
  } catch (e: any) {
    error.value = humanError(e, t)
  }
}

function pickFile() { fileInput.value?.click() }

// ---- 回放（三角波逐音播放）----
let playCtx: AudioContext | null = null
let playTimer: number | null = null

function playNotes() {
  if (!notes.value.length || isPlaying.value) return
  isPlaying.value = true
  played.value = true
  playCtx = new AudioContext()
  const now = playCtx.currentTime + 0.05
  for (const n of notes.value) {
    const t0 = now + n.start
    const dur = Math.max(0.08, n.end - n.start)
    const osc = playCtx.createOscillator()
    const gain = playCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = n.freq
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(0.5, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    osc.connect(gain).connect(playCtx.destination)
    osc.start(t0); osc.stop(t0 + dur + 0.02)
  }
  const totalDur = now + (notes.value[notes.value.length - 1]?.end ?? 0) + 1
  playTimer = window.setTimeout(() => { stopPlay() }, (totalDur - now + 0.2) * 1000)
}

function stopPlay() {
  isPlaying.value = false
  if (playTimer !== null) { clearTimeout(playTimer); playTimer = null }
  if (playCtx) { playCtx.close().catch(() => {}); playCtx = null }
}

onBeforeUnmount(() => {
  // 采集链的 teardown 由 useMicStream 的卸载钩子自行完成（此处不再重复停流/关 context）；
  // 只收拾本页自己的三样东西：秒表（不清会留下一直在跑的 setInterval）、回放、objectURL
  if (recordTimer !== null) { clearInterval(recordTimer); recordTimer = null }
  stopPlay()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4">
      <!-- 来源 -->
      <AudioSourceToggle v-model="source" />

      <!-- 文件/示例 -->
      <div
        v-if="source === 'file'"
        class="flex flex-wrap items-center gap-2"
      >
        <input
          ref="fileInput"
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
          class="hidden"
          @change="onFileChange"
        >
        <UButton
          icon="i-lucide-upload"
          :label="audioFile ? audioFile.name : t('speech.uploadAudio')"
          variant="outline"
          @click="pickFile"
        />
        <UButton
          icon="i-lucide-flask-conical"
          :label="t('samples.trySample')"
          variant="soft"
          @click="useSample"
        />
        <UButton
          icon="i-lucide-wand-sparkles"
          :label="t('speech.analyzeFile')"
          color="primary"
          :loading="analyzing"
          :disabled="!audioFile"
          @click="analyze"
        />
      </div>

      <!-- 录音（麦克风，实时识别） -->
      <div
        v-else
        class="flex flex-wrap items-center gap-2"
      >
        <UButton
          v-if="!recording"
          icon="i-lucide-mic"
          :label="t('speech.recordStart')"
          color="primary"
          variant="soft"
          @click="startRecording"
        />
        <UButton
          v-else
          icon="i-lucide-square"
          :label="`${t('speech.recordStop')} (${recordSeconds}s)`"
          color="error"
          variant="subtle"
          @click="stopRecording"
        />
        <span
          v-if="recording"
          class="text-sm text-muted"
        >
          {{ liveNoteName ? t('hum.livePitch', { note: liveNoteName }) : t('hum.liveListening') }}
        </span>
      </div>

      <audio
        v-if="audioUrl && source === 'file'"
        :src="audioUrl"
        controls
        class="w-full max-w-md"
      />
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <!-- 结果（麦克风模式边哼边实时刷新） -->
      <div
        v-if="notes.length"
        class="space-y-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-play"
            :label="isPlaying ? t('hum.stopping') : t('hum.play')"
            color="primary"
            :disabled="isPlaying"
            @click="playNotes"
          />
          <UButton
            v-if="isPlaying"
            icon="i-lucide-square"
            :label="t('vc.off')"
            color="neutral"
            variant="subtle"
            @click="stopPlay"
          />
          <span class="text-sm text-muted">{{ t('hum.count', { n: notes.length }) }}</span>
        </div>

        <!-- 简谱花条 -->
        <div class="flex flex-wrap gap-2 items-end">
          <div
            v-for="(n, i) in notes"
            :key="i"
            class="flex flex-col items-center gap-1"
          >
            <span class="text-xs text-muted tabular-nums">{{ n.freq.toFixed(0) }}Hz</span>
            <div
              class="w-5 rounded-t bg-primary/70"
              :style="{ height: `${(i % 4) * 8 + 16}px` }"
            />
            <span class="text-sm font-semibold text-highlighted">{{ n.syll }}</span>
            <span class="text-[10px] text-dimmed">{{ n.name }}</span>
          </div>
        </div>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        {{ t('hum.noResult') }}
      </p>
    </div>
  </MediaDemoShell>
</template>
