<script setup lang="ts">
/**
 * 语音翻译机：录音/上传 → whisper 转写 → opus-mt 翻译 → Kokoro 用目标语言音色朗读。
 * 三级流水线全部在浏览器本地跑（模型来自 .models/transformers/），数据不出设备。
 * 中间结果（识别文本 / 译文）都展示出来，便于讲「级联式语音翻译」的误差累积。
 */
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { humanError, mediaError } from '~/utils/errors'
import { decodeTo16k } from '~/utils/audio'
import { fetchSample } from '~/utils/samples'
import { preferredDevice, setupTransformersEnv } from '~/utils/transformers'
import { kokoroSynthesize, type KokoroProgress } from '~/utils/kokoro'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'speech-translate')!)

type Dir = 'zh-en' | 'en-zh'

/** 每个方向绑定的 ASR 语言 / 翻译模型 / 朗读音色（Kokoro voice id） */
const DIRECTIONS: Record<Dir, { asrLang: string, mt: string, voice: string }> = {
  'zh-en': { asrLang: 'chinese', mt: 'Xenova/opus-mt-zh-en', voice: 'af_heart' },
  'en-zh': { asrLang: 'english', mt: 'Xenova/opus-mt-en-zh', voice: 'zf_xiaoxiao' }
}

const dir = ref<Dir>('zh-en')
const dirItems = computed(() => [
  { key: 'zh-en' as const, label: t('st.zhToEn'), icon: 'i-lucide-arrow-right-left' },
  { key: 'en-zh' as const, label: t('st.enToZh'), icon: 'i-lucide-arrow-left-right' }
])

// ===== 输入 =====
const source = ref<'mic' | 'file'>('mic')
const recording = ref(false)
const recordSeconds = ref(0)
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')
let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null

// ===== 参数 =====
const specs = computed<ParamSpec[]>(() => [
  {
    key: 'asrModel',
    label: t('st.asrModel'),
    type: 'select',
    default: 'Xenova/whisper-base',
    options: [
      { label: 'whisper-tiny · ~206MB', value: 'Xenova/whisper-tiny' },
      { label: 'whisper-base · ~368MB', value: 'Xenova/whisper-base' },
      { label: 'whisper-small · ~1.2GB', value: 'Xenova/whisper-small' }
    ],
    help: t('st.asrModelHelp')
  },
  { key: 'speed', label: t('tts.speed'), type: 'slider', default: 1, min: 0.5, max: 2, step: 0.1, help: t('tts.speedHelp') }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

// ===== 运行状态 =====
const running = ref(false)
const step = ref<'idle' | 'asr' | 'mt' | 'tts'>('idle')
const statusText = ref('')
const progress = ref(0)
const error = ref<string | null>(null)
const device = ref(preferredDevice())
let cancelled = false

// ===== 结果 =====
const sourceText = ref('')
const translatedText = ref('')
const resultUrl = ref('')
const timings = ref<{ asr: number, mt: number, tts: number } | null>(null)

function revokeResult() {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
}

function pickFile() { fileInput.value?.click() }

function setFile(f: File) {
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  sourceText.value = ''
  translatedText.value = ''
  timings.value = null
  revokeResult()
  error.value = null
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) setFile(f)
}

async function useSample() {
  try {
    // 中文方向用中文示例音，反之用英文示例音
    setFile(await fetchSample(dir.value === 'zh-en' ? '/samples/audio/speech-zh.wav' : '/samples/audio/speech.wav'))
  } catch (e) {
    error.value = humanError(e, t)
  }
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
      setFile(new File([blob], `speech-${Date.now()}.webm`, { type: blob.type }))
      recordSeconds.value = 0
    }
    mediaRecorder.start()
    recording.value = true
    recordTimer = window.setInterval(() => { recordSeconds.value++ }, 1000)
  } catch (e: unknown) {
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

function onKokoroProgress(p: KokoroProgress) {
  if (typeof p.progress === 'number') progress.value = Math.round(p.progress)
  statusText.value = p.file ? `${p.status} · ${String(p.file).split('/').pop()}` : p.status
}

/** ① 语音识别 */
async function transcribe(audio: Float32Array): Promise<string> {
  step.value = 'asr'
  statusText.value = t('st.asrLoading')
  progress.value = 0
  await setupTransformersEnv()
  const { pipeline } = await import('@huggingface/transformers')
  const model = String(params.value.asrModel)
  const onProgress = (p: any) => {
    if (!p) return
    if (p.status === 'progress' && p.total) progress.value = Math.round((p.loaded / p.total) * 100)
    if (p.file) statusText.value = `${t('st.asrLoading')} · ${String(p.file).split('/').pop()}`
  }
  const options = { dtype: 'q8', device: device.value, progress_callback: onProgress }
  let asr: any = null
  try {
    asr = await pipeline('automatic-speech-recognition', model, options)
  } catch (e) {
    // WebGPU 失败回退 WASM
    if (device.value === 'webgpu') {
      device.value = 'wasm'
      asr = await pipeline('automatic-speech-recognition', model, { ...options, device: 'wasm' })
    } else {
      throw e
    }
  }
  const out = await asr(audio, { language: DIRECTIONS[dir.value].asrLang, task: 'transcribe' })
  return (out?.text || '').trim()
}

/** ② 机器翻译（Marian / opus-mt，走 text2text-generation） */
async function translate(text: string): Promise<string> {
  step.value = 'mt'
  statusText.value = t('st.mtLoading')
  progress.value = 0
  const { pipeline } = await import('@huggingface/transformers')
  const model = DIRECTIONS[dir.value].mt
  const options = { dtype: 'q8', device: device.value }
  let mt: any = null
  try {
    mt = await pipeline('text2text-generation', model, options)
  } catch (e) {
    // 自回归解码在部分 WebGPU 后端不稳，回退 WASM
    if (device.value === 'webgpu') {
      device.value = 'wasm'
      mt = await pipeline('text2text-generation', model, { ...options, device: 'wasm' })
    } else {
      throw e
    }
  }
  const out = await mt(text, { max_new_tokens: 256 })
  return (out?.[0]?.generated_text || '').trim()
}

/** ③ 语音合成（Kokoro，用目标语言音色） */
async function speak(text: string): Promise<void> {
  step.value = 'tts'
  statusText.value = t('st.ttsLoading')
  progress.value = 0
  const { blob, device: ttsDevice } = await kokoroSynthesize(
    text,
    DIRECTIONS[dir.value].voice,
    Number(params.value.speed) || 1,
    onKokoroProgress
  )
  revokeResult()
  resultUrl.value = URL.createObjectURL(blob)
  device.value = ttsDevice
}

async function run() {
  if (!audioFile.value) { error.value = t('st.noAudio'); return }
  error.value = null
  sourceText.value = ''
  translatedText.value = ''
  revokeResult()
  running.value = true
  cancelled = false
  try {
    const audio = await decodeTo16k(audioFile.value)
    if (cancelled) return

    const t0 = performance.now()
    const recognized = await transcribe(audio)
    if (cancelled) return
    sourceText.value = recognized
    const t1 = performance.now()

    if (!recognized) throw new Error(t('st.noSpeech'))
    const translated = await translate(recognized)
    if (cancelled) return
    translatedText.value = translated
    const t2 = performance.now()

    await speak(translated)
    const t3 = performance.now()
    timings.value = {
      asr: Math.round(t1 - t0),
      mt: Math.round(t2 - t1),
      tts: Math.round(t3 - t2)
    }
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
    step.value = 'idle'
    statusText.value = ''
  }
}

function cancel() { cancelled = true; running.value = false; step.value = 'idle'; statusText.value = '' }

function downloadAudio() {
  if (!resultUrl.value) return
  const a = document.createElement('a')
  a.href = resultUrl.value
  a.download = `translation-${dir.value}.wav`
  a.click()
}

/** 切换方向时清空结果（模型与音色都不同） */
watch(dir, () => {
  revokeResult()
  sourceText.value = ''
  translatedText.value = ''
  timings.value = null
})

onBeforeUnmount(() => {
  cancelled = true
  stopRecording()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  revokeResult()
})

const stepLabel = computed(() => ({
  idle: '',
  asr: t('st.stepAsr'),
  mt: t('st.stepMt'),
  tts: t('st.stepTts')
}[step.value]))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner
      :loading="running"
      :error="error"
    >
      <!-- 输入 -->
      <template #input>
        <!-- 方向 -->
        <div class="mb-4 flex items-center gap-2">
          <span class="text-sm text-muted">{{ t('st.direction') }}</span>
          <button
            v-for="item in dirItems"
            :key="item.key"
            type="button"
            class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer"
            :class="dir === item.key
              ? 'bg-primary border-primary text-white'
              : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
            @click="dir = item.key"
          >
            <UIcon
              :name="item.icon"
              class="size-4"
            />
            {{ item.label }}
          </button>
        </div>

        <p class="mb-4 text-sm text-muted">
          {{ t('st.hint') }}
        </p>

        <AudioSourceToggle v-model="source" />

        <div class="mt-4 space-y-3">
          <template v-if="source === 'mic'">
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                v-if="!recording"
                icon="i-lucide-mic"
                :label="t('emotion.recordStart')"
                color="primary"
                variant="soft"
                :disabled="running"
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
                v-if="audioFile"
                class="text-sm text-dimmed"
              >{{ audioFile.name }}</span>
            </div>
          </template>

          <template v-else>
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
                :disabled="running"
                @click="pickFile"
              />
              <UButton
                icon="i-lucide-flask-conical"
                :label="t('samples.trySample')"
                variant="soft"
                :disabled="running"
                @click="useSample"
              />
            </div>
          </template>

          <audio
            v-if="audioUrl"
            :src="audioUrl"
            controls
            class="w-full max-w-md"
          />

          <DemoParams
            v-model="params"
            :specs="specs"
            :running="running"
            :title="t('params.title')"
          />
        </div>
      </template>

      <!-- 控件 -->
      <template #controls>
        <UButton
          icon="i-lucide-languages"
          :label="t('st.run')"
          color="primary"
          :loading="running"
          :disabled="!audioFile"
          @click="run"
        />
        <UButton
          v-if="running"
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
          @click="downloadAudio"
        />
        <span
          v-if="running"
          class="text-sm text-muted"
        >
          {{ stepLabel }}<template v-if="statusText"> · {{ statusText }}</template>
          <template v-if="progress"> {{ progress }}%</template>
        </span>
      </template>

      <!-- 结果 -->
      <template #result>
        <div
          v-if="sourceText || translatedText || resultUrl"
          class="space-y-4"
        >
          <!-- ① 识别 -->
          <div>
            <p class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <UIcon
                name="i-lucide-mic"
                class="size-3.5"
              />
              {{ t('st.stepAsr') }}
            </p>
            <p class="whitespace-pre-wrap break-words text-base text-highlighted">
              {{ sourceText || '…' }}
            </p>
          </div>

          <!-- ② 翻译 -->
          <div>
            <p class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <UIcon
                name="i-lucide-languages"
                class="size-3.5"
              />
              {{ t('st.stepMt') }}
            </p>
            <p class="whitespace-pre-wrap break-words text-base font-medium text-primary">
              {{ translatedText || '…' }}
            </p>
          </div>

          <!-- ③ 语音 -->
          <div v-if="resultUrl">
            <p class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <UIcon
                name="i-lucide-volume-2"
                class="size-3.5"
              />
              {{ t('st.stepTts') }}
            </p>
            <audio
              :src="resultUrl"
              controls
              class="w-full"
            />
          </div>

          <p
            v-if="timings"
            class="text-xs text-dimmed"
          >
            {{ t('st.timings') }}：{{ t('st.stepAsr') }} {{ timings.asr }}ms ·
            {{ t('st.stepMt') }} {{ timings.mt }}ms ·
            {{ t('st.stepTts') }} {{ timings.tts }}ms · {{ t('vp.device') }} {{ device }}
          </p>
        </div>
        <div
          v-else
          class="text-sm text-muted"
        >
          {{ t('st.noResult') }}
        </div>
      </template>
    </DemoRunner>
  </MediaDemoShell>
</template>
