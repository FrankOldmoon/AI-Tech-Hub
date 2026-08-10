<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'tts')!)

const text = ref(
  '你好，这是一个用 Nuxt v4 构建的 AI 技术演示。Hello, this is an AI tech demo built with Nuxt v4.'
)

const edgeVoiceItems = [
  { label: '晓晓 Xiaoxiao · zh-CN 女', value: 'zh-CN-XiaoxiaoNeural' },
  { label: '云希 Yunxi · zh-CN 男', value: 'zh-CN-YunxiNeural' },
  { label: '云扬 Yunyang · zh-CN 男', value: 'zh-CN-YunyangNeural' },
  { label: '晓伊 Xiaoyi · zh-CN 女', value: 'zh-CN-XiaoyiNeural' },
  { label: 'Aria · en-US 女', value: 'en-US-AriaNeural' },
  { label: 'Guy · en-US 男', value: 'en-US-GuyNeural' },
  { label: 'Jenny · en-US 女', value: 'en-US-JennyNeural' }
]

const specs = computed<ParamSpec[]>(() => [
  { key: 'voice', label: t('tts.voice'), type: 'select', default: 'zh-CN-XiaoxiaoNeural', options: edgeVoiceItems },
  { key: 'rate', label: t('tts.rate'), type: 'slider', default: 0, min: -50, max: 100, step: 5, help: t('tts.rateHelp') },
  { key: 'volume', label: t('tts.volume'), type: 'slider', default: 0, min: -100, max: 100, step: 5, help: t('tts.volumeHelp') },
  { key: 'pitch', label: t('tts.pitch'), type: 'slider', default: 0, min: -50, max: 50, step: 1, help: t('tts.pitchHelp') }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

const loading = ref(false)
const error = ref<string | null>(null)
const audioSrc = ref('')
const audioFormat = ref('mp3')

async function synthesize() {
  error.value = null
  audioSrc.value = ''
  loading.value = true
  try {
    const res = await runPython<{ audio?: string, format?: string }>({
      feature: 'speech/tts',
      input: text.value,
      params: {
        voice: String(params.value.voice),
        rate: Number(params.value.rate),
        volume: Number(params.value.volume),
        pitch: Number(params.value.pitch)
      }
    })
    if (!res.available) {
      error.value = t('demo.backendUnavailable')
    } else if (!res.ok) {
      error.value = res.error || 'error'
    } else if (res.data?.audio) {
      audioFormat.value = res.data.format || 'mp3'
      audioSrc.value = `data:audio/${audioFormat.value};base64,${res.data.audio}`
    } else {
      error.value = res.error || 'no audio'
    }
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
  } finally {
    loading.value = false
  }
}

function downloadAudio() {
  if (!audioSrc.value) return
  const a = document.createElement('a')
  a.href = audioSrc.value
  a.download = `tts.${audioFormat.value}`
  a.click()
}
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
      >
        <!-- 输入 -->
        <template #input>
          <UTextarea
            v-model="text"
            :rows="5"
            :placeholder="t('tts.inputPlaceholder')"
            class="w-full"
          />

          <div class="mt-4">
            <DemoParams v-model="params" :specs="specs" :running="loading" :title="t('params.title')" />
          </div>
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            icon="i-lucide-wand-sparkles"
            :label="t('demo.run')"
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
          <audio v-if="audioSrc" :src="audioSrc" controls class="w-full" />
          <div v-else class="text-sm text-muted">—</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
