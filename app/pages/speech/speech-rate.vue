<script setup lang="ts">
/** 实时语速计：麦克风流式识别，实时统计 字数/分 与节奏 */
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'speech-rate')!)

const supported = ref(false)
const hydrated = ref(false)
const listening = ref(false)
const interim = ref('')
const finalText = ref('')
const elapsed = ref(0)
const error = ref<string | null>(null)
const cpm = ref(0)
const wpm = ref(0)

let recognition: any = null
let timer: number | null = null
let chars = 0

onMounted(() => {
  hydrated.value = true
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) { supported.value = false; return }
  supported.value = true
  recognition = new SR()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'zh-CN'
  recognition.onresult = (e: any) => {
    let interimText = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tx = e.results[i][0].transcript
      if (e.results[i].isFinal) { finalText.value += tx; chars += tx.replace(/\s/g, '').length } else interimText += tx
    }
    interim.value = interimText
  }
  recognition.onerror = (e: any) => { error.value = e.error || 'error'; stop() }
  recognition.onend = () => { listening.value = false }
})

function start() {
  if (!recognition) return
  error.value = null
  finalText.value = ''; interim.value = ''; chars = 0
  elapsed.value = 0; cpm.value = 0; wpm.value = 0
  if (timer !== null) clearInterval(timer)
  timer = window.setInterval(() => {
    elapsed.value++
    const mins = elapsed.value / 60 || 1e-9
    cpm.value = Math.round(chars / mins)
    wpm.value = Math.round((chars / 5) / mins) // 以 5 字符/词 估算
  }, 1000)
  try { recognition.start(); listening.value = true } catch { /* */ }
}

function stop() {
  try { recognition?.stop() } catch { /* */ }
  listening.value = false
  if (timer !== null) { clearInterval(timer); timer = null }
}

onBeforeUnmount(() => { stop(); recognition?.stop() })
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-if="!listening"
          icon="i-lucide-mic"
          :label="t('sr.start')"
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
        <span
          v-if="listening"
          class="text-sm text-muted"
        >{{ t('asr.listening') }}…</span>
        <UButton
          v-if="finalText"
          icon="i-lucide-eraser"
          :label="t('demo.reset')"
          color="neutral"
          variant="subtle"
          @click="start"
        />
      </div>

      <template v-if="hydrated && !supported">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="t('asr.unsupported')"
        />
      </template>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <!-- 实时指标 -->
      <div
        v-if="listening || elapsed"
        class="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
          <p class="text-3xl font-bold tabular-nums text-primary">
            {{ cpm }}
          </p>
          <p class="text-xs text-muted mt-1">
            {{ t('sr.cpm') }}
          </p>
        </div>
        <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
          <p class="text-3xl font-bold tabular-nums text-primary">
            {{ wpm }}
          </p>
          <p class="text-xs text-muted mt-1">
            {{ t('sr.wpm') }}
          </p>
        </div>
        <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
          <p class="text-3xl font-bold tabular-nums text-highlighted">
            {{ chars }}
          </p>
          <p class="text-xs text-muted mt-1">
            {{ t('sr.chars') }}
          </p>
        </div>
        <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
          <p class="text-3xl font-bold tabular-nums text-highlighted">
            {{ elapsed }}s
          </p>
          <p class="text-xs text-muted mt-1">
            {{ t('sr.time') }}
          </p>
        </div>
      </div>

      <!-- 识别文本 -->
      <div
        v-if="finalText || interim"
        class="rounded-lg border border-default bg-elevated/40 p-4"
      >
        <p class="text-base text-highlighted whitespace-pre-wrap break-words">
          <span>{{ finalText }}</span><span class="text-muted">{{ interim }}</span>
        </p>
      </div>
    </div>
  </MediaDemoShell>
</template>
