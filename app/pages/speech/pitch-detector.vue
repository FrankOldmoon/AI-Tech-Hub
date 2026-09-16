<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import type { ParamSpec } from '~/utils/params'
import { mediaError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { decodeTo16k } from '~/utils/audio'
import { freqToNote, yinPitch } from '~/utils/pitch'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'pitch-detector')!)

const mode = ref<'mic' | 'file'>('mic')
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

/**
 * 采集改用公共 composable：getUserMedia + AudioContext + ScriptProcessor + 卸载 teardown
 * 原先这段样板在 audio-classifier / emotion / hum-to-notes / 本页各有一份，现在只此一处。
 * 采样率沿用 composable 默认的 16kHz：与本页文件模式（decodeTo16k）以及 hum-to-notes 同源，
 * 因此下面 yinPitch 的 sampleRate 直接复用这个常量，不再从 AudioContext 上现取。
 */
const MIC_RATE = 16000
const { running, start: startMic, stop: stopMic } = useMicStream()

let rafId: number | null = null

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
  // 只在采集期间续帧：停止后（含卸载时 composable 的自动停机）这一帧跑完就自然收尾，
  // 页面不必再自己取消 requestAnimationFrame
  rafId = running.value ? requestAnimationFrame(draw) : null
}

/** 逐帧回调：composable 已把麦克风切成 16kHz 单声道 4096 样本帧，这里只做音高检测与读数更新 */
function onFrame(frame: Float32Array) {
  const threshold = Number(params.value.threshold)
  const minFreq = Number(params.value.minFreq)
  const maxFreq = Number(params.value.maxFreq)
  const res = yinPitch(frame, MIC_RATE, threshold, minFreq, maxFreq)
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
  await startMic({
    sampleRate: MIC_RATE,
    onFrame,
    // 采集链路失败（权限被拒/无设备）由 composable 回调，此时它已把流与 context 收干净
    onError: (e) => { error.value = mediaError(e, t) }
  })
  if (!running.value) return
  history.value = []
  draw()
}

/** 停止采集并清空读数：关 processor / context / 流由 composable 负责，这里只管本页的显示状态 */
function stop() {
  stopMic()
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
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

// 切换到文件模式时停止麦克风（停机 + 卸载回收都由 useMicStream 负责，本页不再重复 teardown）
watch(mode, (m) => {
  if (m === 'file') stop()
})
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
            :label="t('speech.cancel')"
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
