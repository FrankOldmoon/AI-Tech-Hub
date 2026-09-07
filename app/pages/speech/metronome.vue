<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line */
/** 节拍器 + 打拍检测：设定 BPM 听节拍；或用节拍器音色与手动打拍算出你的 BPM 对齐度 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'metronome')!)

const bpm = ref(90)
const running = ref(false)
const booming = ref(false)
// 手动打拍
const taps = ref<number[]>([])
const estimatedBpm = ref<number | null>(null)
const alignPct = ref<number | null>(null)
const alignment = ref<string | null>(null)
const lastTapAt = ref<number | null>(null)

let ctx: AudioContext | null = null
let timer: number | null = null
let nextTime = 0
let beat = 0

async function startMetro() {
  if (!ctx) ctx = new AudioContext()
  if (running.value) return
  running.value = true
  beat = 0
  nextTime = ctx.currentTime + 0.05
  schedule()
}

function schedule() {
  if (!ctx || !running.value) return
  const interval = 60 / bpm.value
  while (nextTime < ctx.currentTime + 1) {
    click(nextTime, beat)
    beat++
    nextTime += interval
  }
  timer = window.setTimeout(schedule, Math.max(50, (nextTime - ctx.currentTime) * 1000 - 30))
}

function click(time: number, beatIdx: number) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const freq = beatIdx % 4 === 0 ? 1200 : 800
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.4, time)
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06)
  osc.connect(gain).connect(ctx.destination)
  osc.start(time); osc.stop(time + 0.07)
}

function stopMetro() {
  running.value = false
  if (timer !== null) { clearTimeout(timer); timer = null }
}

// ---- 手动打拍 ----
function tap(e: MouseEvent) {
  e.preventDefault()
  const now = performance.now()
  if (lastTapAt.value != null && now - lastTapAt.value < 200) return
  lastTapAt.value = now
  taps.value.push(now)
  if (taps.value.length > 24) taps.value.shift()
  if (taps.value.length >= 2) {
    const intervals: number[] = []
    for (let i = 1; i < taps.value.length; i++) intervals.push(taps.value[i]! - taps.value[i - 1]!)
    intervals.sort((a, b) => a - b)
    const median = intervals[Math.floor(intervals.length / 2)] ?? 0
    estimatedBpm.value = Math.round(60000 / median)
    boom()
    if (bpm.value > 0) {
      const target = 60000 / bpm.value
      let diff = ((median / target % 1) + 1) % 1
      if (diff > 0.5) diff = 1 - diff
      alignPct.value = Math.round((1 - diff) * 100)
      alignment.value = alignPct.value >= 90 ? t('mt.ace') : alignPct.value >= 70 ? t('mt.good') : t('mt.keep')
    }
  }
}

function boom() {
  if (!ctx) ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'; osc.frequency.value = 1800
  gain.gain.setValueAtTime(0.2, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start(); osc.stop(ctx.currentTime + 0.06)
  booming.value = true
  setTimeout(() => { booming.value = false }, 60)
}

function resetTaps() {
  taps.value = []; estimatedBpm.value = null; alignPct.value = null; alignment.value = null; lastTapAt.value = null
}

onBeforeUnmount(stopMetro)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <div class="space-y-4">
        <p class="text-sm text-muted">
          {{ t('mt.hint') }}
        </p>
        <div class="flex flex-wrap items-center gap-4">
          <label
            class="text-sm text-muted"
            for="bpm"
          >{{ t('mt.bpm') }}</label>
          <input
            id="bpm"
            v-model.number="bpm"
            type="range"
            min="40"
            max="220"
            class="w-48 accent-primary"
          >
          <span class="tabular-nums text-highlighted min-w-12">{{ bpm }} BPM</span>
          <UButton
            v-if="!running"
            icon="i-lucide-play"
            :label="t('mt.start')"
            color="primary"
            @click="startMetro"
          />
          <UButton
            v-else
            icon="i-lucide-square"
            :label="t('mt.stop')"
            color="error"
            variant="subtle"
            @click="stopMetro"
          />
        </div>
      </div>

      <!-- 打拍区 -->
      <div class="space-y-3">
        <p class="text-sm text-muted">
          {{ t('mt.tapHint') }}
        </p>
        <div
          class="relative h-40 rounded-xl border-2 border-dashed flex items-center justify-center select-none cursor-pointer transition-transform"
          :class="booming ? 'scale-95 border-primary' : 'border-default'"
          @pointerdown="tap"
        >
          <UIcon
            name="i-lucide-hand"
            class="size-10 text-muted"
          />
          <span class="text-sm text-muted ms-2">{{ t('mt.tapZone') }}</span>
        </div>

        <div
          v-if="estimatedBpm"
          class="grid grid-cols-3 gap-3"
        >
          <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
            <p class="text-2xl font-bold tabular-nums text-primary">
              {{ estimatedBpm }}
            </p>
            <p class="text-xs text-muted mt-1">
              {{ t('mt.youBpm') }}
            </p>
          </div>
          <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
            <p
              class="text-2xl font-bold tabular-nums"
              :class="(alignPct ?? 0) >= 90 ? 'text-green-500' : 'text-amber-500'"
            >
              {{ alignPct }}%
            </p>
            <p class="text-xs text-muted mt-1">
              {{ t('mt.align') }}
            </p>
          </div>
          <div class="rounded-xl border border-default bg-elevated/40 p-4 text-center">
            <p class="text-2xl font-bold text-highlighted">
              {{ alignment }}
            </p>
            <p class="text-xs text-muted mt-1">
              {{ t('mt.judgement') }}
            </p>
          </div>
        </div>

        <UButton
          v-if="taps.length"
          icon="i-lucide-rotate-ccw"
          :label="t('mt.reset')"
          color="neutral"
          variant="subtle"
          @click="resetTaps"
        />
      </div>
    </div>
  </MediaDemoShell>
</template>
