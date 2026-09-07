<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/** 变声精灵：麦克风实时加效果（机器人/怪物/混响/变调），纯 WebAudio 本端 */
import { mediaError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('speech', 'voice-changer')!)

const running = ref(false)
const error = ref<string | null>(null)

type EffectId = 'off' | 'robot' | 'monster' | 'echo' | 'chipmunk' | 'deep'
const effectId = ref<EffectId>('off')

const effectItems = computed(() => [
  { id: 'off' as const, label: t('vc.off'), icon: 'i-lucide-volume-x' },
  { id: 'robot' as const, label: t('vc.robot'), icon: 'i-lucide-bot' },
  { id: 'monster' as const, label: t('vc.monster'), icon: 'i-lucide-skull' },
  { id: 'echo' as const, label: t('vc.echo'), icon: 'i-lucide-echo-off' },
  { id: 'chipmunk' as const, label: t('vc.chipmunk'), icon: 'i-lucide-rat' },
  { id: 'deep' as const, label: t('vc.deep'), icon: 'i-lucide-volcano' }
])

let audioCtx: AudioContext | null = null
let stream: MediaStream | null = null
let dest: MediaStreamAudioDestinationNode | null = null
// 效果链：source → wetIn → [效果节点…] → wetOut → dest；dry 直通 dest
let wetIn: GainNode | null = null
let wetOut: GainNode | null = null
let effectEntry: AudioNode | null = null
let oscBank: AudioScheduledSourceNode[] = []

const audioEl = ref<HTMLAudioElement>()

function connect(node: AudioNode): AudioNode {
  node.connect(wetOut!)
  return node
}

async function start() {
  if (running.value) return
  error.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    audioCtx = new AudioContext()
    dest = audioCtx.createMediaStreamDestination()

    const source = audioCtx.createMediaStreamSource(stream)
    const dry = audioCtx.createGain(); dry.gain.value = 1
    source.connect(dry); dry.connect(dest)

    wetIn = audioCtx.createGain(); wetIn.gain.value = 1
    source.connect(wetIn)
    wetOut = audioCtx.createGain(); wetOut.gain.value = 0
    wetOut.connect(dest)

    applyEffect()

    if (audioEl.value) {
      audioEl.value.srcObject = dest.stream
      audioEl.value.play().catch(() => {})
    }
    running.value = true
  } catch (e: any) {
    error.value = mediaError(e, t)
    teardown()
  }
}

function applyEffect() {
  if (!audioCtx || !wetIn || !wetOut) return
  oscBank.forEach((o) => { try { o.stop() } catch { /* */ } })
  oscBank = []
  if (effectEntry) { try { effectEntry.disconnect() } catch { /* */ } effectEntry = null }

  const id = effectId.value
  if (id === 'off' || !audioCtx) {
    wetOut.gain.value = 0
    return
  }
  const ctx = audioCtx
  let entry: AudioNode | null = null
  switch (id) {
    case 'robot': {
      // 环调（~30Hz）+ 带通 → 机械感
      const wet = ctx.createGain(); wet.gain.value = 0.5
      const ring = ctx.createGain()
      const lfo = ctx.createOscillator(); lfo.frequency.value = 30
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.8
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 3
      lfo.connect(lfoGain); lfoGain.connect(ring.gain); lfo.start(); oscBank.push(lfo)
      wet.connect(ring); ring.connect(bp); connect(bp)
      entry = wet
      wetOut.gain.value = 0.9
      break
    }
    case 'monster': {
      const shaper = ctx.createWaveShaper()
      const curve = new Float32Array(256)
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3.2) }
      shaper.curve = curve
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850
      shaper.connect(lp); connect(lp)
      entry = shaper
      wetOut.gain.value = 1
      break
    }
    case 'echo': {
      const feed = ctx.createGain(); feed.gain.value = 0.5
      const delay = ctx.createDelay(1.2); delay.delayTime.value = 0.4
      const fb = ctx.createGain(); fb.gain.value = 0.45
      feed.connect(delay); delay.connect(fb); fb.connect(delay); connect(delay)
      entry = feed
      wetOut.gain.value = 0.85
      break
    }
    case 'chipmunk': {
      const wet = ctx.createGain(); wet.gain.value = 0.5
      const ring = ctx.createGain()
      const mod = ctx.createOscillator(); mod.frequency.value = 4; mod.type = 'square'
      const modGain = ctx.createGain(); modGain.gain.value = 0.6
      mod.connect(modGain); modGain.connect(ring.gain); mod.start(); oscBank.push(mod)
      wet.connect(ring); connect(ring)
      entry = wet
      wetOut.gain.value = 0.9
      break
    }
    case 'deep': {
      const shaper = ctx.createWaveShaper()
      const curve = new Float32Array(256)
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = x * x * x * 0.8 }
      shaper.curve = curve
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 2
      shaper.connect(lp); connect(lp)
      entry = shaper
      wetOut.gain.value = 1
      break
    }
  }
  if (entry) {
    wetIn.connect(entry)
    effectEntry = entry
  }
}

function toggleEffect(id: EffectId) {
  effectId.value = id
  if (running.value) applyEffect()
}

function teardown() {
  running.value = false
  if (audioEl.value) { audioEl.value.pause(); audioEl.value.srcObject = null }
  oscBank.forEach((o) => { try { o.stop() } catch { /* */ } }); oscBank = []
  if (effectEntry) { try { effectEntry.disconnect() } catch { /* */ } effectEntry = null }
  if (audioCtx) { audioCtx.close().catch(() => {}) }
  audioCtx = null; dest = null; wetIn = null; wetOut = null
  stream?.getTracks().forEach(t => t.stop()); stream = null
}

onBeforeUnmount(teardown)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-4 flex flex-col items-center">
      <!-- 效果选择 -->
      <div class="flex flex-wrap justify-center gap-2">
        <button
          v-for="e in effectItems"
          :key="e.id"
          type="button"
          class="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm border transition-colors cursor-pointer"
          :class="effectId === e.id
            ? 'bg-primary border-primary text-white'
            : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
          @click="toggleEffect(e.id)"
        >
          <UIcon
            :name="e.icon"
            class="size-4"
          />
          {{ e.label }}
        </button>
      </div>

      <!-- 开始/停止 -->
      <div class="flex items-center gap-3">
        <UButton
          v-if="!running"
          icon="i-lucide-mic"
          :label="t('asr.start')"
          color="primary"
          @click="start"
        />
        <UButton
          v-else
          icon="i-lucide-square"
          :label="t('asr.stop')"
          color="error"
          variant="subtle"
          @click="teardown"
        />
        <span
          v-if="running"
          class="text-sm text-muted pulse"
        >{{ t('vc.live') }}</span>
      </div>

      <audio
        v-show="running"
        ref="audioEl"
        autoplay
        class="hidden"
        style="display:none"
      />

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <p class="text-sm text-muted max-w-xl text-center">
        {{ t('vc.hint') }}
      </p>
    </div>
  </MediaDemoShell>
</template>
