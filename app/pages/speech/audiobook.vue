<script setup lang="ts">
/**
 * 多角色有声书：把「角色：台词」剧本按角色分配不同 Edge-TTS 音色，
 * 逐句合成后拼接成一条完整 WAV（服务端 Edge-TTS，学生机无需外网）。
 */
/* eslint-disable @stylistic/max-statements-per-line */
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { VOICE_POOLS, assignVoices, collectRoles, concatChunks, parseScript } from '~/utils/audiobook'
import { downloadBlob, encodeWav, formatClock } from '~/utils/wav'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audiobook')!)

interface EdgeVoice {
  shortName: string
  locale: string
  gender: string
  friendlyName: string
}

// ===== 剧本 =====
const ZH_SCRIPT = '小明：你好呀，今天怎么这么早？\n小红：我要去图书馆还书，顺便占个位置。\n两人相视一笑，一起走向校门。'
const EN_SCRIPT = 'Amy: Hi Ben! You are early today.\nBen: I need to return some books before class.\nThey walked to the library together.'
const lang = ref<'zh' | 'en'>('zh')
const langItems = computed(() => [
  { key: 'zh' as const, label: t('ab.langZh'), icon: 'i-lucide-languages' },
  { key: 'en' as const, label: t('ab.langEn'), icon: 'i-lucide-languages' }
])
const rawScript = ref(ZH_SCRIPT)

const lines = computed(() => parseScript(rawScript.value))
const roles = computed(() => collectRoles(lines.value))

// ===== Edge-TTS 音色 =====
const edgeVoices = ref<EdgeVoice[]>([])

/** 从已拉取的 voice 列表里挑出当前语言可用音色；列表未就绪时退回内置池 */
function poolFor(l: 'zh' | 'en'): string[] {
  const available = new Set(edgeVoices.value.map(v => v.shortName))
  const preferred = VOICE_POOLS[l] || []
  const present = preferred.filter(v => available.has(v))
  const extra = edgeVoices.value
    .filter(v => v.locale.startsWith(l) && !present.includes(v.shortName))
    .map(v => v.shortName)
  // 首选音色足够时不再混入随机音色，保证旁白音色稳定（assignVoices 用池尾做旁白）
  const list = present.length >= 2 ? present : [...present, ...extra]
  return (list.length ? list : preferred).slice(0, 12)
}
const pools = computed(() => ({ zh: poolFor('zh'), en: poolFor('en') }))

const voiceOptions = computed(() => {
  const list = edgeVoices.value.filter(v => v.locale.startsWith(lang.value))
  if (list.length) {
    return list.map(v => ({ label: `${v.friendlyName} · ${v.locale} · ${v.gender}`, value: v.shortName }))
  }
  return (VOICE_POOLS[lang.value] || []).map(v => ({ label: v, value: v }))
})

/** 角色 → 音色；新角色自动分配，已分配的保持不变 */
const voices = ref<Record<string, string>>({})
function reassignVoices() {
  const auto = assignVoices(roles.value, pools.value[lang.value] || [])
  const next: Record<string, string> = {}
  for (const r of roles.value) next[r] = voices.value[r] || auto[r] || ''
  voices.value = next
}
watch([roles, pools], reassignVoices, { immediate: true })
/** 切换语言：整套音色重新分配（中文用中文音色池） */
watch(lang, () => { voices.value = assignVoices(roles.value, pools.value[lang.value] || []) })

function useExample() {
  rawScript.value = lang.value === 'zh' ? ZH_SCRIPT : EN_SCRIPT
}

// ===== 参数 =====
const specs = computed<ParamSpec[]>(() => [
  { key: 'speed', label: t('tts.speed'), type: 'slider', default: 1, min: 0.5, max: 2, step: 0.1, help: t('tts.speedHelp') },
  { key: 'gap', label: t('ab.gap'), type: 'slider', default: 0.25, min: 0, max: 0.8, step: 0.05, help: t('ab.gapHelp') }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

// ===== 运行状态 =====
const generating = ref(false)
const progress = ref(0)
const statusText = ref('')
const currentLine = ref(0)
const error = ref<string | null>(null)
let cancelled = false

// ===== 结果 =====
const durations = ref<number[]>([])
/** 拼接后的整本 WAV：既给 <audio> 用（resultUrl），也是下载的来源 */
const resultBlob = ref<Blob | null>(null)
const resultUrl = ref('')
const resultSeconds = ref(0)
const previewUrl = ref('')
const previewIndex = ref(-1)
const audioEl = ref<HTMLAudioElement>()

function revoke(url: string): string {
  if (url) URL.revokeObjectURL(url)
  return ''
}

function voiceOf(line: { role: string }): string {
  return voices.value[line.role] || pools.value[lang.value]?.[0] || VOICE_POOLS[lang.value]?.[0] || ''
}

/** 语速 0.5~2.0 → Edge-TTS rate 百分比（如 +20% / -30%） */
function edgeRate(speed: number): string {
  const pct = Math.round((speed - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

async function edgeBlob(text: string, voice: string, speed: number, retries = 2): Promise<Blob> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch('/api/speech/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate: edgeRate(speed) })
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(msg || `Edge-TTS HTTP ${res.status}`)
    }
    const blob = await res.blob()
    if (blob.size > 0) return blob
    // Edge-TTS 偶发返回空音频：短暂等待后重试
    lastError = new Error('Edge-TTS returned empty audio')
    if (attempt < retries) await new Promise(r => setTimeout(r, 500))
  }
  throw lastError
}

let audioCtx: AudioContext | null = null
function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

/** MP3 → 单声道 PCM（用 AudioContext 解码，采样率由同一个 context 统一） */
async function decodeMono(blob: Blob): Promise<{ pcm: Float32Array, rate: number, duration: number }> {
  let buf: AudioBuffer
  try {
    buf = await getAudioContext().decodeAudioData(await blob.arrayBuffer())
  } catch (e) {
    throw new Error(`Audio decode failed (${blob.size} bytes): ${e instanceof Error ? e.message : String(e)}`)
  }
  let pcm: Float32Array
  if (buf.numberOfChannels === 1) {
    pcm = buf.getChannelData(0).slice()
  } else {
    pcm = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c)
      for (let i = 0; i < buf.length; i++) pcm[i] = (pcm[i] ?? 0) + (data[i] ?? 0) / buf.numberOfChannels
    }
  }
  return { pcm, rate: buf.sampleRate, duration: buf.duration }
}

/** 合成整本：逐句请求 Edge-TTS → 解码 → 拼接 → 编码一次 WAV */
async function generate() {
  if (!lines.value.length) { error.value = t('ab.noScript'); return }
  // 在用户点击的同步阶段创建/恢复 AudioContext，避免自动播放策略把解码上下文挂起
  getAudioContext()
  error.value = null
  generating.value = true
  cancelled = false
  progress.value = 0
  durations.value = []
  resultBlob.value = null
  resultUrl.value = revoke(resultUrl.value)
  previewUrl.value = revoke(previewUrl.value)
  resultSeconds.value = 0
  try {
    const chunks: Float32Array[] = []
    const durs: number[] = []
    let rate = 24000
    const all = lines.value
    for (let i = 0; i < all.length; i++) {
      if (cancelled) return
      currentLine.value = i + 1
      progress.value = Math.round((i / all.length) * 100)
      statusText.value = t('ab.synthesizing', { i: i + 1, total: all.length })
      const line = all[i]!
      const blob = await edgeBlob(line.text, voiceOf(line), Number(params.value.speed) || 1)
      const { pcm, rate: r, duration } = await decodeMono(blob)
      rate = r
      chunks.push(pcm)
      durs.push(Math.round(duration * 10) / 10)
    }
    if (cancelled) return
    progress.value = 100
    const merged = concatChunks(chunks, rate, Number(params.value.gap) || 0)
    durations.value = durs
    resultSeconds.value = Math.round((merged.length / rate) * 10) / 10
    resultBlob.value = encodeWav(merged, rate)
    resultUrl.value = URL.createObjectURL(resultBlob.value)
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    generating.value = false
    currentLine.value = 0
    statusText.value = ''
  }
}

/** 试听单句（只合成这一句，快得多） */
async function preview(i: number) {
  if (generating.value) return
  const line = lines.value[i]
  if (!line) return
  getAudioContext()
  error.value = null
  previewIndex.value = i
  previewUrl.value = revoke(previewUrl.value)
  try {
    const blob = await edgeBlob(line.text, voiceOf(line), Number(params.value.speed) || 1)
    previewUrl.value = URL.createObjectURL(blob)
    await nextTick()
    audioEl.value?.play().catch(() => {})
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    previewIndex.value = -1
  }
}

function cancel() { cancelled = true; generating.value = false; statusText.value = '' }

function download() {
  if (!resultBlob.value) return
  downloadBlob(resultBlob.value, 'audiobook.wav')
}

const totalChars = computed(() => lines.value.reduce((s, l) => s + l.text.length, 0))

// 启动时拉取 Edge-TTS 音色列表（失败则使用 VOICE_POOLS 兜底）
onMounted(async () => {
  try {
    const res = await $fetch<{ voices: EdgeVoice[] }>('/api/speech/tts-voices')
    if (res?.voices?.length) edgeVoices.value = res.voices
  } catch {
    /* 保留内置兜底池 */
  }
})

</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner
      :loading="generating"
      :error="error"
    >
      <!-- 输入 -->
      <template #input>
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted">{{ t('ab.lang') }}</span>
          <button
            v-for="item in langItems"
            :key="item.key"
            type="button"
            class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer"
            :class="lang === item.key
              ? 'bg-primary border-primary text-white'
              : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
            @click="lang = item.key"
          >
            <UIcon
              :name="item.icon"
              class="size-4"
            />
            {{ item.label }}
          </button>
          <UButton
            icon="i-lucide-file-text"
            :label="t('ab.useExample')"
            size="xs"
            color="neutral"
            variant="subtle"
            @click="useExample"
          />
        </div>

        <p class="mb-4 text-sm text-muted">
          {{ t('ab.hint') }}
        </p>

        <label class="mb-1 block text-sm font-medium text-muted">{{ t('ab.script') }}</label>
        <UTextarea
          v-model="rawScript"
          :rows="7"
          :placeholder="t('ab.scriptPlaceholder')"
          class="w-full"
        />
        <p class="mt-1 text-xs text-dimmed">
          {{ t('ab.scriptNote') }}
        </p>

        <div class="mt-4">
          <DemoParams
            v-model="params"
            :specs="specs"
            :running="generating"
            :title="t('params.title')"
          />
        </div>
      </template>

      <!-- 控件 -->
      <template #controls>
        <UButton
          icon="i-lucide-book-audio"
          :label="t('ab.generate')"
          color="primary"
          :loading="generating"
          :disabled="!lines.length"
          @click="generate"
        />
        <UButton
          v-if="generating"
          icon="i-lucide-x"
          :label="t('speech.cancel')"
          color="neutral"
          variant="subtle"
          @click="cancel"
        />
        <UButton
          v-if="resultUrl"
          icon="i-lucide-download"
          :label="t('ab.download')"
          color="neutral"
          variant="subtle"
          @click="download"
        />
        <span
          v-if="generating"
          class="text-sm text-muted"
        >
          {{ statusText }}<template v-if="progress"> {{ progress }}%</template>
        </span>
      </template>

      <!-- 结果 -->
      <template #result>
        <div
          v-if="resultUrl"
          class="space-y-4"
        >
          <audio
            :src="resultUrl"
            controls
            class="w-full"
          />
          <p class="text-xs text-dimmed">
            {{ t('ab.totalDuration') }} {{ formatClock(resultSeconds) }} ·
            {{ t('ab.chars', { n: totalChars }) }} · Edge-TTS
            <template v-if="generating">
              · {{ t('ab.synthesizing', { i: currentLine, total: lines.length }) }}
            </template>
          </p>

          <!-- 逐句明细 -->
          <div class="space-y-1.5">
            <div
              v-for="(l, i) in lines"
              :key="i"
              class="flex items-start gap-2 rounded-lg border border-default px-3 py-2"
            >
              <UBadge
                :color="l.role ? 'primary' : 'neutral'"
                variant="subtle"
                class="mt-0.5 shrink-0"
              >
                {{ l.role || t('ab.narration') }}
              </UBadge>
              <p class="min-w-0 flex-1 text-sm text-highlighted">
                {{ l.text }}
              </p>
              <span class="shrink-0 text-xs tabular-nums text-muted">
                {{ durations[i] !== undefined ? `${durations[i]}s` : '—' }}
              </span>
              <UButton
                icon="i-lucide-play"
                color="neutral"
                variant="ghost"
                size="xs"
                :loading="previewIndex === i"
                :disabled="generating"
                :aria-label="t('ab.preview')"
                @click="preview(i)"
              />
            </div>
          </div>
        </div>
        <div
          v-else
          class="text-sm text-muted"
        >
          {{ t('ab.noResult') }}
        </div>
      </template>

      <!-- 角色音色分配 -->
      <template #aside>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                name="i-lucide-users"
                class="size-4"
              />
              {{ t('ab.cast') }}
            </div>
          </template>

          <p
            v-if="!roles.length"
            class="text-sm text-muted"
          >
            {{ t('ab.noScript') }}
          </p>
          <div
            v-else
            class="space-y-3"
          >
            <div
              v-for="r in roles"
              :key="r || 'narration'"
              class="space-y-1"
            >
              <div class="flex items-center gap-2">
                <UBadge
                  :color="r ? 'primary' : 'neutral'"
                  variant="subtle"
                >
                  {{ r || t('ab.narration') }}
                </UBadge>
                <span class="text-xs text-muted">
                  {{ t('ab.lines', { n: lines.filter(x => x.role === r).length }) }}
                </span>
              </div>
              <USelect
                v-model="voices[r]"
                :items="voiceOptions"
                class="w-full"
              />
            </div>
          </div>

          <template
            v-if="roles.length"
            #footer
          >
            <p class="text-xs text-dimmed">
              {{ t('ab.castNote') }}
            </p>
          </template>
        </UCard>

        <UCard>
          <div class="space-y-1 text-xs text-muted">
            <p>{{ t('ab.statLines', { n: lines.length }) }}</p>
            <p>{{ t('ab.chars', { n: totalChars }) }}</p>
          </div>
        </UCard>
      </template>
    </DemoRunner>

    <!-- 试听播放器（隐藏，仅用于 preview） -->
    <audio
      v-show="false"
      ref="audioEl"
      :src="previewUrl"
    />
  </MediaDemoShell>
</template>
