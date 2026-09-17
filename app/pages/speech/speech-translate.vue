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
// 上传 / 示例 / 录音统一走 useAudioInput：文件 ref、objectURL、隐藏 input、解码缓存、
// 录音状态与秒表都在它内部（本页不再出现 URL.createObjectURL / revokeObjectURL）。
const {
  mode: source,
  file: audioFile,
  url: audioUrl,
  setFile,
  useSample,
  toSamples16k,
  recording,
  recordSeconds,
  startRecord,
  stopRecord
} = useAudioInput({
  defaultSampleUrl: '/samples/audio/speech-zh.wav',
  namePrefix: 'speech',
  initialMode: 'record',
  onError: (e) => { error.value = mediaError(e, t) }
})

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

// 换输入后清空上一次的三段结果。原 setFile 的这些副作用改挂在 file 的 watch 上，
// 以便 setFile 本身完全由 useAudioInput 提供（否则又要包一层重复实现）。
watch(audioFile, () => {
  sourceText.value = ''
  translatedText.value = ''
  timings.value = null
  revokeResult()
  error.value = null
})

/** 「试用示例」按钮由 AudioInput 渲染：中文方向用中文示例音，反之用英文示例音 */
const samples = computed(() => [{
  label: t('samples.trySample'),
  url: dir.value === 'zh-en' ? '/samples/audio/speech-zh.wav' : '/samples/audio/speech.wav'
}])

// 录音：采集、chunk 累积、秒表、卸载关流都在 useAudioInput 里，页面只保留「开始前清错误」。
function startRecording() {
  error.value = null
  void startRecord()
}

function stopRecording() {
  stopRecord()
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
  // dtype 需要字面量类型：写成 'q8' 会被推断成 string，与 PretrainedModelOptions.dtype 的联合类型不兼容
  const options = { dtype: 'q8' as const, device: device.value, progress_callback: onProgress }
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
  const options = { dtype: 'q8' as const, device: device.value }
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
  // kokoroSynthesize 返回的 device 是宽 string；本页只关心 webgpu / wasm 两档，收窄后再写回
  device.value = ttsDevice === 'webgpu' ? 'webgpu' : 'wasm'
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
    // 16kHz 单声道样本由 useAudioInput 解码并缓存（Whisper 期望输入），本页不再自己解码
    const samples = await toSamples16k()
    if (cancelled) return

    const t0 = performance.now()
    const recognized = await transcribe(samples)
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

// 只终止在途流水线与回收合成结果的 objectURL；输入流/输入 URL 已由 useAudioInput 接管。
onBeforeUnmount(() => {
  cancelled = true
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

        <AudioInput
          v-model:mode="source"
          class="mt-4"
          :modes="['record', 'file']"
          :samples="samples"
          :file-name="audioFile?.name"
          :file-url="audioUrl"
          :disabled="running"
          :active="recording"
          :seconds="recordSeconds"
          @select="setFile"
          @sample="useSample"
          @start="startRecording"
          @stop="stopRecording"
        >
          <template #extra>
            <DemoParams
              v-model="params"
              :specs="specs"
              :running="running"
              :title="t('params.title')"
            />
          </template>
        </AudioInput>
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
          :label="t('speech.cancel')"
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
