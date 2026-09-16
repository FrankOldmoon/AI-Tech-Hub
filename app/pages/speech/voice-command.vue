<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line */
/**
 * 语音口令控制台：对着麦说口令（左/右/上/下/跳/转/变红…）控制角色动画。
 *
 * Web Speech 样板（探测构造器 / 设 lang·continuous·interimResults / 遍历 resultIndex / 收 end·error）
 * 改由 `useSpeechRecognition` 承担，本页只留下「关键词表 + 角色动画」和两条源页面特有的策略：
 * 1) 命中后 600ms 内不重复触发同一句；
 * 2) 识别被浏览器自行 onend 后要自动重启，但致命错误（权限/服务/采集）不能重启。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'voice-command')!)

const { supported, listening, start: startRecognition, stop: stopRecognition } = useSpeechRecognition()

const hydrated = ref(false)
const lastCmd = ref('')
const error = ref<string | null>(null)

const x = ref(0)
const y = ref(0)
const angle = ref(0)
const jump = ref(false)
const color = ref('#f59e0b')

/** 是否已进入不可恢复的错误态：为 true 时 onEnd 不再自动重启识别 */
let fatalError = false
/** 用户是否还在「想听」：composable 的 onend 会先把 listening 置 false，不能拿它判断该不该重启 */
let wantListening = false
/** 上一事件已上报的最终文本长度：把 composable 的「累积 final」还原成源页面的「本次新增 final」 */
let reportedFinal = 0
/** 本次事件新增的最终文本，等 onInterim 到达后与中间文本拼成一条再匹配（源页面就是拼成一条匹配） */
let pendingFinal = ''
/** 上一句已命中的文本：短暂去重，避免同一次说话被反复触发 */
let lastMatched = ''

/** 这几类错误重启也没用（权限被拒 / 服务不可用 / 采不到音），必须停下来让用户处理 */
const FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture']

const COMMANDS: Record<string, string> = {
  ...zhLeft(),
  left: 'left', right: 'right', up: 'up', down: 'down', jump: 'jump', dance: 'dance', red: 'red', blue: 'blue'
}
function zhLeft() {
  const map: Record<string, string> = {}
  map['左'] = 'left'; map['左移'] = 'left'; map['右'] = 'right'; map['右移'] = 'right'
  map['上'] = 'up'; map['上移'] = 'up'; map['下'] = 'down'; map['下移'] = 'down'
  map['跳'] = 'jump'; map['跳一下'] = 'jump'; map['转'] = 'dance'; map['转一圈'] = 'dance'
  map['红色'] = 'red'; map['红'] = 'red'; map['蓝色'] = 'blue'; map['蓝'] = 'blue'
  map['绿色'] = 'green'; map['绿'] = 'green'
  return map
}

function runCmd(cmd: string) {
  switch (cmd) {
    case 'left': x.value = Math.max(-80, x.value - 16); break
    case 'right': x.value = Math.min(80, x.value + 16); break
    case 'up': y.value = Math.max(-80, y.value - 16); break
    case 'down': y.value = Math.min(80, y.value + 16); break
    case 'jump': jump.value = true; setTimeout(() => { jump.value = false }, 500); break
    case 'dance': angle.value = angle.value + 180; break
    case 'red': color.value = '#ef4444'; break
    case 'blue': color.value = '#3b82f6'; break
    case 'green': color.value = '#22c55e'; break
  }
}

function interpret(text: string): string | null {
  // 归一化：去除空格与中英文标点，只比对关键字
  const norm = text.replace(/[\s，。、,.!?！？]/g, '')
  for (const key of Object.keys(COMMANDS)) {
    if (norm.includes(key)) return COMMANDS[key]!
  }
  return null
}

onMounted(() => {
  // hydrated 只为 SSR 兜底：composable 的 supported 在挂载后才可信，服务端直接渲染「不支持」会与客户端不一致
  hydrated.value = true
})

function handleTranscript(text: string) {
  const cmd = interpret(text)
  if (cmd && text.trim() !== lastMatched) {
    runCmd(cmd)
    lastCmd.value = text.trim()
    lastMatched = text.trim()
    setTimeout(() => { lastMatched = '' }, 600)
  }
}

function beginRecognition() {
  // composable 每次 start 都新建识别器实例并清零累积文本，增量基线同步归零
  reportedFinal = 0
  pendingFinal = ''
  startRecognition({
    lang: 'zh-CN',
    continuous: true,
    interimResults: true,
    onFinal: (text) => {
      // composable 给的是「累积最终文本」，源页面只匹配本次新增的片段，取增量才对得上：
      // 否则上一句已 final 的话会一直参与匹配（如先「左」后「右」会被误判成「左」）
      pendingFinal = text.slice(reportedFinal)
      reportedFinal = text.length
    },
    onInterim: (text) => {
      handleTranscript(pendingFinal + text)
      pendingFinal = ''
    },
    onError: (msg) => {
      error.value = msg
      // 致命错误：置 wantListening=false 并标记，避免 onEnd 里无限重启
      // （曾实测 8s 内触发上万次 error）
      if (FATAL_ERRORS.includes(msg)) {
        fatalError = true
        wantListening = false
      }
    },
    onEnd: () => {
      // continuous 识别会被浏览器自行结束（说完一句/网络抖动），只要用户还想听且非致命错误就续上
      if (wantListening && !fatalError) beginRecognition()
    }
  })
}

function start() {
  if (!supported.value) return
  error.value = null
  fatalError = false
  wantListening = true
  beginRecognition()
}
function stop() {
  wantListening = false
  stopRecognition()
}
function reset() {
  x.value = 0; y.value = 0; angle.value = 0; jump.value = false; color.value = '#f59e0b'; lastCmd.value = ''
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-if="!listening"
          icon="i-lucide-mic"
          :label="t('speech.start')"
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
        <UButton
          icon="i-lucide-rotate-ccw"
          :label="t('mt.reset')"
          color="neutral"
          variant="subtle"
          @click="reset"
        />
        <span
          v-if="listening"
          class="text-sm text-muted"
        >{{ t('speech.listening') }}…</span>
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

      <p class="text-sm text-muted">
        {{ t('vc2.hint') }}: 左 / 右 / 上 / 下 / 跳 / 转 / 红 / 蓝 / 绿
      </p>
      <span
        v-if="lastCmd"
        class="inline-flex items-center gap-1 text-sm text-primary"
      >
        <UIcon
          name="i-lucide-volume-2"
          class="size-4"
        /> {{ lastCmd }}
      </span>

      <!-- 舞台 -->
      <div class="relative h-64 rounded-xl border border-default bg-elevated/40 overflow-hidden">
        <div
          class="absolute left-1/2 top-1/2 text-7xl transition-all duration-300"
          :class="jump ? '-translate-y-6' : ''"
          :style="{
            transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${angle}deg)`
          }"
        >
          <UIcon
            :name="'i-lucide-ghost'"
            :style="{ color: color }"
            class="size-20"
          />
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>
