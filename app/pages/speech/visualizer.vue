<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
// 音频可视化：既支持上传文件（wavesurfer 波形 + 频谱），也支持麦克风实时
import { humanError, mediaError } from '~/utils/errors'
import { formatClock } from '~/utils/wav'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'visualizer')!)

const mode = ref<'file' | 'mic'>('file')
const error = ref<string | null>(null)

// 文件/示例输入交给公共 composable：objectURL 的创建与回收不再由本页手工成对书写
// （此前「选文件 / 加载示例 / 切模式 / 卸载」四处各写一遍 revoke，漏一处就泄漏一个 blob）。
// 仍叫 audioUrl，因为 wavesurfer 与模板都把它当作「当前可播放的 URL」用，语义没有变。
const { url: audioUrl, accept, setFile, onFileChange, useSample } = useAudioSource({
  defaultSampleUrl: '/samples/audio/speech.wav',
  // 示例下载失败（网络/断网）走统一错误分类，不再拼「加载示例失败:」这种硬编码中文串
  onError: (e) => { error.value = humanError(e, t) }
})

const waveRef = ref<HTMLDivElement>()
const specRef = ref<HTMLDivElement>()
const playing = ref(false)
const duration = ref(0)
const currentTime = ref(0)
const starting = ref(false)

let surfer: any = null
let rafId: number | null = null

// 麦克风实时（Web Audio AnalyserNode 自绘，不依赖 wavesurfer mic 插件）
const micWaveRef = ref<HTMLCanvasElement>()
const micSpecRef = ref<HTMLCanvasElement>()
let micStream: MediaStream | null = null
let micCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let micRaf: number | null = null

/** wavesurfer ESM 自托管在 public/vendor/wavesurfer（与 public/vendor/onnx 同一策略），
 *  避免运行时依赖 unpkg CDN —— 内网/离线部署时 CDN 不通会让「上传文件」模式直接失效 */
const WAVESURFER_BASE = '/vendor/wavesurfer'

async function module(url: string): Promise<any> {
  return await (import(/* @vite-ignore */ url))
}

async function initFile(url: string) {
  destroySurfer()
  try {
    const WaveSurfer = (await module(`${WAVESURFER_BASE}/wavesurfer.esm.js`)).default
    const Spectrogram = (await module(`${WAVESURFER_BASE}/plugins/spectrogram.esm.js`)).default
    if (!waveRef.value || !specRef.value) return
    surfer = WaveSurfer.create({
      container: waveRef.value,
      url,
      waveColor: '#22d3ee',
      progressColor: '#0ea5e9',
      height: 110
    })
    surfer.registerPlugin(Spectrogram.create({ container: specRef.value, height: 120, labels: true }))
    wireEvents()
    surfer.on('ready', () => { duration.value = surfer?.getDuration?.() || 0 })
  } catch (e) {
    // 自托管资源缺失/CDN 兜底失败等：可能是网络类错误，交给统一分类器判断
    error.value = humanError(e, t)
  }
}

async function startMic() {
  if (starting.value) return
  starting.value = true
  error.value = null
  // 切到麦克风时清除已选文件（objectURL 回收交给 composable）
  setFile(null)
  destroySurfer()
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    micCtx = new AudioContext()
    analyser = micCtx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    micCtx.createMediaStreamSource(micStream).connect(analyser)
    timeData = new Uint8Array(analyser.frequencyBinCount)
    freqData = new Uint8Array(analyser.frequencyBinCount)
    playing.value = true
    micRaf = requestAnimationFrame(micLoop)
  } catch (e) {
    // 权限拒绝 / 无设备 / 设备被占用要给出不同指引，故用 mediaError 而非 humanError
    error.value = mediaError(e, t)
    stopMic()
  } finally {
    starting.value = false
  }
}

// 麦克风实时绘制：波形（time domain）+ 频谱（log 刻度分贝条）
let timeData: Uint8Array<ArrayBuffer> | null = null
let freqData: Uint8Array<ArrayBuffer> | null = null

function micLoop() {
  if (!analyser || !micWaveRef.value || !micSpecRef.value) return
  // 波形
  analyser.getByteTimeDomainData(timeData!)
  drawWave(micWaveRef.value, timeData!)
  // 频谱
  analyser.getByteFrequencyData(freqData!)
  drawSpec(micSpecRef.value, freqData!)
  micRaf = requestAnimationFrame(micLoop)
}

function drawWave(canvas: HTMLCanvasElement, data: Uint8Array) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = '#22d3ee'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const slice = Math.max(1, data.length / w)
  for (let i = 0; i < w; i++) {
    const v = data[Math.floor(i * slice)]! / 128.0
    const y = v * h / 2
    if (i === 0) ctx.moveTo(i, y)
    else ctx.lineTo(i, y)
  }
  ctx.stroke()
}

function drawSpec(canvas: HTMLCanvasElement, data: Uint8Array) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const bars = 96
  const usable = data.length * 0.6
  for (let i = 0; i < bars; i++) {
    const idx = Math.floor(Math.pow(i / bars, 1.5) * usable)
    const v = data[idx]! / 255
    const bh = Math.max(2, v * (h - 4))
    const bw = w / bars
    const hue = 190 - (i / bars) * 120
    ctx.fillStyle = `hsl(${hue}, 85%, 55%)`
    ctx.fillRect(i * bw, h - bh, bw - 1, bh)
  }
}

function stopMic() {
  playing.value = false
  if (micRaf !== null) { cancelAnimationFrame(micRaf); micRaf = null }
  if (analyser) { try { analyser.disconnect() } catch { /* ignore */ } analyser = null }
  if (micCtx) { micCtx.close().catch(() => {}); micCtx = null }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null }
  timeData = null
  freqData = null
}

function wireEvents() {
  if (!surfer) return
  surfer.on('play', () => { playing.value = true; tick() })
  surfer.on('pause', () => { playing.value = false; if (rafId !== null) cancelAnimationFrame(rafId) })
  surfer.on('finish', () => { playing.value = false; if (rafId !== null) cancelAnimationFrame(rafId) })
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
  stopMic()
  try { surfer?.destroy() } catch { /* ignore */ }
  surfer = null
  currentTime.value = 0
  duration.value = 0
}

// 输入源一变就重建 wavesurfer（选文件与「试用示例」原本各调一次 initFile，现在收敛成一条）
watch(audioUrl, (next) => {
  if (!next) return
  error.value = null
  void initFile(next)
})

// 切换来源时清理：停麦克风并销毁 wavesurfer；文件（含 objectURL）交给 composable 释放
watch(mode, () => {
  destroySurfer()
  setFile(null)
})

// 只保留 wavesurfer / 麦克风的 teardown：objectURL 的回收已由 useAudioSource 注册
onBeforeUnmount(destroySurfer)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <DemoRunner :error="error">
      <!-- 输入 -->
      <template #input>
        <AudioSourceToggle
          v-model="mode"
          class="mb-4"
        />

        <!-- 文件模式 -->
        <template v-if="mode === 'file'">
          <p class="text-sm text-muted mb-4">
            {{ t('visualizer.hint') }}
          </p>
          <input
            type="file"
            :accept="accept"
            class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:cursor-pointer"
            @change="onFileChange"
          >
          <UButton
            class="mt-3"
            icon="i-lucide-flask-conical"
            :label="t('samples.trySample')"
            variant="soft"
            @click="useSample()"
          />
        </template>

        <!-- 麦克风模式 -->
        <template v-else>
          <p class="text-sm text-muted">
            {{ t('visualizer.micHint') }}
          </p>
        </template>
      </template>

      <!-- 控件 -->
      <template #controls>
        <template v-if="mode === 'mic'">
          <UButton
            v-if="!playing"
            icon="i-lucide-mic"
            :label="t('visualizer.startMic')"
            color="primary"
            :loading="starting"
            @click="startMic"
          />
          <UButton
            v-else
            icon="i-lucide-square"
            :label="t('visualizer.stopMic')"
            color="error"
            variant="subtle"
            @click="destroySurfer"
          />
        </template>
        <template v-else>
          <UButton
            v-if="surfer"
            :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
            :label="playing ? t('visualizer.pause') : t('visualizer.play')"
            color="primary"
            @click="togglePlay"
          />
          <span
            v-if="duration"
            class="text-sm text-muted tabular-nums"
          >
            {{ formatClock(currentTime) }} / {{ formatClock(duration) }}
          </span>
        </template>
      </template>

      <!-- 结果 -->
      <template #result>
        <!-- 麦克风实时：自绘 canvas -->
        <div
          v-if="mode === 'mic'"
          class="space-y-4"
        >
          <div>
            <p class="text-xs text-muted mb-2">
              {{ t('visualizer.waveform') }}
            </p>
            <canvas
              ref="micWaveRef"
              width="960"
              height="180"
              class="w-full h-44 rounded-lg border border-default bg-elevated/30"
            />
          </div>
          <div>
            <p class="text-xs text-muted mb-2">
              {{ t('visualizer.spectrogram') }}
            </p>
            <canvas
              ref="micSpecRef"
              width="960"
              height="180"
              class="w-full h-44 rounded-lg border border-default bg-elevated/30"
            />
          </div>
          <p
            v-if="!playing"
            class="text-sm text-muted"
          >
            {{ t('visualizer.noResult') }}
          </p>
        </div>

        <!-- 文件模式：wavesurfer -->
        <div
          v-else-if="audioUrl"
          class="space-y-4"
        >
          <div>
            <p class="text-xs text-muted mb-2">
              {{ t('visualizer.waveform') }}
            </p>
            <div
              ref="waveRef"
              class="rounded-lg border border-default bg-elevated/30 overflow-hidden"
            />
          </div>
          <div>
            <p class="text-xs text-muted mb-2">
              {{ t('visualizer.spectrogram') }}
            </p>
            <div
              ref="specRef"
              class="rounded-lg border border-default bg-elevated/30 overflow-hidden"
            />
          </div>
        </div>
        <div
          v-else
          class="text-sm text-muted"
        >
          {{ t('visualizer.noResult') }}
        </div>
      </template>
    </DemoRunner>
  </MediaDemoShell>
</template>
