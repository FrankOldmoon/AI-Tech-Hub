<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'asr')!)

// ===== 浏览器 SpeechRecognition（SSR 安全，onMounted 中初始化）=====
const supported = ref(false)
const listening = ref(false)
const interim = ref('')
const finalText = ref('')
const error = ref<string | null>(null)

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
    error.value = e.error || 'error'
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
  error.value = null
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
  error.value = null
}

onBeforeUnmount(() => {
  if (recognition) recognition.stop()
})

// DemoRunner 绑定
const runnerError = computed(() => error.value)
const runnerNotice = computed(() => supported.value ? null : t('asr.unsupported'))
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
          <p class="text-sm text-muted mb-4">{{ t('asr.hint') }}</p>
          <DemoParams v-model="params" :specs="specs" :running="listening" :title="t('params.title')" />
        </template>

        <!-- 控件 -->
        <template #controls>
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

        <!-- 结果 -->
        <template #result>
          <div v-if="listening || finalText || interim" class="space-y-2">
            <div v-if="listening" class="flex items-center gap-2 text-sm text-primary">
              <UIcon name="i-lucide-mic" class="size-4 animate-pulse" />
              {{ t('asr.listening') }}…
            </div>
            <p class="text-base text-highlighted whitespace-pre-wrap break-words">
              <span>{{ finalText }}</span><span class="text-muted">{{ interim }}</span>
            </p>
          </div>
          <div v-else class="text-sm text-muted">—</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
