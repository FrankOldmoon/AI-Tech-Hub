<script setup lang="ts">
import { MLP } from '~/utils/ml-playground'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'flappy')!)

const canvasRef = ref<HTMLCanvasElement>()
const running = ref(false)
const generation = ref(1)
const alive = ref(0)
const genBest = ref(0)
const bestScore = ref(0)
const speed = ref(1)

const W = 480
const H = 360
const BIRD_X = 100
const GRAVITY = 0.35
const JUMP_V = -8.5
const PIPE_W = 60
const PIPE_GAP = 170
const PIPE_SPACING = 220
const PIPE_SPEED = 2.0
const POP = 30

interface Bird {
  net: MLP
  y: number
  vy: number
  alive: boolean
  score: number
  steps: number
  passed: Set<number>
}

interface Pipe {
  x: number
  gapY: number
  id: number
}

let birds: Bird[] = []
let pipes: Pipe[] = []
let pipeId = 0
let rafId: number | null = null

function initPopulation() {
  birds = []
  for (let i = 0; i < POP; i++) {
    const net = new MLP(3, [6], 'tanh')
    // 初始权重较小；输出偏置随机化 [-2, 1]，让种群既有“滑翔”也有“跳跃”倾向，
    // 保证第一代就有行为多样性（否则全部不跳、每代瞬间全灭，进化停滞）
    const w = net.getWeights().map(v => v * 0.4)
    w[w.length - 1] = -2 + Math.random() * 3
    net.setWeights(w)
    birds.push({ net, y: H / 2, vy: -2, alive: true, score: 0, steps: 0, passed: new Set() })
  }
}

function initPipes() {
  pipes = [{ x: W + 100, gapY: H / 2, id: ++pipeId }]
}

function reset() {
  running.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  generation.value = 1
  genBest.value = 0
  bestScore.value = 0
  initPopulation()
  initPipes()
  draw()
}

function evolve() {
  // 适应度 = 得分 * 10 + 存活帧数 / 100（提供进化梯度）
  const fitness = (b: Bird) => b.score * 10 + b.steps / 100
  const sorted = [...birds].sort((a, b) => fitness(b) - fitness(a))
  genBest.value = sorted[0]?.score || 0
  bestScore.value = Math.max(bestScore.value, genBest.value)
  const elites = sorted.slice(0, 4).map(b => b.net.clone())
  const next: Bird[] = []
  // 保留前 2 名精英原样（不变异，保证不退化）
  for (let i = 0; i < 2; i++) {
    next.push({ net: elites[i].clone(), y: H / 2, vy: -2, alive: true, score: 0, steps: 0, passed: new Set() })
  }
  // 其余由精英变异产生
  for (let i = 2; i < POP; i++) {
    const child = elites[i % elites.length].clone()
    child.mutate(0.3, 0.8)
    next.push({ net: child, y: H / 2, vy: -2, alive: true, score: 0, steps: 0, passed: new Set() })
  }
  birds = next
  pipes = [{ x: W + 100, gapY: 90 + Math.random() * (H - 180), id: ++pipeId }]
  generation.value++
}

function step() {
  // 管道移动
  for (const p of pipes) p.x -= PIPE_SPEED
  if (pipes.length && pipes[0].x < -PIPE_W) pipes.shift()
  const last = pipes[pipes.length - 1]
  if (!last || last.x < W - PIPE_SPACING) {
    pipes.push({ x: (last ? last.x + PIPE_SPACING : W + 100), gapY: 90 + Math.random() * (H - 180), id: ++pipeId })
  }
  const nextPipe = pipes.find(p => p.x + PIPE_W >= BIRD_X) || pipes[pipes.length - 1]

  for (const b of birds) {
    if (!b.alive) continue
    b.steps++
    const input = [b.y / H, (nextPipe.x - BIRD_X) / W, (nextPipe.gapY - b.y) / H]
    const out = b.net.predict(input)
    if (out > 0.5) b.vy = JUMP_V
    b.vy += GRAVITY
    b.y += b.vy
    if (b.y < 8 || b.y > H - 8) {
      b.alive = false
      continue
    }
    // 碰撞检测
    if (BIRD_X + 10 > nextPipe.x && BIRD_X - 10 < nextPipe.x + PIPE_W) {
      if (b.y - 8 < nextPipe.gapY - PIPE_GAP / 2 || b.y + 8 > nextPipe.gapY + PIPE_GAP / 2) {
        b.alive = false
        continue
      }
    }
  }
  // 通过管道得分：扫描所有已完全越过小鸟的管道
  for (const b of birds) {
    if (!b.alive) continue
    for (const p of pipes) {
      if (p.x + PIPE_W < BIRD_X && !b.passed.has(p.id)) {
        b.passed.add(p.id)
        b.score++
      }
    }
  }

  alive.value = birds.filter(b => b.alive).length
  if (alive.value === 0) evolve()
}

function loop() {
  if (!running.value) return
  for (let i = 0; i < speed.value; i++) step()
  draw()
  rafId = requestAnimationFrame(loop)
}

function start() {
  if (!birds.length) {
    initPopulation()
    initPipes()
  }
  running.value = true
  if (!rafId) loop()
}

function pause() {
  running.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  // 背景
  ctx.fillStyle = '#0F172A'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#1E293B'
  ctx.fillRect(0, H - 20, W, 20)
  // 管道
  for (const p of pipes) {
    ctx.fillStyle = '#22C55E'
    ctx.fillRect(p.x, 0, PIPE_W, p.gapY - PIPE_GAP / 2)
    ctx.fillRect(p.x, p.gapY + PIPE_GAP / 2, PIPE_W, H - 20 - (p.gapY + PIPE_GAP / 2))
    ctx.fillStyle = '#16A34A'
    ctx.fillRect(p.x - 4, p.gapY - PIPE_GAP / 2 - 14, PIPE_W + 8, 14)
    ctx.fillRect(p.x - 4, p.gapY + PIPE_GAP / 2, PIPE_W + 8, 14)
  }
  // 鸟
  for (const b of birds) {
    if (!b.alive) continue
    ctx.fillStyle = '#FACC15'
    ctx.beginPath()
    ctx.arc(BIRD_X, b.y, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.arc(BIRD_X + 3, b.y - 2, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
  // 文字
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 14px sans-serif'
  ctx.fillText(`${t('ml.flappy.generation')}: ${generation.value}`, 10, 24)
  ctx.fillText(`${t('ml.flappy.alive')}: ${alive.value}`, 10, 44)
  ctx.fillText(`${t('ml.flappy.genBest')}: ${genBest.value}`, 10, 64)
  ctx.fillText(`${t('ml.flappy.best')}: ${bestScore.value}`, 10, 84)
}

onMounted(() => {
  initPopulation()
  initPipes()
  draw()
})

onBeforeUnmount(() => pause())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="!running"
        icon="i-lucide-play"
        :label="t('ml.flappy.start')"
        color="primary"
        @click="start"
      />
      <UButton
        v-else
        icon="i-lucide-pause"
        :label="t('ml.flappy.pause')"
        color="error"
        variant="subtle"
        @click="pause"
      />
      <UButton
        icon="i-lucide-refresh-cw"
        :label="t('ml.flappy.reset')"
        color="neutral"
        variant="subtle"
        @click="reset"
      />
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">{{ t('ml.flappy.speed') }}: {{ speed }}x</span>
        <USlider v-model="speed" :min="1" :max="5" :step="1" class="w-32" />
      </div>
    </div>

    <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <div class="space-y-2">
        <canvas
          ref="canvasRef"
          :width="W"
          :height="H"
          class="rounded-xl border border-default max-w-full"
        />
      </div>
      <UCard>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.flappy.generation') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ generation }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.flappy.alive') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ alive }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.flappy.genBest') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ genBest }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.flappy.best') }}</p>
            <p class="text-2xl font-bold tabular-nums text-primary">{{ bestScore }}</p>
          </div>
        </div>
        <p class="mt-4 text-sm text-muted">{{ t('ml.flappy.hint') }}</p>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
