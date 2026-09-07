<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import type { ParamSpec } from '~/utils/params'
import { humanError, mediaError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'
import { decodeTo16k } from '~/utils/audio'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audio-classifier')!)

const mode = ref<'mic' | 'file'>('mic')
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const topResult = ref<{ name: string, score: number } | null>(null)
const history = ref<Array<{ name: string, score: number, time: string }>>([])

// 文件模式
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')
const analyzing = ref(false)
const fileProgress = ref(0)
let cancelled = false

const specs = computed<ParamSpec[]>(() => [
  { key: 'maxResults', label: t('params.maxResults'), type: 'slider', default: 5, min: 1, max: 20, step: 1 },
  { key: 'scoreThreshold', label: t('params.scoreThreshold'), type: 'slider', default: 0, min: 0, max: 1, step: 0.05 }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let classifier: any = null
let audioCtx: AudioContext | null = null
let stream: MediaStream | null = null
let source: MediaStreamAudioSourceNode | null = null
let processor: ScriptProcessorNode | null = null

async function ensure() {
  if (classifier) return classifier
  loading.value = true
  error.value = null
  try {
    const { FilesetResolver, AudioClassifier } = await import('@mediapipe/tasks-audio')
    const audio = await FilesetResolver.forAudioTasks(mediapipeWasm.audio)
    classifier = await AudioClassifier.createFromOptions(audio, {
      baseOptions: { modelAssetPath: mediapipeModels.audioClassifier },
      maxResults: Number(params.value.maxResults),
      scoreThreshold: Number(params.value.scoreThreshold)
    })
    classifier.setDefaultSampleRate(16000)
  } catch (e: any) {
    // 资源加载失败时 e 可能是 Event 对象（无 message），给出友好提示
    error.value = e instanceof Event
      ? '模型/WASM 加载失败，请检查网络或稍后重试'
      : (e?.message || String(e))
  } finally {
    loading.value = false
  }
  return classifier
}

// 参数变更 → 实时 setOptions
watch(params, async (vals) => {
  if (classifier) {
    try {
      await classifier.setOptions({
        maxResults: Number(vals.maxResults),
        scoreThreshold: Number(vals.scoreThreshold)
      })
    } catch (e: any) {
      error.value = humanError(e, t)
    }
  }
}, { deep: true })

async function start() {
  const c = await ensure()
  if (!c) return
  stop()
  error.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    // YAMNet 期望 16kHz 单声道
    audioCtx = new AudioContext({ sampleRate: 16000 })
    source = audioCtx.createMediaStreamSource(stream)
    // ScriptProcessorNode 已 deprecated 但仍可用；4096 样本缓冲
    processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!classifier) return
      const input = e.inputBuffer.getChannelData(0)
      try {
        const results = classifier.classify(input, 16000)
        const cats = results?.[0]?.classifications?.[0]?.categories
        if (cats?.length) {
          const top = cats[0]
          topResult.value = { name: top.categoryName, score: top.score }
          // 记录新类别（与上一条不同时）
          const last = history.value[0]
          if (!last || last.name !== top.categoryName) {
            history.value.unshift({
              name: top.categoryName,
              score: top.score,
              time: new Date().toLocaleTimeString()
            })
            if (history.value.length > 20) history.value.pop()
          }
        }
      } catch (e: any) {
        error.value = mediaError(e, t)
        stop()
      }
    }
    source.connect(processor)
    processor.connect(audioCtx.destination)
    running.value = true
  } catch (e: any) {
    error.value = humanError(e, t)
    stop()
  }
}

function stop() {
  running.value = false
  if (processor) { processor.disconnect(); processor.onaudioprocess = null; processor = null }
  if (source) { source.disconnect(); source = null }
  if (audioCtx) { audioCtx.close(); audioCtx = null }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
}

// ===== 文件模式：整段 16k 滑动窗口 classify =====
function pickFile() { fileInput.value?.click() }

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  topResult.value = null
  history.value = []
  error.value = null
}

async function useSample() {
  try {
    const res = await fetch('/samples/audio/speech.wav')
    const blob = await res.blob()
    const f = new File([blob], 'speech.wav', { type: 'audio/wav' })
    audioFile.value = f
    if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
    audioUrl.value = URL.createObjectURL(f)
    topResult.value = null
    history.value = []
    error.value = null
  } catch (err: any) {
    error.value = err?.message || String(err)
  }
}

/** 全文件滑动窗口分类：1s 窗口 / 0.5s 步进，逐段更新结果与历史 */
async function analyzeFile() {
  const c = await ensure()
  if (!c || !audioFile.value) return
  if (analyzing.value) return
  cancelled = false
  error.value = null
  topResult.value = null
  history.value = []
  analyzing.value = true
  fileProgress.value = 0
  try {
    const samples = await decodeTo16k(audioFile.value)
    const win = 16000 // 1s @ 16k
    const hop = win / 2
    const total = Math.floor((samples.length - win) / hop) + 1
    for (let i = 0; i < total; i++) {
      if (cancelled) return
      const start = i * hop
      const slice = samples.slice(start, start + win)
      const results = c.classify(slice, 16000)
      const cats = results?.[0]?.classifications?.[0]?.categories
      if (cats?.length) {
        const top = cats[0]
        topResult.value = { name: top.categoryName, score: top.score }
        const last = history.value[0]
        if (!last || last.name !== top.categoryName) {
          history.value.unshift({
            name: top.categoryName,
            score: top.score,
            time: new Date().toLocaleTimeString()
          })
          if (history.value.length > 20) history.value.pop()
        }
      }
      fileProgress.value = Math.round(((i + 1) / total) * 100)
      // 让出主线程，保持进度条/结果实时刷新
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    fileProgress.value = 100
  } catch (err: any) {
    error.value = err instanceof Event
      ? '模型/WASM 加载失败，请检查网络或稍后重试'
      : (err?.message || String(err))
  } finally {
    analyzing.value = false
  }
}

function cancelAnalyze() {
  cancelled = true
  analyzing.value = false
}

// 切换到文件模式时停止麦克风
watch(mode, (m) => {
  if (m === 'file') stop()
})

onBeforeUnmount(() => {
  stop()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4">
      <!-- 来源切换 -->
      <AudioSourceToggle v-model="mode" />

      <!-- 麦克风模式 -->
      <template v-if="mode === 'mic'">
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="!running"
            icon="i-lucide-mic"
            :label="t('asr.start')"
            color="primary"
            :loading="loading"
            @click="start"
          />
          <UButton
            v-else
            icon="i-lucide-square"
            :label="t('asr.stop')"
            color="error"
            variant="subtle"
            @click="stop"
          />
          <span
            v-if="running"
            class="text-sm text-muted"
          >{{ t('asr.listening') }}…</span>
        </div>
      </template>

      <!-- 文件模式 -->
      <template v-else>
        <p class="text-sm text-muted">
          {{ t('speech.fileHint') }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
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
        </div>
        <audio
          v-if="audioUrl"
          :src="audioUrl"
          controls
          class="w-full max-w-md"
        />
        <!-- 分析进度 -->
        <div
          v-if="analyzing"
          class="space-y-2"
        >
          <div class="h-2 w-full bg-default rounded-full overflow-hidden">
            <div
              class="h-full bg-primary transition-all"
              :style="{ width: fileProgress + '%' }"
            />
          </div>
          <p class="text-xs text-dimmed tabular-nums">
            {{ fileProgress }}%
          </p>
        </div>
      </template>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <!-- 可调参数 -->
      <DemoParams
        v-model="params"
        :specs="specs"
        :running="running"
      />

      <!-- 当前结果 -->
      <UCard>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-muted">{{ t('demo.result') }}</span>
          <template v-if="topResult">
            <span class="text-xl font-bold text-highlighted">{{ topResult.name }}</span>
            <span class="text-sm text-muted ms-2">{{ Math.round(topResult.score * 100) }}%</span>
          </template>
          <span
            v-else
            class="text-sm text-muted"
          >—</span>
        </div>
      </UCard>

      <!-- 历史 -->
      <UCard v-if="history.length">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon
              name="i-lucide-history"
              class="size-4"
            />
            {{ t('mp.history') }}
          </div>
        </template>
        <div class="space-y-1 max-h-64 overflow-auto">
          <div
            v-for="(h, i) in history"
            :key="i"
            class="flex justify-between text-sm"
          >
            <span>{{ h.name }}</span>
            <span class="text-muted">{{ h.time }} · {{ Math.round(h.score * 100) }}%</span>
          </div>
        </div>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
