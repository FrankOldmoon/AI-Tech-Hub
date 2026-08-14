<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'regression')!)

const canvasRef = ref<HTMLCanvasElement>()
const degree = ref(2)
const learningRate = ref(0.02)
const training = ref(false)
const epoch = ref(0)
const loss = ref(0)

const degreeOptions = computed(() => [
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 }
])

const SIZE = 400
const RANGE = 6

interface Pt { x: number, y: number }

const points = ref<Pt[]>([])
let weights: number[] = []
let rafId: number | null = null

function initWeights() {
  weights = new Array(degree.value + 1).fill(0).map(() => (Math.random() * 2 - 1) * 0.1)
  epoch.value = 0
  loss.value = 0
}

function generateSample(): Pt[] {
  // y = 0.6x^2 - 0.8x + 1.2 + 噪声
  const pts: Pt[] = []
  for (let i = 0; i < 80; i++) {
    const x = (Math.random() * 2 - 1) * 5
    const y = 0.6 * x * x - 0.8 * x + 1.2 + (Math.random() * 2 - 1) * 2.2
    pts.push({ x, y })
  }
  return pts
}

function features(x: number): number[] {
  const f = new Array(degree.value + 1)
  let v = 1
  const xn = x / RANGE // 归一化到 [-1, 1] 防止数值爆炸
  for (let i = 0; i <= degree.value; i++) {
    f[i] = v
    v *= xn
  }
  return f
}

function predict(x: number): number {
  const f = features(x)
  let y = 0
  for (let i = 0; i <= degree.value; i++) y += weights[i] * f[i]
  return y * RANGE
}

function trainStep() {
  if (!points.value.length) return
  const batch = points.value.slice().sort(() => Math.random() - 0.5).slice(0, 32)
  let sumLoss = 0
  const grads = new Array(weights.length).fill(0)
  for (const p of batch) {
    const f = features(p.x)
    const pred = f.reduce((s, v, i) => s + weights[i] * v, 0)
    const err = pred - p.y / RANGE
    sumLoss += err * err
    for (let i = 0; i < weights.length; i++) grads[i] += 2 * err * f[i]
  }
  for (let i = 0; i < weights.length; i++) {
    weights[i] -= learningRate.value * (grads[i] / batch.length)
  }
  loss.value = sumLoss / batch.length
  epoch.value++
}

function loop() {
  if (!training.value) return
  for (let i = 0; i < 20; i++) trainStep()
  draw()
  rafId = requestAnimationFrame(loop)
}

function start() {
  if (!points.value.length) {
    points.value = generateSample()
    initWeights()
  }
  training.value = true
  if (!rafId) loop()
}

function pause() {
  training.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

function reset() {
  pause()
  points.value = []
  initWeights()
  draw()
}

function toCanvas(v: number): number {
  return ((v + RANGE) / (RANGE * 2)) * SIZE
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.strokeStyle = 'rgba(128,128,128,0.15)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 12; i++) {
    const p = (i / 12) * SIZE
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke()
  }
  // 拟合曲线
  ctx.beginPath()
  for (let i = 0; i <= 100; i++) {
    const x = (i / 100) * RANGE * 2 - RANGE
    const y = predict(x)
    if (i === 0) ctx.moveTo(toCanvas(x), toCanvas(y))
    else ctx.lineTo(toCanvas(x), toCanvas(y))
  }
  ctx.strokeStyle = '#00DC82'
  ctx.lineWidth = 3
  ctx.stroke()
  // 数据点
  for (const p of points.value) {
    ctx.beginPath()
    ctx.arc(toCanvas(p.x), toCanvas(p.y), 4, 0, Math.PI * 2)
    ctx.fillStyle = '#3B82F6'
    ctx.fill()
  }
}

function onCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * RANGE * 2 - RANGE
  const y = ((e.clientY - rect.top) / rect.height) * RANGE * 2 - RANGE
  points.value.push({ x, y })
  draw()
}

watch(degree, () => {
  pause()
  initWeights()
  draw()
})

onMounted(() => {
  points.value = generateSample()
  initWeights()
  draw()
})

onBeforeUnmount(() => pause())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UCard>
      <div class="grid sm:grid-cols-3 gap-4 items-end">
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.regression.degree') }}</p>
          <USelect v-model="degree" :items="degreeOptions" class="w-full" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.regression.learningRate') }}: {{ learningRate.toFixed(3) }}</p>
          <USlider v-model="learningRate" :min="0.001" :max="0.1" :step="0.001" />
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="!training"
            icon="i-lucide-play"
            :label="t('ml.regression.train')"
            color="primary"
            @click="start"
          />
          <UButton
            v-else
            icon="i-lucide-pause"
            :label="t('ml.regression.pause')"
            color="error"
            variant="subtle"
            @click="pause"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            :label="t('ml.regression.reset')"
            color="neutral"
            variant="subtle"
            @click="reset"
          />
        </div>
      </div>
    </UCard>

    <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <div class="space-y-2">
        <canvas
          ref="canvasRef"
          :width="SIZE"
          :height="SIZE"
          class="rounded-xl border border-default bg-elevated/40 cursor-crosshair max-w-full"
          @click="onCanvasClick"
        />
        <p class="text-xs text-muted text-center">{{ t('ml.regression.clickHint') }}</p>
      </div>
      <UCard>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.regression.epoch') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ epoch }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.regression.loss') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ loss.toFixed(4) }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.regression.points') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ points.length }}</p>
          </div>
        </div>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
