<script setup lang="ts">
/**
 * 实时语速计：麦克风流式识别，实时统计 字数/分 与节奏。
 *
 * Web Speech 样板（取构造器 / 设 lang·continuous·interimResults / 从 resultIndex 遍历结果 /
 * 收 onend·onerror）与 asr 页原本是同一份拷贝，改由 `useSpeechRecognition` 收拢：
 * `supported`（含 SSR 探测）与 `listening` 由它给出，本页只留下语速计自己的东西——秒表与 CPM/WPM。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'speech-rate')!)

const { supported, listening, start: startRecognition, stop: stopRecognition } = useSpeechRecognition()

const hydrated = ref(false)
const interim = ref('')
const finalText = ref('')
const elapsed = ref(0)
const error = ref<string | null>(null)
const cpm = ref(0)
const wpm = ref(0)
/** 已识别字符数（响应式：模板与 cpm/wpm 一起刷新，不再依赖其它 ref 顺带触发渲染） */
const chars = ref(0)

let timer: number | null = null

onMounted(() => {
  // hydrated 仍要留：composable 的 supported 在挂载后才可信，服务端直接渲染「不支持」会与客户端不一致
  hydrated.value = true
})

function beginRecognition() {
  startRecognition({
    lang: 'zh-CN',
    continuous: true,
    interimResults: true,
    // composable 的 onFinal 给的是「累积最终文本」：最终文本只增不减，直接覆盖并重算字符数，
    // 与源页面按 result 逐个累加 finalText / chars 等价
    onFinal: (text) => {
      finalText.value = text
      chars.value = text.replace(/\s/g, '').length
    },
    // 每次 result 事件都会回调（无中间结果时为空串），源页面同样是「覆写」而非累积
    onInterim: (text) => {
      interim.value = text
    },
    onError: (msg) => {
      error.value = msg
      stop()
    }
  })
}

function start() {
  if (!supported.value) return
  error.value = null
  finalText.value = ''
  interim.value = ''
  chars.value = 0
  elapsed.value = 0
  cpm.value = 0
  wpm.value = 0
  if (timer !== null) clearInterval(timer)
  timer = window.setInterval(() => {
    elapsed.value++
    const mins = elapsed.value / 60 || 1e-9
    cpm.value = Math.round(chars.value / mins)
    wpm.value = Math.round((chars.value / 5) / mins) // 以 5 字符/词 估算
  }, 1000)
  beginRecognition()
}

function stop() {
  stopRecognition()
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

onBeforeUnmount(() => {
  // 识别器由 composable 在自己的 onBeforeUnmount 里关；秒表是本页私有的，必须自己清，
  // 否则卸载后 interval 仍在跑
  if (timer !== null) clearInterval(timer)
})
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
          :label="t('speech.stop')"
          color="error"
          variant="subtle"
          @click="stop"
        />
        <span
          v-if="listening"
          class="text-sm text-muted"
        >{{ t('speech.listening') }}…</span>
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
          :title="t('speech.unsupportedRecognition')"
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
