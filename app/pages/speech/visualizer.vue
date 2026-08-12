<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'visualizer')!)

const error = ref<string | null>(null)
const audioFile = ref<File | null>(null)
const audioUrl = ref('')
const waveRef = ref<HTMLDivElement>()
const specRef = ref<HTMLDivElement>()
const playing = ref(false)
const duration = ref(0)
const currentTime = ref(0)

let surfer: any = null
let spec: any = null
let rafId: number | null = null

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  audioFile.value = f
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(f)
  error.value = null
  void initSurfer(audioUrl.value)
}

async function initSurfer(url: string) {
  destroySurfer()
  try {
    // 动态加载 wavesurfer.js（CDN，不增加 bundle 体积）
    const WaveSurfer = (await import(/* @vite-ignore */ 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js')).default
    const Spectrogram = (await import(/* @vite-ignore */ 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js')).default
    if (!waveRef.value || !specRef.value) return
    surfer = WaveSurfer.create({
      container: waveRef.value,
      url,
      waveColor: '#22d3ee',
      progressColor: '#0ea5e9',
      height: 110,
    })
    spec = surfer.registerPlugin(Spectrogram.create({
      container: specRef.value,
      height: 120,
      labels: true,
    }))
    surfer.on('play', () => { playing.value = true; tick() })
    surfer.on('pause', () => { playing.value = false; if (rafId !== null) cancelAnimationFrame(rafId) })
    surfer.on('finish', () => { playing.value = false; if (rafId !== null) cancelAnimationFrame(rafId) })
    surfer.on('ready', () => {
      duration.value = surfer?.getDuration?.() || 0
    })
  } catch (e: any) {
    error.value = `wavesurfer 加载失败: ${e?.message || e}`
  }
}

function tick() {
  if (!surfer) return
  currentTime.value = surfer.getCurrentTime?.() || 0
  if (playing.value) rafId = requestAnimationFrame(tick)
}

function togglePlay() {
  if (!surfer) return
  if (playing.value) surfer.pause()
  else surfer.play()
}

function destroySurfer() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  try { surfer?.destroy() } catch { /* ignore */ }
  surfer = null
  spec = null
  playing.value = false
  currentTime.value = 0
  duration.value = 0
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

onBeforeUnmount(() => {
  destroySurfer()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner :demo="demo" :error="error">
        <!-- 输入 -->
        <template #input>
          <p class="text-sm text-muted mb-4">{{ t('visualizer.hint') }}</p>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
            class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
            @change="onFileChange"
          />
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            v-if="surfer"
            :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
            :label="playing ? t('visualizer.pause') : t('visualizer.play')"
            color="primary"
            @click="togglePlay"
          />
          <span v-if="duration" class="text-sm text-muted tabular-nums">
            {{ fmt(currentTime) }} / {{ fmt(duration) }}
          </span>
        </template>

        <!-- 结果 -->
        <template #result>
          <div v-if="audioUrl" class="space-y-4">
            <div>
              <p class="text-xs text-muted mb-2">{{ t('visualizer.waveform') }}</p>
              <div ref="waveRef" class="rounded-lg border border-default bg-elevated/30 overflow-hidden" />
            </div>
            <div>
              <p class="text-xs text-muted mb-2">{{ t('visualizer.spectrogram') }}</p>
              <div ref="specRef" class="rounded-lg border border-default bg-elevated/30 overflow-hidden" />
            </div>
          </div>
          <div v-else class="text-sm text-muted">{{ t('visualizer.noResult') }}</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
