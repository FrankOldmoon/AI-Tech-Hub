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
const recording = ref(false)
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
let audioCtx: AudioContext | null = null
let liveStream: MediaStream | null = null
let processor: ScriptProcessorNode | null = null
let recordTimer: number | null = null
/** 录音开始时的 context 时钟，用于换算相对时间 */
let liveStartCtx = 0
/** 连续静音帧数（静音超过阈值则闭合当前音符） */
let silentFrames = 0
const LIVE_WIN = 2048

async function startRecording() {
  if (recording.value) return
  error.value = null
  notes.value = []
  liveFreq.value = 0
  liveNoteName.value = ''
  played.value = false
  silentFrames = 0
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    audioCtx = new AudioContext({ sampleRate: 16000 })
    liveStartCtx = audioCtx.currentTime
    const source = audioCtx.createMediaStreamSource(liveStream)
    processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const data = e.inputBuffer.getChannelData(0)
      const t = Math.max(0, e.playbackTime - liveStartCtx)
      const res = yinPitch(data.subarray(0, LIVE_WIN) as Float32Array, 16000, 0.15, 70, 900)
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
    source.connect(processor)
    processor.connect(audioCtx.destination)
    recording.value = true
    recordTimer = window.setInterval(() => { recordSeconds.value++ }, 1000)
  } catch (e: any) {
    error.value = mediaError(e, t)
  }
}

function stopRecording() {
  if (processor) { processor.disconnect(); processor = null }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
  if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null }
  recording.value = false
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
  stopRecording(); stopPlay()
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
          :label="t('emotion.recordStart')"
          color="primary"
          variant="soft"
          @click="startRecording"
        />
        <UButton
          v-else
          icon="i-lucide-square"
          :label="`${t('emotion.recordStop')} (${recordSeconds}s)`"
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
