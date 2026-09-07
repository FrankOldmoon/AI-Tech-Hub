<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/** 哼唱转简谱：录音/上传 → YIN 提调 → 分音 → 显示简谱并可回放（纯 WebAudio 本端） */
import { humanError, mediaError } from '~/utils/errors'
import { decodeTo16k } from '~/utils/audio'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'hum-to-notes')!)

const source = ref<'mic' | 'file'>('file')
const recording = ref(false)
const recordSeconds = ref(0)
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')
const analyzing = ref(false)
const error = ref<string | null>(null)

let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null

interface Note { freq: number, name: string, syll: string, start: number, end: number }

const notes = ref<Note[]>([])
const played = ref(false)
const isPlaying = ref(false)

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALE = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si']
/** 以 C 大调（do=C）将频率量化为音名 */
function freqToName(f: number) {
  const midi = 69 + 12 * Math.log2(f / 440)
  const r = Math.round(midi)
  const name = NOTE_NAMES[((r % 12) + 12) % 12]!
  const oct = Math.floor(r / 12) - 1
  return { name: `${name}${oct}`, syll: SCALE[((r % 12) + 12) % 7]! }
}

/** YIN 基频检测（取自 pitch-detector） */
function yinPitch(buffer: Float32Array, sampleRate: number, threshold: number, minF: number, maxF: number) {
  const len = buffer.length
  const half = Math.floor(len / 2)
  if (half < 4) return null
  const cmnd = new Float32Array(half)
  cmnd[0] = 1
  let sum = 0
  for (let tau = 1; tau < half; tau++) {
    let diff = 0
    for (let i = 0; i < half; i++) { const d = buffer[i]! - buffer[i + tau]!; diff += d * d }
    sum += diff
    cmnd[tau] = sum > 0 ? (diff * tau) / sum : 1
  }
  let tau = -1
  for (let q = 2; q < half - 1; q++) {
    if (cmnd[q]! < threshold && cmnd[q]! < cmnd[q - 1]! && cmnd[q]! < cmnd[q + 1]!) { tau = q; break }
  }
  if (tau === -1) {
    let min = 1
    for (let q = 2; q < half - 1; q++) { if (cmnd[q]! < min) { min = cmnd[q]!; tau = q } }
    if (min > threshold) return null
  }
  const s0 = cmnd[tau - 1]!, s1 = cmnd[tau]!, s2 = cmnd[tau + 1]!
  const denom = s0 - 2 * s1 + s2
  const shift = denom !== 0 ? (s0 - s2) / (2 * denom) : 0
  const period = tau + shift
  const f = sampleRate / period
  if (f < minF || f > maxF) return null
  return { freq: f, clarity: Math.max(0, Math.min(1, 1 - s1)) }
}

/** 滑动窗口提调 + 分音（相邻帧落在同一半音内合并为一音） */
function extractNotes(samples: Float32Array): Note[] {
  const hop = 1024
  const win = 2048
  const threshold = 0.15
  const frames: Array<{ freq: number, t: number }> = []
  const count = Math.max(0, Math.floor((samples.length - win) / hop) + 1)
  for (let i = 0; i < count; i++) {
    const r = yinPitch(samples.slice(i * hop, i * hop + win) as Float32Array, 16000, threshold, 70, 900)
    if (r && r.clarity > 0.5) frames.push({ freq: r.freq, t: (i * hop) / 16000 })
  }
  const out: Note[] = []
  for (const f of frames) {
    const n = freqToName(f.freq)
    const semi = ((Math.round(69 + 12 * Math.log2(f.freq / 440)) % 12) + 12) % 12
    const last = out[out.length - 1]
    if (last && last.name === n.name) {
      last.end = f.t
    } else {
      const syll = SCALE[semi % 7]!
      out.push({ freq: f.freq, name: n.name, syll, start: f.t, end: f.t })
    }
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

// ---- 录音（麦克风）----
async function startRecording() {
  if (recording.value) return
  error.value = null
  notes.value = []
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(recordStream)
    recordChunks = []
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data) }
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
      const file = new File([blob], `hum-${Date.now()}.webm`, { type: blob.type })
      setFile(file)
      recordSeconds.value = 0
    }
    mediaRecorder.start()
    recording.value = true
    recordTimer = window.setInterval(() => { recordSeconds.value++ }, 1000)
  } catch (e: any) {
    error.value = mediaError(e, t)
  }
}

function stopRecording() {
  mediaRecorder?.stop()
  recordStream?.getTracks().forEach(t => t.stop())
  recordStream = null
  mediaRecorder = null
  recording.value = false
  if (recordTimer !== null) { clearInterval(recordTimer); recordTimer = null }
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

      <!-- 录音（麦克风） -->
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
          v-if="audioFile && !recording"
          class="text-sm text-muted"
        >{{ audioFile.name }}</span>
        <UButton
          v-if="audioFile && !recording"
          icon="i-lucide-wand-sparkles"
          :label="t('hum.analyze')"
          color="primary"
          :loading="analyzing"
          @click="analyze"
        />
      </div>

      <audio
        v-if="audioUrl"
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

      <!-- 结果 -->
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
