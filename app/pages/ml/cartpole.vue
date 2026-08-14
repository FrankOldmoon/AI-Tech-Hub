import { humanError } from '~/utils/errors'
<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'cartpole')!)

const canvasRef = ref<HTMLCanvasElement>()
const training = ref(false)
const episode = ref(0)
const reward = ref(0)
const bestReward = ref(0)
const error = ref<string | null>(null)

const W = 480
const H = 360
const GROUND_Y = 280

// 环境状态
let x = 0, v = 0, theta = 0.05, omega = 0
let model: any = null
let episodeStates: number[][] = []
let episodeActions: number[] = []
let episodeRewards: number[] = []
let currentReward = 0
let rafId: number | null = null

// CartPole 物理参数（与 OpenAI Gym 一致）
const GRAVITY = 9.8
const MASS_CART = 1.0
const MASS_POLE = 0.1
const TOTAL_MASS = MASS_CART + MASS_POLE
const POLE_LENGTH = 0.5
const FORCE_MAG = 10.0
const TAU = 0.02

async function buildModel() {
  const tf = await import('@tensorflow/tfjs')
  model = tf.sequential()
  model.add(tf.layers.dense({ inputShape: [4], units: 24, activation: 'relu' }))
  model.add(tf.layers.dense({ units: 2, activation: 'softmax' }))
  model.compile({ optimizer: tf.train.adam(0.01), loss: 'categoricalCrossentropy' })
}

function resetState() {
  x = 0
  v = 0
  theta = 0.05
  omega = 0
}

function step(action: number): boolean {
  const force = action === 1 ? FORCE_MAG : -FORCE_MAG
  const costheta = Math.cos(theta)
  const sintheta = Math.sin(theta)
  const temp = (force + MASS_POLE * POLE_LENGTH * omega * omega * sintheta) / TOTAL_MASS
  const thetaAcc = (GRAVITY * sintheta - costheta * temp) /
    (POLE_LENGTH * (4 / 3 - (MASS_POLE * costheta * costheta) / TOTAL_MASS))
  x += TAU * v
  v += TAU * temp
  theta += TAU * omega
  omega += TAU * thetaAcc
  return x < -2.4 || x > 2.4 || theta < -0.209 || theta > 0.209
}

async function runEpisode() {
  if (!model) return
  const tf = await import('@tensorflow/tfjs')
  resetState()
  episodeStates = []
  episodeActions = []
  episodeRewards = []
  currentReward = 0
  let done = false
  while (!done) {
    const t = tf.tensor2d([[x, v, theta, omega]], [1, 4])
    const probs = Array.from((await model.predict(t)).dataSync())
    t.dispose()
    const action = Math.random() < probs[1] ? 1 : 0
    episodeStates.push([x, v, theta, omega])
    episodeActions.push(action)
    done = step(action)
    episodeRewards.push(1)
    currentReward++
    if (done) break
  }
  // 折扣回报
  const gamma = 0.99
  const returns: number[] = []
  let acc = 0
  for (let i = episodeRewards.length - 1; i >= 0; i--) {
    acc = episodeRewards[i] + gamma * acc
    returns.push(acc)
  }
  returns.reverse()
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length || 1
  const normalized = returns.map(r => r - mean)
  const xs = tf.tensor2d(episodeStates)
  const ys = tf.oneHot(tf.tensor1d(episodeActions, 'int32'), 2)
  const weights = tf.tensor1d(normalized)
  await model.trainOnBatch(xs, ys, weights)
  xs.dispose(); ys.dispose(); weights.dispose()
  episode.value++
  reward.value = currentReward
  bestReward.value = Math.max(bestReward.value, currentReward)
}

function loop() {
  if (!training.value) return
  runEpisode()
    .catch((e: any) => { error.value = humanError(e, t); training.value = false })
    .finally(() => {
      if (training.value) {
        draw()
        rafId = requestAnimationFrame(loop)
      }
    })
}

function startTraining() {
  if (!model) {
    buildModel().then(() => {
      training.value = true
      if (!rafId) loop()
    }).catch((e: any) => { error.value = humanError(e, t) })
    return
  }
  training.value = true
  if (!rafId) loop()
}

function pauseTraining() {
  training.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

function reset() {
  pauseTraining()
  episode.value = 0
  reward.value = 0
  bestReward.value = 0
  resetState()
  draw()
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  // 地面
  ctx.fillStyle = 'rgba(128,128,128,0.2)'
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y)
  // 小车
  const scale = 60 // 世界单位 -> 像素
  const cartX = W / 2 + x * scale
  ctx.fillStyle = '#3B82F6'
  ctx.fillRect(cartX - 28, GROUND_Y - 18, 56, 18)
  // 轮子
  ctx.fillStyle = '#1E293B'
  ctx.beginPath(); ctx.arc(cartX - 20, GROUND_Y, 7, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(cartX + 20, GROUND_Y, 7, 0, Math.PI * 2); ctx.fill()
  // 杆
  const poleLen = 80
  const topX = cartX + Math.sin(theta) * poleLen
  const topY = GROUND_Y - 18 - Math.cos(theta) * poleLen
  ctx.strokeStyle = '#00DC82'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cartX, GROUND_Y - 18)
  ctx.lineTo(topX, topY)
  ctx.stroke()
  // 杆顶
  ctx.fillStyle = '#F97316'
  ctx.beginPath(); ctx.arc(topX, topY, 5, 0, Math.PI * 2); ctx.fill()
}

onBeforeUnmount(() => pauseTraining())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="!training"
        icon="i-lucide-play"
        :label="t('ml.cartpole.train')"
        color="primary"
        @click="startTraining"
      />
      <UButton
        v-else
        icon="i-lucide-pause"
        :label="t('ml.cartpole.pause')"
        color="error"
        variant="subtle"
        @click="pauseTraining"
      />
      <UButton
        icon="i-lucide-refresh-cw"
        :label="t('ml.cartpole.reset')"
        color="neutral"
        variant="subtle"
        @click="reset"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <div class="space-y-2">
        <canvas
          ref="canvasRef"
          :width="W"
          :height="H"
          class="rounded-xl border border-default bg-elevated/40 max-w-full"
        />
      </div>
      <UCard>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.cartpole.episode') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ episode }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.cartpole.reward') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ reward }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.cartpole.best') }}</p>
            <p class="text-2xl font-bold tabular-nums text-primary">{{ bestReward }}</p>
          </div>
        </div>
        <p class="mt-4 text-sm text-muted">{{ t('ml.cartpole.hint') }}</p>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
