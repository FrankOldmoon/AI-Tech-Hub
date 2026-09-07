<script setup lang="ts">
/** 语音克隆（0-shot）：录/传参考音 → 转说话人嵌入，ChatterboxModel 低层 API 生成语音，纯本端 */
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import { mediaError } from '~/utils/errors'
import { setupTransformersEnv } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'voice-clone')!)

const text = ref('你好，这是一段用你的声音合成的语音。Hello, this is your cloned voice speaking.')
const device = ref<'webgpu' | 'wasm'>('webgpu')

// 参考音：录音 / 上传
const recording = ref(false)
const recordSeconds = ref(0)
const refFile = ref<File | null>(null)
const refUrl = ref('')
const fileInput = ref<HTMLInputElement>()
let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null

// 推理
const loading = ref(false)
const generating = ref(false)
const progress = ref(0)
const statusText = ref('')
const error = ref<string | null>(null)
const resultUrl = ref('')
let cancelled = false

const MODEL = 'onnx-community/chatterbox-ONNX'
// 仅 language_model 有量化分支；其余子图为 fp32
const DTYPE = {
  wasm: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4', conditional_decoder: 'fp32' },
  webgpu: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4f16', conditional_decoder: 'fp32' }
}

function pickFile() { fileInput.value?.click() }

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  setRef(f)
}

function setRef(f: File) {
  refFile.value = f
  if (refUrl.value) URL.revokeObjectURL(refUrl.value)
  refUrl.value = URL.createObjectURL(f)
  resultUrl.value = ''
  error.value = null
}

async function startRecording() {
  if (recording.value) return
  error.value = null
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(recordStream)
    recordChunks = []
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data) }
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
      setRef(new File([blob], `ref-${Date.now()}.webm`, { type: blob.type }))
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
  recordStream?.getTracks().forEach(tr => tr.stop())
  recordStream = null
  mediaRecorder = null
  recording.value = false
  if (recordTimer !== null) { clearInterval(recordTimer); recordTimer = null }
}

// 参考音频 → 48kHz 单声道 Float32Array，再编码为说话人嵌入
async function encodeSpeaker(file: File): Promise<{ encoder_hidden_states?: any } | any> {
  const buf = await file.arrayBuffer()
  const Ctor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const ctx = new Ctor()
  let out: Float32Array
  try {
    const dec = await ctx.decodeAudioData(buf)
    const src = dec.getChannelData(0)
    const targetRate = 48000
    if (dec.sampleRate === targetRate) out = src.slice()
    else {
      const ratio = dec.sampleRate / targetRate
      out = new Float32Array(Math.floor(src.length / ratio))
      for (let i = 0; i < out.length; i++) out[i] = src[Math.floor(i * ratio)] ?? 0
    }
  } finally {
    ctx.close()
  }
  const { Tensor } = await import('@huggingface/transformers')
  return await (model as any).encode_speech(new Tensor('float32', out, [1, out.length]))
}

// 模型加载与推理状态
let model: any = null
let processor: any = null

async function ensureModel() {
  if (model) return
  loading.value = true
  const { AutoProcessor, ChatterboxModel } = await import('@huggingface/transformers')
  const hasWebGpu = !!(navigator as any).gpu
  const useDevice = device.value === 'webgpu' && hasWebGpu ? 'webgpu' : 'wasm'
  const dtype = DTYPE[useDevice] as Record<string, string>
  const onProgress = (p: any) => {
    if (!p) return
    if (p.status === 'progress' && p.total) {
      progress.value = Math.round((p.loaded / p.total) * 100)
      statusText.value = t('emotion.downloading', { progress: progress.value })
    } else if (p.status === 'ready' || p.status === 'done') statusText.value = t('vcClone.loaded')
  }
  try {
    processor = await AutoProcessor.from_pretrained(MODEL)
    model = await ChatterboxModel.from_pretrained(MODEL, { device: useDevice, dtype: dtype as any, progress_callback: onProgress })
  } finally {
    loading.value = false
  }
  return model
}

/** Float32 音频 → WAV Blob */
function samplesToWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); wstr(8, 'WAVE')
  wstr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  wstr(36, 'data'); view.setUint32(40, samples.length * 2, true)
  let o = 44
  for (let i = 0; i < samples.length; i++) { view.setInt16(o, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true); o += 2 }
  return new Blob([buffer], { type: 'audio/wav' })
}

async function synthesize() {
  if (!refFile.value) { error.value = t('vcClone.noRef'); return }
  if (!text.value.trim()) { error.value = t('vcClone.noText'); return }
  error.value = null
  resultUrl.value = ''
  generating.value = true
  progress.value = 0
  statusText.value = t('vcClone.loadingModel')
  cancelled = false
  try {
    // 先初始化 transformers 环境（wasm 自托管 / /api/hf 代理）
    await setupTransformersEnv()
    await ensureModel()
    statusText.value = t('vcClone.encodingSpeaker')
    const speakerEmbeddings = await encodeSpeaker(refFile.value)
    if (cancelled) return
    statusText.value = t('vcClone.synthesizing')
    const inputs = await processor._call(text.value)
    const waveform = await model.generate({
      ...inputs,
      ...speakerEmbeddings,
      exaggeration: 0.5,
      max_new_tokens: 256
    })
    if (cancelled) return
    const wav = samplesToWav(Float32Array.from(waveform.data), 24000)
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = URL.createObjectURL(wav)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    generating.value = false
  }
}

function cancel() { cancelled = true; generating.value = false }

function download() {
  if (!resultUrl.value) return
  const a = document.createElement('a'); a.href = resultUrl.value; a.download = 'clone.wav'; a.click()
}

onBeforeUnmount(() => {
  cancelled = true
  stopRecording()
  if (refUrl.value) URL.revokeObjectURL(refUrl.value)
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="grid gap-4 lg:grid-cols-2">
      <!-- 参考音 -->
      <div class="rounded-xl border border-default bg-elevated/40 p-4 space-y-3">
        <p class="text-sm font-medium text-highlighted">
          {{ t('vcClone.refTitle') }}
        </p>
        <p class="text-xs text-muted">
          {{ t('vcClone.refHint') }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
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
          >
          <UButton
            icon="i-lucide-upload"
            :label="refFile ? refFile.name : t('vcClone.uploadRef')"
            variant="outline"
            @click="pickFile"
          />
        </div>
        <audio
          v-if="refUrl"
          :src="refUrl"
          controls
          class="w-full"
        />
      </div>

      <!-- 合成 -->
      <div class="rounded-xl border border-default bg-elevated/40 p-4 space-y-3">
        <p class="text-sm font-medium text-highlighted">
          {{ t('vcClone.synthTitle') }}
        </p>
        <UTextarea
          v-model="text"
          :rows="4"
          class="w-full"
        />
        <div class="flex items-center gap-2 text-xs text-muted">
          <span>{{ t('vcClone.device') }}: {{ device }}</span>
          <span>· {{ t('vcClone.modelHint') }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('vcClone.synthesize')"
            color="primary"
            :loading="generating || loading"
            :disabled="!refFile || !text.trim()"
            @click="synthesize"
          />
          <UButton
            v-if="generating"
            icon="i-lucide-x"
            :label="t('emotion.cancel')"
            color="neutral"
            variant="subtle"
            @click="cancel"
          />
          <UButton
            v-if="resultUrl"
            icon="i-lucide-download"
            :label="t('tts.download')"
            color="neutral"
            variant="subtle"
            @click="download"
          />
        </div>
        <div
          v-if="generating || loading"
          class="space-y-2"
        >
          <div class="flex items-center justify-between text-xs text-muted">
            <span>{{ statusText }}</span><span class="tabular-nums">{{ progress }}%</span>
          </div>
          <div class="h-2 w-full bg-default rounded-full overflow-hidden">
            <div
              class="h-full bg-primary transition-all"
              :style="{ width: progress + '%' }"
            />
          </div>
        </div>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="error"
      class="mt-4"
    />

    <div
      v-if="resultUrl"
      class="mt-4 space-y-2"
    >
      <p class="text-sm font-medium text-highlighted">
        {{ t('vcClone.result') }}
      </p>
      <audio
        :src="resultUrl"
        controls
        class="w-full"
      />
    </div>
  </MediaDemoShell>
</template>
