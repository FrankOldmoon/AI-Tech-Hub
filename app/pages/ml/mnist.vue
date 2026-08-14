import { humanError } from '~/utils/errors'
<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'mnist')!)

const drawRef = ref<HTMLCanvasElement>()
const loading = ref(false)
const loadProgress = ref('')
const error = ref<string | null>(null)
const training = ref(false)
const predicting = ref(false)
const epoch = ref(0)
const loss = ref(0)
const accuracy = ref(0)
const predictions = ref<Array<{ label: number, score: number }>>([])

const DRAW_SIZE = 280
const N = 10000

let xsData: Float32Array | null = null
let ysData: Float32Array | null = null
let labelsData: Uint8Array | null = null
let model: any = null
let step = 0
let rafId: number | null = null
let drawing = false

async function loadData() {
  if (xsData) return
  loading.value = true
  error.value = null
  loadProgress.value = t('ml.mnist.loading')
  try {
    const res = await fetch('/model/mnist/mnist.bin')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    const pixels = new Uint8Array(buf, 0, N * 784)
    const labels = new Uint8Array(buf, N * 784, N)
    xsData = new Float32Array(N * 784)
    for (let i = 0; i < N * 784; i++) xsData[i] = pixels[i] / 255
    ysData = new Float32Array(N * 10)
    for (let i = 0; i < N; i++) ysData[i * 10 + labels[i]] = 1
    labelsData = labels
    await buildModel()
    initDrawCanvas()
    loadProgress.value = ''
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function buildModel() {
  try {
    const tf = await import('@tensorflow/tfjs')
    model = tf.sequential()
    model.add(tf.layers.dense({ inputShape: [784], units: 64, activation: 'relu' }))
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }))
    model.add(tf.layers.dense({ units: 10, activation: 'softmax' }))
    model.compile({ optimizer: tf.train.adam(0.002), loss: 'categoricalCrossentropy', metrics: ['accuracy'] })
  } catch (e: any) {
    error.value = `buildModel: ${e?.message || e}`
    throw e
  }
}

async function trainBatch() {
  if (!model || !xsData || !ysData) return
  const tf = await import('@tensorflow/tfjs')
  const BATCH = 128
  const idx: number[] = []
  for (let i = 0; i < BATCH; i++) idx.push(Math.floor(Math.random() * N))
  const x = new Float32Array(BATCH * 784)
  const y = new Float32Array(BATCH * 10)
  for (let b = 0; b < BATCH; b++) {
    const si = idx[b] * 784
    const sj = idx[b] * 10
    x.set(xsData.subarray(si, si + 784), b * 784)
    y.set(ysData.subarray(sj, sj + 10), b * 10)
  }
  const xs = tf.tensor2d(x, [BATCH, 784])
  const ys = tf.tensor2d(y, [BATCH, 10])
  const hist = await model.trainOnBatch(xs, ys)
  xs.dispose()
  ys.dispose()
  step++
  epoch.value = step / Math.ceil(N / BATCH)
  loss.value = hist[0]
  accuracy.value = hist[1]
}

function loop() {
  if (!training.value) return
  trainBatch().then(() => {
    if (training.value) rafId = requestAnimationFrame(loop)
  })
}

function startTraining() {
  if (!model) return
  training.value = true
  if (!rafId) loop()
}

function pauseTraining() {
  training.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

function initDrawCanvas() {
  const canvas = drawRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, DRAW_SIZE, DRAW_SIZE)
}

function onDrawStart(e: MouseEvent) {
  drawing = true
  drawLine(e)
}

function onDrawMove(e: MouseEvent) {
  if (!drawing) return
  drawLine(e)
}

function onDrawEnd() {
  drawing = false
}

function drawLine(e: MouseEvent) {
  const canvas = drawRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const ctx = canvas.getContext('2d')!
  const x = (e.clientX - rect.left) * (DRAW_SIZE / rect.width)
  const y = (e.clientY - rect.top) * (DRAW_SIZE / rect.height)
  ctx.lineWidth = 16
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000000'
  ctx.lineTo(x, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y)
}

function clearDraw() {
  initDrawCanvas()
  predictions.value = []
}

async function predictDigit() {
  if (!model) return
  const canvas = drawRef.value!
  predicting.value = true
  error.value = null
  try {
    const tf = await import('@tensorflow/tfjs')
    // 缩放到 28x28
    const tmp = document.createElement('canvas')
    tmp.width = 28
    tmp.height = 28
    const tctx = tmp.getContext('2d')!
    tctx.drawImage(canvas, 0, 0, 28, 28)
    const data = tctx.getImageData(0, 0, 28, 28).data
    const vec = new Float32Array(784)
    for (let i = 0; i < 784; i++) {
      vec[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 / 255
    }
    const t = tf.tensor2d([Array.from(vec)], [1, 784])
    const pred = await model.predict(t)
    const arr = Array.from(pred.dataSync())
    t.dispose()
    predictions.value = arr
      .map((score, label) => ({ label, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    predicting.value = false
  }
}

onBeforeUnmount(() => pauseTraining())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        icon="i-lucide-database"
        :label="t('ml.mnist.loadData')"
        color="primary"
        :loading="loading"
        :disabled="xsData !== null"
        @click="loadData"
      />
      <UButton
        v-if="!training"
        icon="i-lucide-play"
        :label="t('ml.mnist.train')"
        color="primary"
        variant="subtle"
        :disabled="!model"
        @click="startTraining"
      />
      <UButton
        v-else
        icon="i-lucide-pause"
        :label="t('ml.mnist.pause')"
        color="error"
        variant="subtle"
        @click="pauseTraining"
      />
      <UButton
        icon="i-lucide-hand"
        :label="t('ml.mnist.predict')"
        color="neutral"
        variant="subtle"
        :loading="predicting"
        :disabled="!model"
        @click="predictDigit"
      />
      <UButton
        icon="i-lucide-eraser"
        :label="t('ml.mnist.clear')"
        color="neutral"
        variant="ghost"
        @click="clearDraw"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert v-if="loading && loadProgress" color="primary" variant="subtle" :title="loadProgress" />

    <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <!-- 画板 -->
      <div class="space-y-2">
        <canvas
          ref="drawRef"
          :width="DRAW_SIZE"
          :height="DRAW_SIZE"
          class="rounded-xl border border-default bg-white cursor-crosshair max-w-full"
          @mousedown="onDrawStart"
          @mousemove="onDrawMove"
          @mouseup="onDrawEnd"
          @mouseleave="onDrawEnd"
        />
        <p class="text-xs text-muted text-center">{{ t('ml.mnist.drawHint') }}</p>
      </div>

      <div class="space-y-4">
        <!-- 训练信息 -->
        <UCard>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <p class="text-xs text-muted">{{ t('ml.mnist.epoch') }}</p>
              <p class="text-2xl font-bold tabular-nums text-highlighted">{{ epoch.toFixed(1) }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.mnist.loss') }}</p>
              <p class="text-2xl font-bold tabular-nums text-highlighted">{{ loss.toFixed(4) }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">{{ t('ml.mnist.accuracy') }}</p>
              <p class="text-2xl font-bold tabular-nums text-highlighted">{{ (accuracy * 100).toFixed(1) }}%</p>
            </div>
          </div>
        </UCard>

        <!-- 预测结果 -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-scan-text" class="size-4" />
              {{ t('ml.mnist.predicted') }}
            </div>
          </template>
          <div v-if="predictions.length" class="space-y-3">
            <div
              v-for="(p, i) in predictions"
              :key="i"
              class="flex items-center gap-3"
            >
              <span class="text-sm font-medium w-8 shrink-0 text-highlighted">{{ p.label }}</span>
              <UProgress :model-value="p.score * 100" size="sm" class="flex-1" />
              <span class="text-sm text-muted w-12 text-right tabular-nums">{{ (p.score * 100).toFixed(1) }}%</span>
            </div>
          </div>
          <p v-else class="text-sm text-muted">{{ t('ml.mnist.drawFirst') }}</p>
        </UCard>
      </div>
    </div>
  </MediaDemoShell>
</template>
