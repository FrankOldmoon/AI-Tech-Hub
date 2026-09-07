<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import type { ParamSpec } from '~/utils/params'
import { mediaError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { decodeTo16k } from '~/utils/audio'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'pitch-detector')!)

const mode = ref<'mic' | 'file'>('mic')
const running = ref(false)
const error = ref<string | null>(null)
const freq = ref(0)
const note = ref('--')
const cents = ref(0)
const clarity = ref(0)
const history = ref<number[]>([])
const canvasRef = ref<HTMLCanvasElement>()

// 文件模式
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const analyzing = ref(false)
const analyzed = ref(false)
let cancelled = false

const specs = computed<ParamSpec[]>(() => [
  { key: 'threshold', label: t('pitch.threshold'), type: 'slider', default: 0.1, min: 0.01, max: 0.5, step: 0.01, help: t('pitch.thresholdHelp') },
  { key: 'minFreq', label: t('pitch.minFreq'), type: 'slider', default: 80, min: 40, max: 400, step: 10 },
  { key: 'maxFreq', label: t('pitch.maxFreq'), type: 'slider', default: 1200, min: 300, max: 2000, step: 50 }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let audioCtx: AudioContext | null = null
let stream: MediaStream | null = null
let processor: ScriptProcessorNode | null = null
let rafId: number | null = null

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** YIN 基频检测（CMND + 抛物线插值），返回 { freq, clarity } 或 null */
function yinPitch(buffer: Float32Array, sampleRate: number, threshold: number, minFreq: number, maxFreq: number): { freq: number, clarity: number } | null {
  const len = buffer.length
  const half = Math.floor(len / 2)
  if (half < 4) return null
  const cmnd = new Float32Array(half)
  cmnd[0] = 1
  let runningSum = 0
  for (let tau = 1; tau < half; tau++) {
    let diff = 0
    for (let i = 0; i < half; i++) {
      const d = buffer[i] - buffer[i + tau]
      diff += d * d
    }
    runningSum += diff
    cmnd[tau] = runningSum > 0 ? (diff * tau) / runningSum : 1
  }
  // 寻找第一个低于阈值的谷值
  let tau = -1
  for (let t = 2; t < half - 1; t++) {
    if (cmnd[t] < threshold && cmnd[t] < cmnd[t - 1] && cmnd[t] < cmnd[t + 1]) {
      tau = t
      break
    }
  }
  if (tau === -1) {
    // 回退：全局最小值
    let min = 1
    for (let t = 2; t < half - 1; t++) {
      if (cmnd[t] < min) { min = cmnd[t]; tau = t }
    }
    if (min > threshold) return null
  }
  // 抛物线插值精化周期
  const s0 = cmnd[tau - 1]
  const s1 = cmnd[tau]
  const s2 = cmnd[tau + 1]
  const denom = s0 - 2 * s1 + s2
  const shift = denom !== 0 ? (s0 - s2) / (2 * denom) : 0
  const period = tau + shift
  const f = sampleRate / period
  if (f < minFreq || f > maxFreq) return null
  return { freq: f, clarity: Math.max(0, Math.min(1, 1 - s1)) }
}

function midiToNote(midi: number): { name: string, octave: number } {
  const name = NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12]
  const octave = Math.floor(Math.round(midi) / 12) - 1
  return { name, octave }
}

function freqToNote(f: number): { note: string, cents: number } {
  const midi = 69 + 12 * Math.log2(f / 440)
  const rounded = Math.round(midi)
  const centsOffset = Math.round((midi - rounded) * 100)
  const { name, octave } = midiToNote(rounded)
  return { note: `${name}${octave}`, cents: centsOffset }
}

function render() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  // 网格
  ctx.strokeStyle = 'rgba(128,128,128,0.15)'
  ctx.lineWidth = 1
  const gridH = h / 4
  for (let i = 1; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(0, i * gridH)
    ctx.lineTo(w, i * gridH)
    ctx.stroke()
  }
  // 曲线
  const pts = history.value
  if (pts.length > 1) {
    const maxV = Math.max(...pts, 1)
    const minV = Math.min(...pts, 0)
    const range = maxV - minV || 1
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * w
      const y = h - ((pts[i]! - minV) / range) * (h - 8) - 4
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

function draw() {
  render()
  rafId = requestAnimationFrame(draw)
}

function processFrame(e: AudioProcessingEvent) {
  const data = e.inputBuffer.getChannelData(0)
  const sr = audioCtx?.sampleRate || 44100
  const threshold = Number(params.value.threshold)
  const minFreq = Number(params.value.minFreq)
  const maxFreq = Number(params.value.maxFreq)
  const res = yinPitch(data, sr, threshold, minFreq, maxFreq)
  if (res && res.clarity > 0.5) {
    freq.value = Math.round(res.freq)
    clarity.value = Math.round(res.clarity * 100)
    const { note: n, cents: c } = freqToNote(res.freq)
    note.value = n
    cents.value = c
    history.value.push(res.freq)
    if (history.value.length > 120) history.value.shift()
  }
}

async function start() {
  if (running.value) return
  error.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = processFrame
    source.connect(processor)
    processor.connect(audioCtx.destination)
    running.value = true
    history.value = []
    draw()
  } catch (e: any) {
    error.value = mediaError(e, t)
  }
}

function stop() {
  running.value = false
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  if (processor) { processor.disconnect(); processor = null }
  if (audioCtx) { audioCtx.close(); audioCtx = null }
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  freq.value = 0
  note.value = '--'
  cents.value = 0
  clarity.value = 0
}

// ===== 文件模式：整段 16k 滑动窗口 YIN 提调 =====
function pickFile() { fileInput.value?.click() }

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  audioFile.value = f
  error.value = null
  analyzed.value = false
  history.value = []
  note.value = '--'
  freq.value = 0
  cents.value = 0
}

async function useSample() {
  try {
    const res = await fetch('/samples/audio/speech.wav')
    const blob = await res.blob()
    const f = new File([blob], 'speech.wav', { type: 'audio/wav' })
    audioFile.value = f
    error.value = null
    analyzed.value = false
    history.value = []
    note.value = '--'
    freq.value = 0
    cents.value = 0
  } catch (err: any) {
    error.value = err?.message || String(err)
  }
}

/** 滑动窗口跑 YIN：2048 样本窗口 / 1024 步进，聚合整条音高轮廓 */
async function analyzeFile() {
  if (!audioFile.value || analyzing.value) return
  cancelled = false
  error.value = null
  history.value = []
  analyzed.value = false
  analyzing.value = true
  try {
    const samples = await decodeTo16k(audioFile.value)
    const threshold = Number(params.value.threshold)
    const minFreq = Number(params.value.minFreq)
    const maxFreq = Number(params.value.maxFreq)
    const win = 2048
    const hop = 1024
    const count = Math.max(0, Math.floor((samples.length - win) / hop) + 1)
    for (let i = 0; i < count; i++) {
      if (cancelled) return
      const slice = samples.slice(i * hop, i * hop + win)
      const res = yinPitch(slice, 16000, threshold, minFreq, maxFreq)
      if (res && res.clarity > 0.5) {
        history.value.push(res.freq)
        if (history.value.length > 120) history.value.shift()
      }
      // 让出主线程以便 UI 响应
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    // 汇总：以最后一个（或众数）有效值作为代表音
    summarize()
    analyzed.value = true
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    analyzing.value = false
    render()
  }
}

/** 从已采集的音高序列提取代表性结果 + 设置显示值 */
function summarize() {
  const pts = history.value
  if (!pts.length) return
  // 最常出现的（众数）作为代表性音，落在 ±2Hz 区间
  const buckets = new Map<number, number>()
  for (const p of pts) {
    const key = Math.round(p / 2) * 2
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  let bestKey: number = pts[0]!
  let bestCount = 0
  buckets.forEach((cnt, key) => { if (cnt > bestCount) { bestCount = cnt; bestKey = key } })
  const representative = bestKey
  freq.value = Math.round(representative)
  const { note: n, cents: c } = freqToNote(representative)
  note.value = n
  cents.value = c
  clarity.value = 100
}

function cancelAnalyze() {
  cancelled = true
  analyzing.value = false
}

// 切换到文件模式时停止麦克风
watch(mode, (m) => {
  if (m === 'file') stop()
})

onBeforeUnmount(stop)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner :error="error">
      <!-- 输入 -->
      <template #input>
        <AudioSourceToggle
          v-model="mode"
          class="mb-4"
        />

        <!-- 麦克风模式 -->
        <template v-if="mode === 'mic'">
          <p class="text-sm text-muted mb-4">
            {{ t('pitch.hint') }}
          </p>
        </template>

        <!-- 文件模式 -->
        <template v-else>
          <p class="text-sm text-muted mb-4">
            {{ t('speech.fileHint') }}
          </p>
          <div class="flex flex-wrap items-center gap-2 mb-4">
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
              :disabled="analyzing"
              @click="pickFile"
            />
            <UButton
              icon="i-lucide-flask-conical"
              :label="t('samples.trySample')"
              variant="soft"
              :disabled="analyzing"
              @click="useSample"
            />
          </div>
        </template>

        <DemoParams
          v-model="params"
          :specs="specs"
          :running="running || analyzing"
          :title="t('params.title')"
        />
      </template>

      <!-- 控件 -->
      <template #controls>
        <template v-if="mode === 'mic'">
          <UButton
            v-if="!running"
            icon="i-lucide-mic"
            :label="t('pitch.start')"
            color="primary"
            @click="start"
          />
          <UButton
            v-else
            icon="i-lucide-square"
            :label="t('pitch.stop')"
            color="error"
            variant="subtle"
            @click="stop"
          />
        </template>
        <template v-else>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('speech.analyzeFile')"
            color="primary"
            :loading="analyzing"
            :disabled="!audioFile"
            @click="analyzeFile"
          />
          <UButton
            v-if="analyzing"
            icon="i-lucide-x"
            :label="t('emotion.cancel')"
            color="neutral"
            variant="subtle"
            @click="cancelAnalyze"
          />
        </template>
      </template>

      <!-- 结果 -->
      <template #result>
        <div
          v-if="running || analyzed"
          class="space-y-4"
        >
          <div class="flex items-end gap-4">
            <div class="text-6xl font-bold tabular-nums text-highlighted">
              {{ note }}
            </div>
            <div class="pb-1 text-sm text-muted">
              {{ freq > 0 ? `${freq} Hz` : '...' }}
              <span
                v-if="cents !== 0"
                :class="cents > 0 ? 'text-amber-500' : 'text-sky-500'"
              >
                ({{ cents > 0 ? '+' : '' }}{{ cents }} ¢)
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2 text-sm text-muted">
            <span v-if="analyzed">{{ t('speech.fileDone') }}</span>
            <template v-else>
              <span>{{ t('pitch.clarity') }}: {{ clarity }}%</span>
              <span class="text-dimmed">·</span>
              <span>{{ t('pitch.recording') }}</span>
            </template>
          </div>
          <canvas
            ref="canvasRef"
            width="640"
            height="160"
            class="w-full h-40 rounded-lg border border-default bg-elevated/30"
          />
        </div>
        <div
          v-else
          class="text-sm text-muted"
        >
          {{ t('pitch.noResult') }}
        </div>
      </template>
    </DemoRunner>
  </MediaDemoShell>
</template>
