<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { setupTransformersEnv, preferredDevice } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'asr')!)

// ===== 模式：实时（浏览器引擎）/ 文件转写（Whisper 离线） =====
const mode = ref<'live' | 'file'>('live')

// ===== 实时模式：Web Speech API =====
const supported = ref(false)
const listening = ref(false)
const interim = ref('')
const finalText = ref('')
const liveError = ref<string | null>(null)

let recognition: any = null

const langItems = [
  { label: '中文 · zh-CN', value: 'zh-CN' },
  { label: 'English · en-US', value: 'en-US' },
  { label: 'English · en-GB', value: 'en-GB' },
  { label: '日本語 · ja-JP', value: 'ja-JP' }
]

const specs = computed<ParamSpec[]>(() => [
  { key: 'lang', label: t('asr.lang'), type: 'select', default: 'zh-CN', options: langItems },
  { key: 'continuous', label: t('asr.continuous'), type: 'switch', default: true, help: t('asr.continuousHelp') },
  { key: 'interimResults', label: t('asr.interim'), type: 'switch', default: true, help: t('asr.interimHelp') },
  { key: 'maxAlternatives', label: t('asr.maxAlternatives'), type: 'slider', default: 1, min: 1, max: 5, step: 1 }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

onMounted(() => {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) {
    supported.value = false
    return
  }
  supported.value = true
  recognition = new SR()
  applyParams()
  recognition.onresult = (event: any) => {
    let interimText = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        finalText.value += transcript
      } else {
        interimText += transcript
      }
    }
    interim.value = interimText
  }
  recognition.onerror = (e: any) => {
    liveError.value = e.error || 'error'
    listening.value = false
  }
  recognition.onend = () => {
    listening.value = false
  }
})

function applyParams() {
  if (!recognition) return
  recognition.lang = String(params.value.lang)
  recognition.continuous = Boolean(params.value.continuous)
  recognition.interimResults = Boolean(params.value.interimResults)
  recognition.maxAlternatives = Number(params.value.maxAlternatives)
}

function start() {
  if (!recognition) return
  liveError.value = null
  finalText.value = ''
  interim.value = ''
  applyParams()
  try {
    recognition.start()
    listening.value = true
  } catch (e) {
    // 重复 start 会抛 InvalidStateError，忽略
  }
}

function stop() {
  if (!recognition) return
  recognition.stop()
  listening.value = false
}

function clearResult() {
  finalText.value = ''
  interim.value = ''
  liveError.value = null
}

onBeforeUnmount(() => {
  if (recognition) recognition.stop()
  // 离开页面时放弃进行中的 whisper 转写，避免结果回写已销毁的组件
  cancelled = true
})

// ===== 文件模式：Whisper 离线转写（transformers.js，WebGPU/WASM） =====
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const transcribing = ref(false)
const whisperLoading = ref(false)
const whisperProgress = ref(0)
const whisperStatus = ref('')
const whisperError = ref<string | null>(null)
const resultText = ref('')
const resultChunks = ref<Array<{ start: number; end: number; text: string }>>([])
let cancelled = false

const modelItems = [
  { label: 'whisper-tiny · 最快 (~75MB)', value: 'Xenova/whisper-tiny' },
  { label: 'whisper-base · 均衡 (~145MB)', value: 'Xenova/whisper-base' },
  { label: 'whisper-small · 更准 (~460MB)', value: 'Xenova/whisper-small' }
]
const fileLangItems = [
  { label: t('asr.whisper.langAuto'), value: 'auto' },
  { label: '中文', value: 'chinese' },
  { label: 'English', value: 'english' },
  { label: '日本語', value: 'japanese' },
  { label: '한국어', value: 'korean' },
  { label: 'Français', value: 'french' },
  { label: 'Deutsch', value: 'german' },
  { label: 'Español', value: 'spanish' }
]
const taskItems = [
  { label: t('asr.whisper.taskTranscribe'), value: 'transcribe' },
  { label: t('asr.whisper.taskTranslate'), value: 'translate' }
]
const dtypeItems = [
  { label: t('asr.whisper.dtypeQ8'), value: 'q8' },
  { label: t('asr.whisper.dtypeFp32'), value: 'fp32' }
]

const fileModel = ref('Xenova/whisper-base')
const fileLang = ref('chinese')
const fileTask = ref('transcribe')
const fileDtype = ref('q8')
const device = ref(preferredDevice())

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  audioFile.value = f
  whisperError.value = null
  resultText.value = ''
  resultChunks.value = []
}

function pickFile() {
  fileInput.value?.click()
}

/** 解码音频并重采样到 16kHz 单声道（Whisper 期望格式） */
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
    for (let i = 0; i < out.length; i++) {
      out[i] = src[Math.floor(i * ratio)]
    }
    return out
  } finally {
    ctx.close()
  }
}

async function transcribe() {
  if (!audioFile.value) {
    whisperError.value = t('asr.whisper.uploadRequired')
    return
  }
  whisperError.value = null
  resultText.value = ''
  resultChunks.value = []
  transcribing.value = true
  whisperLoading.value = true
  whisperProgress.value = 0
  whisperStatus.value = t('asr.whisper.loadingModel')
  cancelled = false
  try {
    const env = await setupTransformersEnv()
    const { pipeline } = await import('@huggingface/transformers')
    // whisper 模型未放在 public/model/transformers，跳过本地探测避免 404 噪音
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false
    const onProgress = (p: any) => {
      if (!p) return
      if (p.status === 'progress' && p.total) {
        whisperProgress.value = Math.round((p.loaded / p.total) * 100)
        const fname = p.file ? ' · ' + String(p.file).split('/').pop() : ''
        whisperStatus.value = t('asr.whisper.downloading', { progress: whisperProgress.value }) + fname
      } else if (p.status === 'ready' || p.status === 'done') {
        whisperStatus.value = t('asr.whisper.loaded')
      }
    }
    const options = {
      dtype: fileDtype.value,
      device: device.value,
      progress_callback: onProgress
    }
    let transcriber: any = null
    try {
      transcriber = await pipeline('automatic-speech-recognition', fileModel.value, options)
    } catch (e) {
      // WebGPU 失败时回退 WASM
      if (device.value === 'webgpu') {
        device.value = 'wasm'
        transcriber = await pipeline('automatic-speech-recognition', fileModel.value, { ...options, device: 'wasm' })
      } else {
        throw e
      }
    } finally {
      env.allowLocalModels = prevAllowLocal
    }
    whisperLoading.value = false
    whisperStatus.value = t('asr.whisper.transcribing')
    const audio = await decodeTo16k(audioFile.value)
    const output = await transcriber(audio, {
      language: fileLang.value === 'auto' ? undefined : fileLang.value,
      task: fileTask.value,
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true
    })
    if (cancelled) return
    resultText.value = (output?.text || '').trim()
    const chunks: any[] = Array.isArray(output?.chunks) ? output.chunks : []
    resultChunks.value = chunks.map((c: any) => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? 0,
      text: (c.text || '').trim()
    }))
  } catch (e: any) {
    whisperError.value = e?.message || String(e)
  } finally {
    transcribing.value = false
    whisperLoading.value = false
  }
}

function cancelTranscribe() {
  cancelled = true
  transcribing.value = false
  whisperLoading.value = false
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec - Math.floor(sec)) * 1000)
  const pad = (v: number, n: number) => String(v).padStart(n, '0')
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function exportTxt() {
  if (!resultText.value) return
  downloadFile('whisper-transcript.txt', resultText.value, 'text/plain;charset=utf-8')
}

function exportSrt() {
  if (!resultChunks.value.length) return
  const srt = resultChunks.value
    .map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}\n`)
    .join('\n')
  downloadFile('whisper-transcript.srt', srt, 'text/plain;charset=utf-8')
}

// ===== DemoRunner 绑定 =====
const runnerError = computed(() => (mode.value === 'live' ? liveError.value : whisperError.value))
const runnerNotice = computed(() =>
  mode.value === 'live' ? (supported.value ? null : t('asr.unsupported')) : null
)
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :error="runnerError"
        :notice="runnerNotice"
      >
        <!-- 输入 -->
        <template #input>
          <!-- 模式切换 -->
          <div class="flex items-center gap-2 mb-4">
            <UButton
              icon="i-lucide-mic"
              :label="t('asr.whisper.modeLive')"
              :variant="mode === 'live' ? 'solid' : 'soft'"
              size="sm"
              @click="mode = 'live'"
            />
            <UButton
              icon="i-lucide-file-audio"
              :label="t('asr.whisper.modeFile')"
              :variant="mode === 'file' ? 'solid' : 'soft'"
              size="sm"
              @click="mode = 'file'"
            />
          </div>

          <!-- 实时模式 -->
          <template v-if="mode === 'live'">
            <p class="text-sm text-muted mb-4">{{ t('asr.hint') }}</p>
            <DemoParams v-model="params" :specs="specs" :running="listening" :title="t('params.title')" />
          </template>

          <!-- 文件模式（Whisper 离线） -->
          <template v-else>
            <p class="text-sm text-muted mb-4">{{ t('asr.whisper.hint') }}</p>
            <div class="space-y-4">
              <div>
                <input
                  ref="fileInput"
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
                  class="hidden"
                  @change="onFileChange"
                />
                <UButton
                  icon="i-lucide-upload"
                  :label="audioFile ? audioFile.name : t('asr.whisper.upload')"
                  variant="outline"
                  :disabled="transcribing"
                  @click="pickFile"
                />
              </div>
              <div class="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label class="block text-sm font-medium text-muted mb-1">{{ t('asr.whisper.model') }}</label>
                  <USelect v-model="fileModel" :items="modelItems" class="w-full" :disabled="transcribing" />
                  <p class="mt-1 text-xs text-dimmed">{{ t('asr.whisper.modelHelp') }}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-muted mb-1">{{ t('asr.whisper.lang') }}</label>
                  <USelect v-model="fileLang" :items="fileLangItems" class="w-full" :disabled="transcribing" />
                  <p class="mt-1 text-xs text-dimmed">{{ t('asr.whisper.langHelp') }}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-muted mb-1">{{ t('asr.whisper.task') }}</label>
                  <USelect v-model="fileTask" :items="taskItems" class="w-full" :disabled="transcribing" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-muted mb-1">{{ t('asr.whisper.dtype') }}</label>
                  <USelect v-model="fileDtype" :items="dtypeItems" class="w-full" :disabled="transcribing" />
                </div>
              </div>
              <p class="text-xs text-dimmed">
                {{ t('asr.whisper.device') }}: {{ device }} · {{ t('asr.whisper.privacy') }}
              </p>
            </div>
          </template>
        </template>

        <!-- 控件 -->
        <template #controls>
          <template v-if="mode === 'live'">
            <UButton
              v-if="!listening"
              icon="i-lucide-mic"
              :label="t('asr.start')"
              color="primary"
              :disabled="!supported"
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
            <UButton
              icon="i-lucide-eraser"
              :label="t('demo.reset')"
              color="neutral"
              variant="subtle"
              :disabled="!finalText && !interim"
              @click="clearResult"
            />
          </template>
          <template v-else>
            <UButton
              icon="i-lucide-wand-sparkles"
              :label="t('asr.whisper.transcribe')"
              color="primary"
              :loading="transcribing"
              :disabled="!audioFile"
              @click="transcribe"
            />
            <UButton
              v-if="transcribing"
              icon="i-lucide-x"
              :label="t('asr.whisper.cancel')"
              color="neutral"
              variant="subtle"
              @click="cancelTranscribe"
            />
          </template>
        </template>

        <!-- 结果 -->
        <template #result>
          <template v-if="mode === 'live'">
            <div v-if="listening || finalText || interim" class="space-y-2">
              <div v-if="listening" class="flex items-center gap-2 text-sm text-primary">
                <UIcon name="i-lucide-mic" class="size-4 animate-pulse" />
                {{ t('asr.listening') }}…
              </div>
              <p class="text-base text-highlighted whitespace-pre-wrap break-words">
                <span>{{ finalText }}</span><span class="text-muted">{{ interim }}</span>
              </p>
            </div>
            <div v-else class="text-sm text-muted">…</div>
          </template>

          <template v-else>
            <!-- 加载/转写进度 -->
            <div v-if="whisperLoading || transcribing" class="space-y-3">
              <div class="flex items-center justify-between text-sm text-muted">
                <span>{{ whisperStatus }}</span>
                <span class="tabular-nums">{{ whisperProgress }}%</span>
              </div>
              <div class="h-2 w-full bg-default rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary transition-all"
                  :style="{ width: whisperProgress + '%' }"
                />
              </div>
            </div>

            <!-- 结果 -->
            <div v-else-if="resultText" class="space-y-4">
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  icon="i-lucide-file-text"
                  :label="t('asr.whisper.exportTxt')"
                  size="sm"
                  variant="outline"
                  @click="exportTxt"
                />
                <UButton
                  icon="i-lucide-captions"
                  :label="t('asr.whisper.exportSrt')"
                  size="sm"
                  variant="outline"
                  :disabled="!resultChunks.length"
                  @click="exportSrt"
                />
              </div>
              <p class="text-xs text-dimmed">{{ t('asr.whisper.traditionalNote') }}</p>
              <p class="text-base text-highlighted whitespace-pre-wrap break-words leading-relaxed">
                {{ resultText }}
              </p>
            </div>
            <div v-else class="text-sm text-muted">{{ t('asr.whisper.noResult') }}</div>
          </template>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
