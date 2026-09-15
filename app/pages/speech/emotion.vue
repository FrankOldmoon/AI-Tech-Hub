<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/**
 * 情绪识别：麦克风滑动窗口实时评估（攒够 3s 窗口即推理，之后每 1.5s 步进
 * 用最新窗口再推理，边录边出情绪时间线），或上传/示例文件整段分析。
 * 模型仅加载一次（classifier 单例），mic 与 file 模式共用。
 */
import { setupTransformersEnv, preferredDevice } from '~/utils/transformers'
import { humanError, mediaError } from '~/utils/errors'
import { fetchSample } from '~/utils/samples'
import { decodeTo16k } from '~/utils/audio'
import {
  createWindowState, pushSamples, latestWindow, enoughStep, windowTime,
  type WindowState
} from '~/utils/emotion-stream'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'emotion')!)

type EmotionResult = { label: string, score: number }

// ===== 输入 =====
const source = ref<'mic' | 'file'>('mic')
const recording = ref(false)
const recordSeconds = ref(0)
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')

// ===== 实时滑动窗口状态 =====
interface LiveWindow { at: number, result: EmotionResult[] }
const liveWindows = ref<LiveWindow[]>([])
const liveAnalyzing = ref(false)
const liveReady = ref(false) // 模型已就绪（首次推理前显示下载进度）
const liveError = ref<string | null>(null)
let win: WindowState = createWindowState()
let lastAnalyzedTotal = 0
let audioCtx: AudioContext | null = null
let liveStream: MediaStream | null = null
let processor: ScriptProcessorNode | null = null
let recordTimer: number | null = null

// ===== 推理 =====
const loading = ref(false)
const loadingText = ref('')
const progress = ref(0)
const error = ref<string | null>(null)
const result = ref<EmotionResult[]>([])
const device = ref(preferredDevice())
let cancelled = false

/** 模型单例：mic 实时与 file 整段分析共用，只在首次使用时加载 */
let classifierPromise: Promise<any> | null = null
function loadClassifier(): Promise<any> {
  if (classifierPromise) return classifierPromise
  classifierPromise = (async () => {
    // wav2vec2 情绪模型已随 `pnpm models:fetch` 预取到 .models/transformers/（见 scripts/fetch-models.mjs），
    // 默认走本地；缺失的文件才回退 /api/hf 远程
    await setupTransformersEnv()
    const { pipeline } = await import('@huggingface/transformers')
    const onProgress = (p: any) => {
      if (!p) return
      if (p.status === 'progress' && p.total) {
        progress.value = Math.round((p.loaded / p.total) * 100)
        loadingText.value = t('emotion.downloading', { progress: progress.value })
      } else if (p.status === 'ready' || p.status === 'done') {
        loadingText.value = t('emotion.loaded')
      }
    }
    const options = { device: device.value, progress_callback: onProgress }
    try {
      return await pipeline('audio-classification', 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX', options)
    } catch (e) {
      if (device.value === 'webgpu') {
        device.value = 'wasm'
        return await pipeline('audio-classification', 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX', { ...options, device: 'wasm' })
      }
      throw e
    }
  })()
  return classifierPromise
}

function mapOut(out: any): EmotionResult[] {
  return (Array.isArray(out) ? out : []).map((r: any) => ({
    label: r.label || '?',
    score: Number(r.score) || 0
  }))
}

// ---- 麦克风滑动窗口实时评估 ----
async function startRecording() {
  if (recording.value) return
  error.value = null
  liveError.value = null
  result.value = []
  liveWindows.value = []
  liveAnalyzing.value = false
  liveReady.value = false
  win = createWindowState()
  lastAnalyzedTotal = 0
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioCtx = new AudioContext({ sampleRate: 16000 })
    const src = audioCtx.createMediaStreamSource(liveStream)
    processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (e) => {
      if (!recording.value) return
      pushSamples(win, e.inputBuffer.getChannelData(0) as Float32Array)
      void maybeAnalyzeLive()
    }
    src.connect(processor)
    processor.connect(audioCtx.destination)
    recording.value = true
    // 预加载模型（并行下载，音频继续攒窗口）
    void loadClassifier().then(() => { liveReady.value = true }).catch((err) => {
      liveError.value = humanError(err, t)
    })
    recordTimer = window.setInterval(() => { recordSeconds.value++ }, 1000)
  } catch (e: any) {
    error.value = mediaError(e, t)
  }
}

async function maybeAnalyzeLive() {
  if (!recording.value || liveAnalyzing.value) return
  if (!enoughStep(win, lastAnalyzedTotal)) return
  liveAnalyzing.value = true
  try {
    const cls = await loadClassifier()
    if (!recording.value || cancelled) return
    const audio = latestWindow(win)
    // 时间轴取「本次被分析的窗口」的起点 + 已消费样本数：必须在 await 之前取快照，
    // 否则推理期间缓冲继续滚动，时间戳会偏到最新窗口上
    const at = Math.max(0, windowTime(win))
    const analyzedTotal = win.total
    const out = await cls(audio)
    if (cancelled) return
    liveWindows.value.push({ at, result: mapOut(out) })
    lastAnalyzedTotal = analyzedTotal
  } catch (e: any) {
    if (recording.value) liveError.value = humanError(e, t)
  } finally {
    liveAnalyzing.value = false
    if (recording.value && !cancelled) void maybeAnalyzeLive()
  }
}

function stopRecording() {
  recording.value = false
  if (processor) { processor.disconnect(); processor = null }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
  if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null }
  if (recordTimer !== null) { clearInterval(recordTimer); recordTimer = null }
  recordSeconds.value = 0
}

// ---- 文件模式（整段分析）----
function pickFile() { fileInput.value?.click() }

function setFile(f: File) {
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  result.value = []
  error.value = null
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) setFile(f)
}

async function useSample() {
  try {
    const f = await fetchSample('/samples/audio/speech.wav')
    setFile(f)
  } catch (e) {
    error.value = humanError(e, t)
  }
}

async function analyzeFile() {
  if (!audioFile.value || loading.value) return
  error.value = null
  result.value = []
  loading.value = true
  progress.value = 0
  loadingText.value = t('emotion.loadingModel')
  cancelled = false
  try {
    const cls = await loadClassifier()
    if (cancelled) return
    loadingText.value = t('emotion.analyzing')
    const audio = await decodeTo16k(audioFile.value)
    if (cancelled) return
    const out = await cls(audio)
    if (cancelled) return
    result.value = mapOut(out)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

function cancelAnalyze() {
  cancelled = true
  loading.value = false
}

onBeforeUnmount(() => {
  cancelled = true
  stopRecording()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})

// ---- 渲染派生 ----
const topResult = computed(() => result.value[0] || null)
const maxScore = computed(() => Math.max(...result.value.map(r => r.score), 0))
/** 实时最新窗口 top1 */
const liveTop = computed(() => {
  const last = liveWindows.value[liveWindows.value.length - 1]
  return last ? last.result[0] || null : null
})
const displayLoading = computed(() => loading.value || (recording.value && !liveReady.value))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner
      :loading="displayLoading"
      :error="error || liveError"
    >
      <template #input>
        <p class="text-sm text-muted mb-4">
          {{ t('emotion.hint') }}
        </p>
        <AudioSourceToggle v-model="source" />
        <div class="mt-4 space-y-3">
          <!-- 麦克风：滑动窗口实时评估 -->
          <template v-if="source === 'mic'">
            <div class="flex flex-wrap items-center gap-3">
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
                {{ liveAnalyzing ? t('emotion.liveAnalyzing') : t('emotion.liveListening') }}
              </span>
            </div>
            <!-- 实时窗口结果 -->
            <div
              v-if="liveWindows.length"
              class="space-y-3 pt-3"
            >
              <div
                v-if="liveTop"
                class="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
              >
                <UIcon
                  name="i-lucide-smile"
                  class="size-8 text-primary"
                />
                <div>
                  <p class="text-lg font-semibold text-highlighted">
                    {{ t(`emotion.label.${liveTop.label.toLowerCase()}`, {}, liveTop.label) }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ t('emotion.confidence') }}: {{ (liveTop.score * 100).toFixed(1) }}%（t: {{ liveWindows[liveWindows.length - 1]!.at.toFixed(1) }}s）
                  </p>
                </div>
              </div>
              <div
                v-if="liveWindows.length > 1"
                class="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-default p-2"
              >
                <div
                  v-for="(w, i) in liveWindows"
                  :key="i"
                  class="flex items-center justify-between gap-3 text-xs"
                >
                  <span class="text-muted tabular-nums">
                    {{ i + 1 }}. {{ t('emotion.windowAt', { s: w.at.toFixed(1) }) }}
                  </span>
                  <span class="text-highlighted">
                    {{ t(`emotion.label.${(w.result[0]?.label || '?').toLowerCase()}`, {}, w.result[0]?.label || '?') }}
                  </span>
                  <span class="tabular-nums text-muted">
                    {{ ((w.result[0]?.score || 0) * 100).toFixed(1) }}%
                  </span>
                </div>
              </div>
            </div>
          </template>

          <!-- 文件：上传 / 示例 / 整段分析 -->
          <template v-else>
            <div class="flex flex-wrap items-center gap-3">
              <input
                ref="fileInput"
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
                class="hidden"
                @change="onFileChange"
              >
              <UButton
                icon="i-lucide-upload"
                :label="audioFile ? audioFile.name : t('emotion.upload')"
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
                :label="t('emotion.analyze')"
                color="primary"
                :loading="loading"
                :disabled="!audioFile"
                @click="analyzeFile"
              />
            </div>
            <audio
              v-if="audioUrl"
              :src="audioUrl"
              controls
              class="w-full max-w-md pt-3"
            />
          </template>
        </div>
      </template>

      <!-- 模型加载进度（两种模式共用） -->
      <template #controls>
        <div
          v-if="displayLoading"
          class="flex items-center justify-between text-sm text-muted"
        >
          <span>{{ loadingText }}</span>
          <span class="tabular-nums">{{ progress }}%</span>
        </div>
        <UButton
          v-if="loading"
          icon="i-lucide-x"
          :label="t('emotion.cancel')"
          color="neutral"
          variant="subtle"
          @click="cancelAnalyze"
        />
      </template>

      <!-- 结果：文件模式整段结果 -->
      <template #result>
        <div
          v-if="source === 'file' && result.length"
          class="space-y-4"
        >
          <div
            v-if="topResult"
            class="flex items-center gap-3"
          >
            <UIcon
              name="i-lucide-smile"
              class="size-8 text-primary"
            />
            <div>
              <p class="text-lg font-semibold text-highlighted">
                {{ t(`emotion.label.${topResult.label.toLowerCase()}`, {}, topResult.label) }}
              </p>
              <p class="text-sm text-muted">
                {{ t('emotion.confidence') }}: {{ (topResult.score * 100).toFixed(1) }}%
              </p>
            </div>
          </div>
          <div class="space-y-2">
            <div
              v-for="r in result"
              :key="r.label"
              class="flex items-center gap-3"
            >
              <span class="w-24 shrink-0 text-sm text-muted truncate">
                {{ t(`emotion.label.${r.label.toLowerCase()}`, {}, r.label) }}
              </span>
              <div class="h-2 flex-1 bg-default rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary transition-all"
                  :style="{ width: maxScore > 0 ? (r.score / maxScore) * 100 + '%' : '0%' }"
                />
              </div>
              <span class="w-12 shrink-0 text-right text-xs tabular-nums text-muted">
                {{ (r.score * 100).toFixed(1) }}%
              </span>
            </div>
          </div>
        </div>
        <div
          v-else-if="source === 'file'"
          class="text-sm text-muted"
        >
          {{ t('emotion.noResult') }}
        </div>
      </template>
    </DemoRunner>
  </MediaDemoShell>
</template>
