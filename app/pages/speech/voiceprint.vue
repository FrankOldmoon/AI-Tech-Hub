<script setup lang="ts">
/**
 * 声纹识别（说话人验证）：录音/上传 → WavLM 提取 512 维说话人向量 →
 * 与 localStorage 声纹库逐一算余弦相似度，给出判定与相似度排名。
 * 模型与注册数据全部在浏览器本地，类似 vision/face-recognition 的「人脸库」思路。
 */
/* eslint-disable @stylistic/max-statements-per-line */
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { humanError, mediaError } from '~/utils/errors'
import { decodeTo16k } from '~/utils/audio'
import { fetchSample } from '~/utils/samples'
import {
  DEFAULT_THRESHOLD,
  MIN_AUDIO_SECONDS,
  clearVoiceprints,
  enrollVoiceprint,
  extractVoiceEmbedding,
  getVoiceprints,
  removeVoiceprint,
  rankVoiceprints,
  type VoiceDtype,
  type VoicePrint,
  type VoiceRank
} from '~/utils/voiceprint'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'voiceprint')!)

// ===== 参数 =====
const specs = computed<ParamSpec[]>(() => [
  {
    key: 'dtype',
    label: t('vp.dtype'),
    type: 'select',
    default: 'q8',
    options: [
      { label: t('vp.dtypeQ8'), value: 'q8' },
      { label: t('vp.dtypeFp32'), value: 'fp32' }
    ],
    help: t('vp.dtypeHelp')
  },
  { key: 'threshold', label: t('vp.threshold'), type: 'slider', default: DEFAULT_THRESHOLD, min: 0.1, max: 0.9, step: 0.05, help: t('vp.thresholdHelp') }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

// ===== 模式 =====
const mode = ref<'enroll' | 'identify'>('enroll')
const modeItems = computed(() => [
  { key: 'enroll' as const, label: t('vp.modeEnroll'), icon: 'i-lucide-user-plus' },
  { key: 'identify' as const, label: t('vp.modeIdentify'), icon: 'i-lucide-scan-face' }
])

// ===== 输入 =====
const source = ref<'mic' | 'file'>('mic')
const recording = ref(false)
const recordSeconds = ref(0)
const audioFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const audioUrl = ref('')
const name = ref('')
let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null

// ===== 运行状态 =====
const busy = ref(false)
const statusText = ref('')
const progress = ref(0)
const error = ref<string | null>(null)
const flash = ref<string | null>(null)
const device = ref('')
const lastSeconds = ref(0)
const dim = ref(0)
/** 上一次提取的原始向量：拖动阈值时无需重跑模型即可重算排名 */
let lastEmbedding: number[] | null = null
let cancelled = false

// ===== 声纹库 =====
const registry = ref<VoicePrint[]>([])

// ===== 结果 =====
const ranks = ref<VoiceRank[]>([])

function refreshRegistry() { registry.value = getVoiceprints() }
refreshRegistry()

function pickFile() { fileInput.value?.click() }

function setFile(f: File) {
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  lastEmbedding = null
  ranks.value = []
  flash.value = null
  error.value = null
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) setFile(f)
}

async function useSample(path = '/samples/audio/speech.wav') {
  try {
    setFile(await fetchSample(path))
  } catch (e) {
    error.value = humanError(e, t)
  }
}

// ---- 录音（MediaRecorder → blob → File，后续统一走 decodeTo16k）----
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
      setFile(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }))
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

/** 解码到 16kHz 单声道（WavLM 期望输入） */
async function loadAudio(): Promise<Float32Array> {
  if (!audioFile.value) throw new Error(t('vp.noFile'))
  const audio = await decodeTo16k(audioFile.value)
  lastSeconds.value = Math.round((audio.length / 16000) * 10) / 10
  if (lastSeconds.value < MIN_AUDIO_SECONDS) throw new Error(t('vp.tooShort'))
  return audio
}

function onProgress(p: { status: string, file?: string, progress?: number }) {
  if (typeof p.progress === 'number') progress.value = Math.round(p.progress)
  statusText.value = p.file ? `${p.status} · ${String(p.file).split('/').pop()}` : p.status
}

/** 提取向量（两种模式共用） */
async function embed(loadingText: string): Promise<number[]> {
  busy.value = true
  progress.value = 0
  statusText.value = loadingText
  cancelled = false
  try {
    const audio = await loadAudio()
    const res = await extractVoiceEmbedding(audio, params.value.dtype as VoiceDtype, onProgress)
    if (cancelled) throw new Error(t('demo.cancelled'))
    lastEmbedding = res.embedding
    dim.value = res.embedding.length
    device.value = res.device
    return res.embedding
  } finally {
    busy.value = false
  }
}

/** 注册：同名视为追加样本，便于用多段语音让声纹更稳 */
async function enroll() {
  error.value = null
  flash.value = null
  ranks.value = []
  const nm = name.value.trim()
  if (!nm) { error.value = t('vp.nameRequired'); return }
  try {
    const embedding = await embed(t('vp.modelLoading'))
    if (cancelled) return
    registry.value = enrollVoiceprint(nm, embedding, lastSeconds.value)
    flash.value = t('vp.enrolled', { name: nm })
    name.value = ''
  } catch (e) {
    error.value = humanError(e, t)
  }
}

async function identify() {
  error.value = null
  flash.value = null
  ranks.value = []
  if (!registry.value.length) { error.value = t('vp.registryEmpty'); return }
  try {
    // 向量已存进 lastEmbedding，rerank 直接读它
    await embed(t('vp.modelLoading'))
    if (cancelled) return
    rerank()
  } catch (e) {
    error.value = humanError(e, t)
  }
}

/** 只用已有向量重算排名（阈值滑杆变化时调用，不重跑模型） */
function rerank() {
  if (!lastEmbedding) return
  ranks.value = rankVoiceprints(lastEmbedding, registry.value, Number(params.value.threshold))
}

watch(() => params.value.threshold, () => rerank())
watch(() => params.value.dtype, () => { lastEmbedding = null; ranks.value = []; flash.value = null })

function cancel() { cancelled = true; busy.value = false; statusText.value = '' }

function removeOne(id: string) {
  registry.value = removeVoiceprint(id)
  ranks.value = []
  flash.value = null
}

function clearAll() {
  registry.value = clearVoiceprints()
  ranks.value = []
}

onBeforeUnmount(() => {
  cancelled = true
  stopRecording()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})

// ===== 派生 =====
/** 首名判定结果（无结果时为 null，模板用它做 v-if 守卫） */
const verdict = computed(() => {
  const r = ranks.value[0]
  return r ? { accepted: r.accepted, name: r.name, similarity: r.similarity } : null
})
const thresholdPct = computed(() => `${Number(params.value.threshold) * 100}%`)
const sampleCount = computed(() => registry.value.reduce((s, p) => s + p.samples.length, 0))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner
      :loading="busy"
      :error="error"
    >
      <!-- 输入 -->
      <template #input>
        <!-- 模式切换 -->
        <div class="mb-4 flex items-center gap-2">
          <span class="text-sm text-muted">{{ t('vp.mode') }}</span>
          <button
            v-for="item in modeItems"
            :key="item.key"
            type="button"
            class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer"
            :class="mode === item.key
              ? 'bg-primary border-primary text-white'
              : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
            @click="mode = item.key"
          >
            <UIcon
              :name="item.icon"
              class="size-4"
            />
            {{ item.label }}
          </button>
        </div>

        <p class="mb-4 text-sm text-muted">
          {{ mode === 'enroll' ? t('vp.enrollHint') : t('vp.identifyHint') }}
        </p>

        <AudioSourceToggle v-model="source" />

        <div class="mt-4 space-y-3">
          <!-- 录音 -->
          <template v-if="source === 'mic'">
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
              <span
                v-if="audioFile"
                class="text-sm text-dimmed"
              >{{ audioFile.name }}</span>
            </div>
          </template>

          <!-- 上传 -->
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
                @click="pickFile"
              />
              <UButton
                icon="i-lucide-flask-conical"
                :label="t('samples.trySample')"
                variant="soft"
                @click="useSample('/samples/audio/speech-zh.wav')"
              />
            </div>
          </template>

          <audio
            v-if="audioUrl"
            :src="audioUrl"
            controls
            class="w-full max-w-md"
          />

          <div v-if="mode === 'enroll'">
            <label class="mb-1 block text-sm font-medium text-muted">{{ t('vp.name') }}</label>
            <UInput
              v-model="name"
              :placeholder="t('vp.namePlaceholder')"
              class="w-full max-w-xs"
            />
          </div>

          <DemoParams
            v-model="params"
            :specs="specs"
            :running="busy"
            :title="t('params.title')"
          />
        </div>
      </template>

      <!-- 控件 -->
      <template #controls>
        <UButton
          :icon="mode === 'enroll' ? 'i-lucide-user-plus' : 'i-lucide-scan-face'"
          :label="mode === 'enroll' ? t('vp.enroll') : t('vp.identify')"
          color="primary"
          :loading="busy"
          :disabled="!audioFile"
          @click="mode === 'enroll' ? enroll() : identify()"
        />
        <UButton
          v-if="busy"
          icon="i-lucide-x"
          :label="t('emotion.cancel')"
          color="neutral"
          variant="subtle"
          @click="cancel"
        />
        <span
          v-if="busy"
          class="text-sm text-muted"
        >{{ statusText }} {{ progress ? `${progress}%` : '' }}</span>
      </template>

      <!-- 结果 -->
      <template #result>
        <UAlert
          v-if="flash"
          color="success"
          variant="subtle"
          icon="i-lucide-check"
          :title="flash"
          class="mb-4"
        />

        <!-- 识别结果 -->
        <div
          v-if="mode === 'identify' && verdict"
          class="space-y-4"
        >
          <div class="flex items-center gap-3">
            <UIcon
              :name="verdict.accepted ? 'i-lucide-user-check' : 'i-lucide-user-x'"
              class="size-8"
              :class="verdict.accepted ? 'text-primary' : 'text-dimmed'"
            />
            <div>
              <p class="text-lg font-semibold text-highlighted">
                {{ verdict.accepted ? t('vp.match', { name: verdict.name }) : t('vp.unknown') }}
              </p>
              <p class="text-sm text-muted">
                {{ t('vp.similarity') }}: {{ (verdict.similarity * 100).toFixed(1) }}%
              </p>
            </div>
          </div>

          <div>
            <p class="mb-2 text-xs text-muted">
              {{ t('vp.ranking') }} · {{ t('vp.threshold') }} {{ Number(params.threshold).toFixed(2) }}
            </p>
            <div class="space-y-2">
              <div
                v-for="r in ranks"
                :key="r.name"
                class="flex items-center gap-3"
              >
                <span class="w-20 shrink-0 truncate text-sm text-muted">{{ r.name }}</span>
                <div class="relative h-2 flex-1 overflow-hidden rounded-full bg-default">
                  <div
                    class="h-full transition-all"
                    :class="r.accepted ? 'bg-primary' : 'bg-dimmed/40'"
                    :style="{ width: `${Math.max(0, Math.min(1, r.similarity)) * 100}%` }"
                  />
                  <div
                    class="absolute inset-y-0 w-px bg-highlighted/70"
                    :style="{ left: thresholdPct }"
                  />
                </div>
                <span class="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
                  {{ (r.similarity * 100).toFixed(1) }}% · {{ r.accepted ? t('vp.accepted') : t('vp.rejected') }}
                </span>
              </div>
            </div>
          </div>

          <p class="text-xs text-dimmed">
            {{ t('vp.audioSeconds') }}: {{ lastSeconds }}s ·
            {{ t('vp.embeddingDim') }}: {{ dim }}
            <template v-if="device">
              · {{ t('vp.device') }}: {{ device }}
            </template>
          </p>
        </div>

        <div
          v-else-if="mode === 'enroll' && !flash"
          class="text-sm text-muted"
        >
          {{ t('vp.noResult') }}
        </div>
        <div
          v-else-if="mode === 'identify' && !verdict"
          class="text-sm text-muted"
        >
          {{ t('vp.noResult') }}
        </div>
      </template>

      <!-- 声纹库侧栏 -->
      <template #aside>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-database"
                  class="size-4"
                />
                {{ t('vp.registry') }}
              </div>
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ t('vp.samples', { n: sampleCount }) }}
              </UBadge>
            </div>
          </template>

          <p
            v-if="!registry.length"
            class="text-sm text-muted"
          >
            {{ t('vp.registryEmpty') }}
          </p>
          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="p in registry"
              :key="p.id"
              class="flex items-center justify-between gap-2 rounded-lg border border-default px-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm text-highlighted">
                  {{ p.name }}
                </p>
                <p class="text-xs text-muted">
                  {{ t('vp.samples', { n: p.samples.length }) }} · {{ p.samples[0]?.embedding.length || 0 }}D
                </p>
              </div>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('vp.remove')"
                @click="removeOne(p.id)"
              />
            </div>
          </div>

          <template
            v-if="registry.length"
            #footer
          >
            <UButton
              icon="i-lucide-trash"
              :label="t('vp.clear')"
              color="neutral"
              variant="subtle"
              size="xs"
              @click="clearAll"
            />
          </template>
        </UCard>

        <UCard>
          <p class="text-xs leading-relaxed text-muted">
            {{ t('vp.privacy') }}
          </p>
        </UCard>
      </template>
    </DemoRunner>
  </MediaDemoShell>
</template>
