<script setup lang="ts">
import type { ParamOption, ParamOptions, ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { kokoroVoices, kokoroVoiceGroups, kokoroSynthesize, loadKokoroModel, type KokoroProgress } from '~/utils/kokoro'

type TtsEngine = 'kokoro' | 'edge'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'tts')!)

const engine = ref<TtsEngine>('edge')

const engineItems = computed(() => [
  { key: 'edge' as const, label: t('tts.engineEdge'), icon: 'i-lucide-cloud' },
  { key: 'kokoro' as const, label: t('tts.engineKokoro'), icon: 'i-lucide-cpu' }
])

const text = ref(
  '欢迎来到 AI 技术展厅，体验语音合成。Hi there! Welcome to the AI Tech Hub, try text-to-speech here.'
)

/** Edge TTS 发音人（微软 voice list 经服务端代理 + 12h 缓存） */
interface EdgeVoice { shortName: string, locale: string, gender: string, friendlyName: string }

const { data: edgeVoicesData, error: edgeVoicesError } = await useFetch<{ voices: EdgeVoice[] }>(
  '/api/speech/tts-voices',
  { server: false }
)

/** voice 下拉：按语言分组（Nuxt UI v3 Select 分组结构 = 数组的数组，组标题用 type:'label' 条目） */
const voiceItems = computed<ParamOptions>(() =>
  kokoroVoiceGroups
    .map((g) => {
      const groupVoice = kokoroVoices
        .filter(v => v.lang === g.lang)
        .map(v => ({
          label: `${v.name} · ${v.gender === 'female' ? '女' : '男'}`,
          value: v.id
        }))
      if (groupVoice.length === 0) return null
      return [{ type: 'label' as const, label: g.label }, ...groupVoice]
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
)

/** Edge voice 常用语种优先顺序，其余并入「其他语言」组 */
const EDGE_PREFERRED_LOCALES = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi']
const localeLabel: Record<string, string> = {
  zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français',
  de: 'Deutsch', es: 'Español', pt: 'Português', it: 'Italiano', ru: 'Русский',
  ar: 'العربية', hi: 'हिन्दी'
}

const edgeVoiceItems = computed<ParamOptions>(() => {
  const voices = edgeVoicesData.value?.voices ?? []
  if (voices.length === 0) return []
  const buckets = new Map<string, ParamOption[]>()
  for (const v of voices) {
    const main = v.locale.split('-')[0]!.toLowerCase()
    const list = buckets.get(main) ?? []
    list.push({
      label: `${v.friendlyName} · ${v.gender.toLowerCase() === 'female' ? '女' : '男'}`,
      value: v.shortName
    })
    buckets.set(main, list)
  }
  const mains = [...buckets.keys()].sort(
    (a, b) => (EDGE_PREFERRED_LOCALES.includes(a) ? -1 : 1) - (EDGE_PREFERRED_LOCALES.includes(b) ? -1 : 1)
  )
  const groups: ParamOption[][] = []
  for (const main of mains) {
    const options = (buckets.get(main) ?? []).sort((a, b) => a.label.localeCompare(b.label, 'zh'))
    groups.push([
      { type: 'label' as const, label: localeLabel[main] ?? main.toUpperCase() },
      ...options
    ])
  }
  return groups
})

const specs = computed<ParamSpec[]>(() => {
  if (engine.value === 'edge') {
    return [
      {
        key: 'voice',
        label: t('tts.voice'),
        type: 'select',
        default: 'zh-CN-XiaoxiaoNeural',
        options: edgeVoiceItems.value
      },
      {
        key: 'speed',
        label: t('tts.speed'),
        type: 'slider',
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
        help: t('tts.speedHelp')
      }
    ]
  }
  return [
    {
      key: 'voice',
      label: t('tts.voice'),
      type: 'select',
      default: 'zf_xiaoxiao',
      options: voiceItems.value
    },
    {
      key: 'speed',
      label: t('tts.speed'),
      type: 'slider',
      default: 1,
      min: 0.5,
      max: 2,
      step: 0.1,
      help: t('tts.speedHelp')
    }
  ]
})
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

// 切换引擎时重建参数默认值（voice 各引擎互不通用）
watch(engine, () => {
  params.value = paramDefaults(specs.value)
})

const loading = ref(false)
const error = ref<string | null>(null)
const audioSrc = ref('')
const audioFormat = ref<'wav' | 'mp3'>('wav')

/** 模型加载状态：idle → loading(含进度) → ready / error（仅 kokoro 引擎使用） */
const modelStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const modelProgress = ref(0)
const modelStatusText = ref('')
/** 最近一次推理的设备与耗时（用于课堂讲解） */
const lastRunInfo = ref('')

/** 释放之前的 object URL，避免内存泄漏 */
function revokeAudioSrc() {
  if (audioSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(audioSrc.value)
  }
}

function onModelProgress(p: KokoroProgress) {
  if (typeof p.progress === 'number') {
    modelProgress.value = Math.round(p.progress)
  }
  modelStatusText.value = p.status || ''
}

async function ensureModel() {
  if (modelStatus.value === 'ready' || modelStatus.value === 'loading') {
    return modelStatus.value === 'ready'
  }
  modelStatus.value = 'loading'
  modelProgress.value = 0
  modelStatusText.value = t('tts.modelDownloading')
  try {
    await loadKokoroModel(onModelProgress)
    modelStatus.value = 'ready'
    modelStatusText.value = ''
    return true
  } catch (e) {
    modelStatus.value = 'error'
    modelStatusText.value = humanError(e, t)
    error.value = humanError(e, t)
    return false
  }
}

/** Edge TTS：服务端合成，返回 mp3 blob（speed 1.0 → rate +0%，2.0 → +100%） */
async function edgeSynthesize(textValue: string, voice: string, speed: number): Promise<{ blob: Blob, ms: number }> {
  const rate = `${Math.round((speed - 1) * 100)}%`
  const start = performance.now()
  const blob = await $fetch('/api/speech/tts', {
    method: 'POST',
    body: {
      text: textValue,
      voice,
      rate,
      pitch: '+0Hz',
      volume: '+0%'
    },
    responseType: 'blob'
  })
  return { blob, ms: Math.round(performance.now() - start) }
}

async function synthesize() {
  revokeAudioSrc()
  error.value = null
  audioSrc.value = ''
  const textValue = text.value.trim()
  if (!textValue) {
    error.value = t('tts.emptyText')
    return
  }
  loading.value = true
  try {
    if (engine.value === 'edge') {
      const { blob, ms } = await edgeSynthesize(
        textValue,
        String(params.value.voice),
        Number(params.value.speed) || 1
      )
      audioFormat.value = 'mp3'
      audioSrc.value = URL.createObjectURL(blob)
      lastRunInfo.value = `Edge TTS · ${ms}ms`
    } else {
      if (!(await ensureModel())) return
      const { blob, device, ms } = await kokoroSynthesize(
        textValue,
        String(params.value.voice),
        Number(params.value.speed) || 1
      )
      audioFormat.value = 'wav'
      audioSrc.value = URL.createObjectURL(blob)
      lastRunInfo.value = `${device} · ${ms}ms`
    }
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(revokeAudioSrc)

function downloadAudio() {
  if (!audioSrc.value) return
  const a = document.createElement('a')
  a.href = audioSrc.value
  a.download = `tts.${audioFormat.value}`
  a.click()
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner
      :loading="loading"
      :error="error"
    >
      <!-- 输入 -->
      <template #input>
        <!-- 引擎切换：Edge TTS（在线服务）/ Kokoro（本地推理） -->
        <div class="mb-4 flex items-center gap-2">
          <span class="text-sm text-muted">
            {{ t('tts.engine') }}
          </span>
          <button
            v-for="item in engineItems"
            :key="item.key"
            type="button"
            class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer"
            :class="engine === item.key
              ? 'bg-primary border-primary text-white'
              : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
            @click="engine = item.key"
          >
            <UIcon
              :name="item.icon"
              class="size-4"
            />
            {{ item.label }}
          </button>
        </div>

        <UTextarea
          v-model="text"
          :rows="5"
          :placeholder="t('tts.inputPlaceholder')"
          class="w-full"
        />

        <div class="mt-4">
          <DemoParams
            v-model="params"
            :specs="specs"
            :running="loading"
            :title="t('params.title')"
          />
        </div>

        <!-- 引擎说明行 -->
        <p
          v-if="engine === 'edge'"
          class="mt-1.5 text-xs text-dimmed"
        >
          {{ t('tts.edgeNote') }}
        </p>
        <p
          v-if="engine === 'edge' && edgeVoicesError"
          class="mt-1.5 text-xs text-amber-500"
        >
          {{ t('tts.edgeVoiceError') }}
        </p>

        <!-- 模型加载进度条（仅 kokoro 引擎） -->
        <div
          v-if="engine === 'kokoro' && modelStatus === 'loading'"
          class="mt-3"
        >
          <div class="flex items-center justify-between text-xs text-muted mb-1">
            <span class="flex items-center gap-1.5">
              <UIcon
                name="i-lucide-loader-circle"
                class="size-3.5 animate-spin text-primary"
              />
              {{ t('tts.modelLoading') }}
            </span>
            <span>{{ modelProgress }}%</span>
          </div>
          <UProgress
            :value="modelProgress"
            class="h-1.5"
          />
          <p class="mt-1.5 text-xs text-dimmed truncate">
            {{ modelStatusText }}
          </p>
        </div>

        <!-- 就绪提示（仅 kokoro 首次加载后显示） -->
        <p
          v-if="engine === 'kokoro' && modelStatus === 'ready'"
          class="mt-3 flex items-center gap-1.5 text-xs text-dimmed"
        >
          <UIcon
            name="i-lucide-shield-check"
            class="size-3.5 text-primary"
          />
          {{ t('tts.localReady') }}
        </p>
      </template>

      <!-- 控件 -->
      <template #controls>
        <UButton
          icon="i-lucide-wand-sparkles"
          :label="engine === 'edge'
            ? t('tts.edgeRun')
            : (modelStatus === 'ready' ? t('demo.run') : t('tts.firstRun'))"
          :loading="loading"
          color="primary"
          @click="synthesize"
        />
        <UButton
          v-if="audioSrc"
          icon="i-lucide-download"
          :label="t('tts.download')"
          color="neutral"
          variant="subtle"
          @click="downloadAudio"
        />
      </template>

      <!-- 结果 -->
      <template #result>
        <template v-if="audioSrc">
          <audio
            :src="audioSrc"
            controls
            class="w-full"
          />
          <p
            v-if="lastRunInfo"
            class="mt-2 text-xs text-dimmed"
          >
            {{ t('tts.runInfo') }}：{{ lastRunInfo }}
          </p>
        </template>
        <div
          v-else
          class="text-sm text-muted"
        >
          —
        </div>
      </template>
    </DemoRunner>
  </MediaDemoShell>
</template>
