<script setup lang="ts">
/**
 * 多角色有声书：把「角色：台词」剧本按角色分配不同 Kokoro 音色，
 * 逐句合成后拼接成一条完整 WAV（纯本地推理，模型已在 .models/transformers/）。
 */
/* eslint-disable @stylistic/max-statements-per-line */
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { kokoroVoices, kokoroSynthesize, loadKokoroModel, rawAudioToWavBlob, voiceOptionLabel, type KokoroProgress } from '~/utils/kokoro'
import { VOICE_POOLS, assignVoices, collectRoles, concatChunks, parseScript } from '~/utils/audiobook'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'audiobook')!)

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

/** 角色 → 音色；新角色自动分配，已分配的保持不变 */
const voices = ref<Record<string, string>>({})
watch(roles, (rs) => {
  const auto = assignVoices(rs, VOICE_POOLS[lang.value] || [])
  const next: Record<string, string> = {}
  for (const r of rs) next[r] = voices.value[r] || auto[r] || ''
  voices.value = next
}, { immediate: true })
/** 切换语言：整套音色重新分配（中文用中文音色池） */
watch(lang, () => { voices.value = assignVoices(roles.value, VOICE_POOLS[lang.value] || []) })

const voiceOptions = computed(() => kokoroVoices.map(v => ({ label: voiceOptionLabel(v), value: v.id })))

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
const loadingModel = ref(false)
const progress = ref(0)
const statusText = ref('')
const currentLine = ref(0)
const device = ref('')
const error = ref<string | null>(null)
let cancelled = false

// ===== 结果 =====
const durations = ref<number[]>([])
const resultUrl = ref('')
const resultSeconds = ref(0)
const previewUrl = ref('')
const previewIndex = ref(-1)
const audioEl = ref<HTMLAudioElement>()

function revoke(url: string): string {
  if (url) URL.revokeObjectURL(url)
  return ''
}

function onProgress(p: KokoroProgress) {
  if (typeof p.progress === 'number') progress.value = Math.round(p.progress)
  statusText.value = p.file ? `${p.status} · ${String(p.file).split('/').pop()}` : p.status
}

function voiceOf(line: { role: string }): string {
  return voices.value[line.role] || voices.value[''] || 'af_heart'
}

/** 合成整本：逐句 generate → 拼接 → 编码一次 WAV */
async function generate() {
  if (!lines.value.length) { error.value = t('ab.noScript'); return }
  error.value = null
  generating.value = true
  cancelled = false
  progress.value = 0
  statusText.value = t('ab.loadingModel')
  durations.value = []
  resultUrl.value = revoke(resultUrl.value)
  previewUrl.value = revoke(previewUrl.value)
  resultSeconds.value = 0
  try {
    const loaded = await loadKokoroModel(onProgress)
    device.value = loaded.device
    loadingModel.value = false

    const chunks: Float32Array[] = []
    const durs: number[] = []
    let rate = 24000
    const all = lines.value
    for (let i = 0; i < all.length; i++) {
      if (cancelled) return
      currentLine.value = i + 1
      statusText.value = t('ab.synthesizing', { i: i + 1, total: all.length })
      const line = all[i]!
      const raw = await loaded.tts.generate(line.text, {
        voice: voiceOf(line),
        speed: Number(params.value.speed) || 1
      })
      rate = raw.sampling_rate
      chunks.push(raw.audio)
      durs.push(Math.round((raw.audio.length / raw.sampling_rate) * 10) / 10)
    }
    if (cancelled) return
    const merged = concatChunks(chunks, rate, Number(params.value.gap) || 0)
    durations.value = durs
    resultSeconds.value = Math.round((merged.length / rate) * 10) / 10
    resultUrl.value = URL.createObjectURL(rawAudioToWavBlob(merged, rate))
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    generating.value = false
    loadingModel.value = false
    currentLine.value = 0
    statusText.value = ''
  }
}

/** 试听单句（只合成这一句，快得多） */
async function preview(i: number) {
  if (generating.value) return
  const line = lines.value[i]
  if (!line) return
  error.value = null
  previewIndex.value = i
  previewUrl.value = revoke(previewUrl.value)
  loadingModel.value = true
  try {
    const { blob } = await kokoroSynthesize(line.text, voiceOf(line), Number(params.value.speed) || 1, onProgress)
    previewUrl.value = URL.createObjectURL(blob)
    await nextTick()
    audioEl.value?.play().catch(() => {})
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    loadingModel.value = false
    previewIndex.value = -1
  }
}

function cancel() { cancelled = true; generating.value = false; loadingModel.value = false; statusText.value = '' }

function download() {
  if (!resultUrl.value) return
  const a = document.createElement('a')
  a.href = resultUrl.value
  a.download = 'audiobook.wav'
  a.click()
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const totalChars = computed(() => lines.value.reduce((s, l) => s + l.text.length, 0))
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner
      :loading="generating || loadingModel"
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
          :loading="generating || loadingModel"
          :disabled="!lines.length"
          @click="generate"
        />
        <UButton
          v-if="generating || loadingModel"
          icon="i-lucide-x"
          :label="t('emotion.cancel')"
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
          v-if="generating || loadingModel"
          class="text-sm text-muted"
        >
          {{ statusText }}<template v-if="progress && !currentLine"> {{ progress }}%</template>
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
            {{ t('ab.totalDuration') }} {{ fmt(resultSeconds) }} ·
            {{ t('ab.chars', { n: totalChars }) }} · {{ t('vp.device') }} {{ device }}
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
