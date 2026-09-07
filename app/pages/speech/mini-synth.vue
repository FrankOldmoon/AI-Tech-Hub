<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line */
/** 迷你合成器：点击琴键用 WebAudio 三角波 + 包络发声，支持延音（C4–B6） */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'mini-synth')!)

const playingKey = ref<string | null>(null)
const volume = ref(70)

let ctx: AudioContext | null = null

// ---- 生成 C4–B6 键盘（38 键）----
interface KeyDef { id: string, freq: number, label: string }
interface WhiteKey extends KeyDef { blackAfter: boolean }

const WHITE_SEMI: Array<[string, number, boolean]> = [
  ['C', 0, true], ['D', 2, true], ['E', 4, false],
  ['F', 5, true], ['G', 7, true], ['A', 9, true], ['B', 11, false]
]

const whites = computed<WhiteKey[]>(() => {
  const out: WhiteKey[] = []
  for (let oct = 4; oct <= 6; oct++) {
    const base = (oct + 1) * 12
    for (const [name, semi, blackAfter] of WHITE_SEMI) {
      const midi = base + semi
      out.push({ id: `${name}${oct}`, freq: 440 * Math.pow(2, (midi - 69) / 12), label: `${name}${oct}`, blackAfter })
    }
  }
  return out
})

const blacks = computed<Array<{ id: string, freq: number, afterIdx: number }>>(() => {
  const out: Array<{ id: string, freq: number, afterIdx: number }> = []
  let acc = 0
  for (let oct = 4; oct <= 6; oct++) {
    const base = (oct + 1) * 12
    for (let i = 0; i < WHITE_SEMI.length; i++) {
      const [, semi, blackAfter] = WHITE_SEMI[i]!
      if (blackAfter) {
        const midi = base + semi + 1
        out.push({ id: `${WHITE_SEMI[i]![0]}#${oct}`, freq: 440 * Math.pow(2, (midi - 69) / 12), afterIdx: acc + i + 1 })
      }
    }
    acc += WHITE_SEMI.length
  }
  return out
})

const whiteCount = computed(() => whites.value.length)

function blackLeft(idx: number): string {
  return `${((idx - 1) / Math.max(1, whiteCount.value)) * 100}%`
}

function ensure() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function playKey(id: string, freq: number) {
  const ac = ensure()
  const t0 = ac.currentTime
  const v = volume.value / 100
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = freq
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(v, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1)
  const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq * 0.5
  const subGain = ac.createGain(); subGain.gain.value = 0.12
  osc.connect(gain); sub.connect(subGain); subGain.connect(gain)
  gain.connect(ac.destination)
  osc.start(t0); sub.start(t0); osc.stop(t0 + 1.2); sub.stop(t0 + 1.2)
  playingKey.value = id
  setTimeout(() => { if (playingKey.value === id) playingKey.value = null }, 120)
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4">
      <div class="flex items-center gap-4">
        <label
          class="text-sm text-muted"
          for="vol"
        >{{ t('ms.volume') }}</label>
        <input
          id="vol"
          v-model.number="volume"
          type="range"
          min="10"
          max="100"
          class="w-40 accent-primary"
        >
        <span class="text-sm text-muted tabular-nums">{{ volume }}%</span>
      </div>

      <!-- 琴键（C4–B6） -->
      <div
        class="relative h-44 overflow-x-auto"
        @pointerleave="playingKey = null"
      >
        <div class="absolute inset-0 flex min-w-[720px]">
          <div
            v-for="k in whites"
            :key="k.id"
            class="flex-1 mx-px rounded-b-lg border border-default cursor-pointer flex items-end justify-center pb-2 text-[10px] text-muted bg-elevated/60 hover:bg-primary/15"
            :class="playingKey === k.id ? 'bg-primary/25' : ''"
            @pointerdown="playKey(k.id, k.freq)"
          >
            {{ k.label }}
          </div>
        </div>
        <div class="absolute top-0 left-0 right-0 h-[58%] min-w-[720px]">
          <div
            v-for="b in blacks"
            :key="b.id"
            class="absolute w-6 -translate-x-1/2 bg-zinc-900 border border-black/50 rounded-b cursor-pointer z-10 hover:bg-zinc-700"
            :class="playingKey === b.id ? 'bg-primary/70' : ''"
            :style="{ left: blackLeft(b.afterIdx), top: 0, bottom: 0 }"
            @pointerdown="playKey(b.id, b.freq)"
            @click.stop
          />
        </div>
      </div>

      <p class="text-sm text-muted">
        {{ t('ms.hint') }}
      </p>
    </div>
  </MediaDemoShell>
</template>
