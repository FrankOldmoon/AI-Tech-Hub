<script setup lang="ts">
import { setupTransformersEnv, preferredDevice } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'emotion')!)

// ===== 输入：录音 / 上传 =====
const recording = ref(false)
const recordSeconds = ref(0)
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')
let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null

// ===== 推理 =====
const loading = ref(false)
const loadingText = ref('')
const progress = ref(0)
const error = ref<string | null>(null)
const result = ref<Array<{ label: string, score: number }>>([])
const device = ref(preferredDevice())
let cancelled = false

const modelId = 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX'

function pickFile() { fileInput.value?.click() }

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  result.value = []
  error.value = null
}

async function startRecording() {
  if (recording.value) return
  error.value = null
  result.value = []
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(recordStream)
    recordChunks = []
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data) }
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
      const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })
      audioFile.value = file
      if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
      audioUrl.value = URL.createObjectURL(blob)
      result.value = []
      recordSeconds.value = 0
    }
    mediaRecorder.start()
    recording.value = true
    recordTimer = window.setInterval(() => { recordSeconds.value++ }, 1000)
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

function stopRecording() {
  mediaRecorder?.stop()
  recordStream?.getTracks().forEach((t) => t.stop())
  recordStream = null
  mediaRecorder = null
  recording.value = false
  if (recordTimer !== null) { clearInterval(recordTimer); recordTimer = null }
}

/** 解码音频并重采样到 16kHz 单声道 */
async function decodeTo16k(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer()
  const Ctx: any = window.AudioContext || (window as any).webkitAudioContext
  const ctx = new Ctx()
  try {
    const audio = await ctx.decodeAudioData(buf)
    const src = audio.getChannelData(0)
    if (audio.sampleRate === 16000) return src.slice()
    const ratio = audio.sampleRate / 16000
    const out = new Float32Array(Math.floor(src.length / ratio))
    for (let i = 0; i < out.length; i++) out[i] = src[Math.floor(i * ratio)]
    return out
  } finally {
    ctx.close()
  }
}

async function analyze() {
  if (!audioFile.value) {
    error.value = t('emotion.uploadRequired')
    return
  }
  error.value = null
  result.value = []
  loading.value = true
  progress.value = 0
  loadingText.value = t('emotion.loadingModel')
  cancelled = false
  try {
    const env = await setupTransformersEnv()
    const { pipeline } = await import('@huggingface/transformers')
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false // 该模型未放本地，避免 404 探测
    let classifier: any = null
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
      classifier = await pipeline('audio-classification', modelId, options)
    } catch (e) {
      if (device.value === 'webgpu') {
        device.value = 'wasm'
        classifier = await pipeline('audio-classification', modelId, { ...options, device: 'wasm' })
      } else throw e
    } finally {
      env.allowLocalModels = prevAllowLocal
    }
    loadingText.value = t('emotion.analyzing')
    const audio = await decodeTo16k(audioFile.value)
    if (cancelled) return
    const out: any = await classifier(audio)
    if (cancelled) return
    result.value = (Array.isArray(out) ? out : []).map((r: any) => ({
      label: r.label || '?',
      score: Number(r.score) || 0
    }))
  } catch (e: any) {
    error.value = e?.message || String(e)
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

const topResult = computed(() => result.value[0] || null)
const maxScore = computed(() => Math.max(...result.value.map((r) => r.score), 0))
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner :demo="demo" :loading="loading" :error="error">
        <!-- 输入 -->
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('emotion.hint') }}</p>
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
            <input
              ref="fileInput"
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
              class="hidden"
              @change="onFileChange"
            />
            <UButton
              icon="i-lucide-upload"
              :label="audioFile ? audioFile.name : t('emotion.upload')"
              variant="outline"
              @click="pickFile"
            />
          </div>
          <audio v-if="audioUrl" :src="audioUrl" controls class="mt-4 w-full max-w-md" />
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('emotion.analyze')"
            color="primary"
            :loading="loading"
            :disabled="!audioFile"
            @click="analyze"
          />
          <UButton
            v-if="loading"
            icon="i-lucide-x"
            :label="t('emotion.cancel')"
            color="neutral"
            variant="subtle"
            @click="cancelAnalyze"
          />
        </template>

        <!-- 结果 -->
        <template #result>
          <!-- 进度 -->
          <div v-if="loading" class="space-y-3">
            <div class="flex items-center justify-between text-sm text-muted">
              <span>{{ loadingText }}</span>
              <span class="tabular-nums">{{ progress }}%</span>
            </div>
            <div class="h-2 w-full bg-default rounded-full overflow-hidden">
              <div class="h-full bg-primary transition-all" :style="{ width: progress + '%' }" />
            </div>
          </div>

          <!-- 结果 -->
          <div v-else-if="result.length" class="space-y-4">
            <div v-if="topResult" class="flex items-center gap-3">
              <UIcon name="i-lucide-smile" class="size-8 text-primary" />
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
              <div v-for="r in result" :key="r.label" class="flex items-center gap-3">
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
          <div v-else class="text-sm text-muted">{{ t('emotion.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
