<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { mediaError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'pitch-detector')!)

const running = ref(false)
const error = ref<string | null>(null)
const freq = ref(0)
const note = ref('--')
const cents = ref(0)
const clarity = ref(0)
const history = ref<number[]>([])
const canvasRef = ref<HTMLCanvasElement>()

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

function draw() {
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
      const y = h - ((pts[i] - minV) / range) * (h - 8) - 4
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
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
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  freq.value = 0
  note.value = '--'
  cents.value = 0
  clarity.value = 0
}

onBeforeUnmount(stop)
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner :demo="demo" :error="error">
        <!-- 输入 -->
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('pitch.hint') }}</p>
          <DemoParams v-model="params" :specs="specs" :running="running" :title="t('params.title')" />
        </template>

        <!-- 控件 -->
        <template #controls>
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

        <!-- 结果 -->
        <template #result>
          <div v-if="running" class="space-y-4">
            <div class="flex items-end gap-4">
              <div class="text-6xl font-bold tabular-nums text-highlighted">{{ note }}</div>
              <div class="pb-1 text-sm text-muted">
                {{ freq > 0 ? `${freq} Hz` : '...' }}
                <span v-if="cents !== 0" :class="cents > 0 ? 'text-amber-500' : 'text-sky-500'">
                  ({{ cents > 0 ? '+' : '' }}{{ cents }} ¢)
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 text-sm text-muted">
              <span>{{ t('pitch.clarity') }}: {{ clarity }}%</span>
              <span class="text-dimmed">·</span>
              <span>{{ t('pitch.recording') }}</span>
            </div>
            <canvas
              ref="canvasRef"
              width="640"
              height="160"
              class="w-full h-40 rounded-lg border border-default bg-elevated/30"
            />
          </div>
          <div v-else class="text-sm text-muted">{{ t('pitch.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
