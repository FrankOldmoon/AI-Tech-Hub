<script setup lang="ts">
import { generateData, MLP, type Activation, type DatasetKind, type TrainSample } from '~/utils/ml-playground'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'playground')!)

const canvasRef = ref<HTMLCanvasElement>()

const dataset = ref<DatasetKind>('circle')
const noise = ref(0.1)
const activation = ref<Activation>('tanh')
const hidden = ref('4,2')
const learningRate = ref(0.05)

const training = ref(false)
const epoch = ref(0)
const loss = ref(0)
const accuracy = ref(0)
const lossHistory = ref<number[]>([])
const addMode = ref<0 | 1>(0)
const customPoints = ref<TrainSample[]>([])

const lossPoints = computed(() => {
  const h = lossHistory.value
  if (h.length < 2) return ''
  const max = Math.max(...h)
  const min = Math.min(...h)
  const span = Math.max(max - min, 1e-6)
  return h
    .map((v, i) => `${((i / (h.length - 1)) * 300).toFixed(1)},${(58 - ((v - min) / span) * 54).toFixed(1)}`)
    .join(' ')
})

const datasetOptions = computed(() => [
  { label: t('ml.playground.datasetCircle'), value: 'circle' },
  { label: t('ml.playground.datasetXor'), value: 'xor' },
  { label: t('ml.playground.datasetGaussian'), value: 'gaussian' },
  { label: t('ml.playground.datasetSpiral'), value: 'spiral' }
])
const activationOptions = computed(() => [
  { label: 'Tanh', value: 'tanh' },
  { label: 'ReLU', value: 'relu' },
  { label: 'Sigmoid', value: 'sigmoid' }
])
const hiddenOptions = computed(() => [
  { label: '4', value: '4' },
  { label: '4,2', value: '4,2' },
  { label: '8,4', value: '8,4' }
])

const SIZE = 400
const GRID = 50
const RANGE = 6 // 数据范围 [-6, 6]

let data: TrainSample[] = []
let net: MLP | null = null
let rafId: number | null = null
let initialized = false

function init() {
  data = generateData(dataset.value, 240, noise.value)
  net = new MLP(2, hidden.value.split(',').map(Number), activation.value)
  customPoints.value = []
  lossHistory.value = []
  epoch.value = 0
  loss.value = 0
  accuracy.value = 0
  draw()
}

function toCanvas(v: number): number {
  return ((v + RANGE) / (RANGE * 2)) * SIZE
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas || !net) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // 决策边界（低分辨率网格 + 插值着色）
  const cell = SIZE / GRID
  for (let gx = 0; gx < GRID; gx++) {
    for (let gy = 0; gy < GRID; gy++) {
      const px = ((gx + 0.5) / GRID) * RANGE * 2 - RANGE
      const py = ((gy + 0.5) / GRID) * RANGE * 2 - RANGE
      const p = net.predict([px, py])
      const r = Math.round(35 + p * 210)
      const b = Math.round(35 + (1 - p) * 210)
      ctx.fillStyle = `rgb(${r}, 110, ${b})`
      ctx.fillRect(gx * cell, gy * cell, cell + 1, cell + 1)
    }
  }
  // 数据集点
  for (const s of data) {
    ctx.beginPath()
    ctx.arc(toCanvas(s.x[0]), toCanvas(s.x[1]), 4, 0, Math.PI * 2)
    ctx.fillStyle = s.y === 1 ? '#3B82F6' : '#F97316'
    ctx.fill()
  }
  // 自定义点（白描边）
  for (const s of customPoints.value) {
    ctx.beginPath()
    ctx.arc(toCanvas(s.x[0]), toCanvas(s.x[1]), 5, 0, Math.PI * 2)
    ctx.fillStyle = s.y === 1 ? '#3B82F6' : '#F97316'
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function runBatch() {
  if (!net) return
  const all = [...data, ...customPoints.value]
  if (!all.length) return
  let sum = 0
  for (let k = 0; k < 10; k++) {
    const i = Math.floor(Math.random() * all.length)
    sum += net.trainStep(all[i].x, all[i].y, learningRate.value)
  }
  epoch.value += 1
  loss.value = sum / 10
  let correct = 0
  for (const s of all) {
    const p = net.predict(s.x)
    if ((p >= 0.5 ? 1 : 0) === s.y) correct++
  }
  accuracy.value = all.length ? correct / all.length : 0
  lossHistory.value.push(loss.value)
  if (lossHistory.value.length > 300) lossHistory.value.shift()
}

function loop() {
  if (!training.value) return
  runBatch()
  draw()
  rafId = requestAnimationFrame(loop)
}

function start() {
  if (!initialized) { initialized = true; init() }
  training.value = true
  if (!rafId) loop()
}

function pause() {
  training.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

function reset() {
  pause()
  if (!initialized) { initialized = true; init() } else {
    net?.reset()
    epoch.value = 0
    loss.value = 0
    accuracy.value = 0
    lossHistory.value = []
    draw()
  }
}

function stepOnce() {
  if (!initialized) { initialized = true; init() }
  pause()
  runBatch()
  draw()
}

function onCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * RANGE * 2 - RANGE
  const y = ((e.clientY - rect.top) / rect.height) * RANGE * 2 - RANGE
  customPoints.value.push({ x: [x, y], y: addMode.value })
  draw()
}

watch([dataset, noise, activation, hidden], () => {
  if (initialized) init()
})

onMounted(() => {
  init()
})

onBeforeUnmount(() => pause())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 参数控件 -->
    <UCard>
      <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.playground.dataset') }}</p>
          <USelect v-model="dataset" :items="datasetOptions" class="w-full" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.playground.noise') }}: {{ noise.toFixed(2) }}</p>
          <USlider v-model="noise" :min="0" :max="0.5" :step="0.05" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.playground.activation') }}</p>
          <USelect v-model="activation" :items="activationOptions" class="w-full" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.playground.hiddenLayers') }}</p>
          <USelect v-model="hidden" :items="hiddenOptions" class="w-full" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.playground.learningRate') }}: {{ learningRate.toFixed(3) }}</p>
          <USlider v-model="learningRate" :min="0.001" :max="0.5" :step="0.001" />
        </div>
      </div>
    </UCard>

    <!-- 操作控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="!training"
        icon="i-lucide-play"
        :label="t('ml.playground.train')"
        color="primary"
        @click="start"
      />
      <UButton
        v-else
        icon="i-lucide-pause"
        :label="t('ml.playground.pause')"
        color="error"
        variant="subtle"
        @click="pause"
      />
      <UButton
        icon="i-lucide-refresh-cw"
        :label="t('ml.playground.reset')"
        color="neutral"
        variant="subtle"
        @click="reset"
      />
      <UButton
        icon="i-lucide-step-forward"
        :label="t('ml.playground.step')"
        color="neutral"
        variant="subtle"
        :disabled="training"
        @click="stepOnce"
      />
      <USeparator />
      <UButton
        :icon="addMode === 1 ? 'i-lucide-mouse-pointer-click' : 'i-lucide-mouse-pointer'"
        :label="addMode === 1 ? t('ml.playground.addBlue') : t('ml.playground.addOrange')"
        :color="addMode === 1 ? 'primary' : 'warning'"
        variant="subtle"
        @click="addMode = addMode === 1 ? 0 : 1"
      />
      <UButton
        icon="i-lucide-trash-2"
        :label="t('ml.playground.clearPoints')"
        color="neutral"
        variant="ghost"
        :disabled="!customPoints.length"
        @click="customPoints = []; draw()"
      />
    </div>

    <!-- 画布 -->
    <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <div class="space-y-2">
        <canvas
          ref="canvasRef"
          :width="SIZE"
          :height="SIZE"
          class="rounded-xl border border-default bg-elevated/40 cursor-crosshair max-w-full"
          @click="onCanvasClick"
        />
        <p class="text-xs text-muted text-center">{{ t('ml.playground.clickHint') }}</p>
      </div>

      <!-- 训练信息 -->
      <UCard>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.playground.epoch') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ epoch }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.playground.loss') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ loss.toFixed(4) }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.playground.accuracy') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ Math.round(accuracy * 100) }}%</p>
          </div>
        </div>
        <!-- Loss 曲线 -->
        <svg
          v-if="lossHistory.length > 1"
          viewBox="0 0 300 60"
          class="w-full mt-4 rounded-lg bg-elevated/60"
          preserveAspectRatio="none"
        >
          <polyline
            :points="lossPoints"
            fill="none"
            stroke="#00DC82"
            stroke-width="2"
          />
        </svg>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
