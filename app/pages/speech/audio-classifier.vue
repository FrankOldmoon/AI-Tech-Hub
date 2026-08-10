<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audio-classifier')!)

const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const topResult = ref<{ name: string, score: number } | null>(null)
const history = ref<Array<{ name: string, score: number, time: string }>>([])

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
    error.value = e?.message || String(e)
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
      error.value = e?.message || String(e)
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
        error.value = e?.message || String(e)
        stop()
      }
    }
    source.connect(processor)
    processor.connect(audioCtx.destination)
    running.value = true
  } catch (e: any) {
    error.value = e?.message || String(e)
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

onBeforeUnmount(() => stop())
</script>

<template>
  <MediaDemoShell :demo="demo">
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
      <span v-if="running" class="text-sm text-muted">{{ t('asr.listening') }}…</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="running" />

    <!-- 当前结果 -->
    <UCard>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted">{{ t('demo.result') }}</span>
        <template v-if="topResult">
          <span class="text-xl font-bold text-highlighted">{{ topResult.name }}</span>
          <span class="text-sm text-muted ms-2">{{ Math.round(topResult.score * 100) }}%</span>
        </template>
        <span v-else class="text-sm text-muted">—</span>
      </div>
    </UCard>

    <!-- 历史 -->
    <UCard v-if="history.length">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-history" class="size-4" />
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
  </MediaDemoShell>
</template>
