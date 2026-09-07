<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/** 语音口令控制台：对着麦说口令（左/右/上/下/跳/转/变红…）控制角色动画 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'voice-command')!)

const supported = ref(false)
const hydrated = ref(false)
const listening = ref(false)
const lastCmd = ref('')
const error = ref<string | null>(null)

const x = ref(0)
const y = ref(0)
const angle = ref(0)
const jump = ref(false)
const color = ref('#f59e0b')

let recognition: any = null

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
  hydrated.value = true
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) { supported.value = false; return }
  supported.value = true
  recognition = new SR()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'zh-CN'
  // 同时处理中间与最终结果，提升响应；命中即触发
  let lastMatched = ''
  recognition.onresult = (e: any) => {
    let text = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript
    }
    const cmd = interpret(text)
    if (cmd && text.trim() !== lastMatched) {
      runCmd(cmd)
      lastCmd.value = text.trim()
      lastMatched = text.trim()
      setTimeout(() => { lastMatched = '' }, 600)
    }
  }
  recognition.onerror = (e: any) => { error.value = e.error || 'error' }
  recognition.onend = () => { if (listening.value) try { recognition.start() } catch { /* */ } }
})

function start() {
  if (!recognition) return
  error.value = null
  try { recognition.start(); listening.value = true } catch { /* */ }
}
function stop() {
  listening.value = false
  try { recognition.stop() } catch { /* */ }
}
function reset() {
  x.value = 0; y.value = 0; angle.value = 0; jump.value = false; color.value = '#f59e0b'; lastCmd.value = ''
}

onBeforeUnmount(stop)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
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
          icon="i-lucide-rotate-ccw"
          :label="t('mt.reset')"
          color="neutral"
          variant="subtle"
          @click="reset"
        />
        <span
          v-if="listening"
          class="text-sm text-muted"
        >{{ t('asr.listening') }}…</span>
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
