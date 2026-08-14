<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'kmeans')!)

const canvasRef = ref<HTMLCanvasElement>()
const preset = ref<'blobs' | 'moons' | 'uniform'>('blobs')
const k = ref(3)
const iteration = ref(0)
const inertia = ref(0)
const playing = ref(false)

const presetOptions = computed(() => [
  { label: t('ml.kmeans.presetBlobs'), value: 'blobs' },
  { label: t('ml.kmeans.presetMoons'), value: 'moons' },
  { label: t('ml.kmeans.presetUniform'), value: 'uniform' }
])

const SIZE = 400
const RANGE = 6

interface Pt { x: number, y: number }

const points = ref<Pt[]>([])
const labels = ref<number[]>([])
const centroids = ref<Pt[]>([])
let playTimer: ReturnType<typeof setInterval> | null = null

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

function generatePoints(kind: string): Pt[] {
  const rng = mulberry32(2026)
  const pts: Pt[] = []
  if (kind === 'blobs') {
    const centers = [[-2.5, -2], [2.5, -2], [0, 3]]
    for (let i = 0; i < 180; i++) {
      const c = centers[i % centers.length]
      pts.push({ x: c[0] + gaussian(rng) * 1.2, y: c[1] + gaussian(rng) * 1.2 })
    }
  } else if (kind === 'moons') {
    for (let i = 0; i < 180; i++) {
      const t = rng() * Math.PI
      const r = 1.6 + gaussian(rng) * 0.35
      if (i % 2 === 0) pts.push({ x: Math.cos(t) * r - 1.5, y: Math.sin(t) * r })
      else pts.push({ x: 1.5 - Math.cos(t) * r, y: 2.2 - Math.sin(t) * r })
    }
  } else {
    for (let i = 0; i < 180; i++) {
      pts.push({ x: (rng() * 2 - 1) * 5.2, y: (rng() * 2 - 1) * 5.2 })
    }
  }
  return pts
}

function dist2(a: Pt, b: Pt): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function kmeansInit(pts: Pt[], kk: number): Pt[] {
  const cs: Pt[] = [pts[Math.floor(Math.random() * pts.length)]]
  while (cs.length < kk) {
    const dists = pts.map(p => Math.min(...cs.map(c => dist2(p, c))))
    const total = dists.reduce((a, b) => a + b, 0) || 1
    let r = Math.random() * total
    let pick = pts.length - 1
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]
      if (r <= 0) { pick = i; break }
    }
    cs.push(pts[pick])
  }
  return cs
}

function step() {
  if (!points.value.length) return
  const pts = points.value
  const cs = centroids.value
  const lab: number[] = new Array(pts.length)
  const sums: Pt[] = cs.map(() => ({ x: 0, y: 0 }))
  const counts: number[] = new Array(cs.length).fill(0)
  let inert = 0
  for (let i = 0; i < pts.length; i++) {
    let best = 0
    let bestD = Infinity
    for (let j = 0; j < cs.length; j++) {
      const d = dist2(pts[i], cs[j])
      if (d < bestD) { bestD = d; best = j }
    }
    lab[i] = best
    sums[best].x += pts[i].x
    sums[best].y += pts[i].y
    counts[best]++
    inert += bestD
  }
  labels.value = lab
  centroids.value = cs.map((c, j) => counts[j] ? { x: sums[j].x / counts[j], y: sums[j].y / counts[j] } : c)
  inertia.value = inert / pts.length
  iteration.value++
  draw()
}

function reset() {
  pause()
  points.value = generatePoints(preset.value)
  centroids.value = kmeansInit(points.value, k.value)
  labels.value = new Array(points.value.length).fill(0)
  iteration.value = 0
  inertia.value = 0
  draw()
}

function play() {
  if (!points.value.length) reset()
  playing.value = true
  playTimer = setInterval(step, 500)
}

function pause() {
  playing.value = false
  if (playTimer) { clearInterval(playTimer); playTimer = null }
}

function clearPoints() {
  pause()
  points.value = []
  labels.value = []
  centroids.value = []
  iteration.value = 0
  inertia.value = 0
  draw()
}

function toCanvas(v: number): number {
  return ((v + RANGE) / (RANGE * 2)) * SIZE
}

const COLORS = ['#3B82F6', '#F97316', '#22C55E', '#EAB308', '#A855F7', '#EC4899', '#14B8A6', '#F43F5E']

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  // 网格
  ctx.strokeStyle = 'rgba(128,128,128,0.15)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 12; i++) {
    const p = (i / 12) * SIZE
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke()
  }
  // 点
  for (let i = 0; i < points.value.length; i++) {
    const p = points.value[i]
    ctx.beginPath()
    ctx.arc(toCanvas(p.x), toCanvas(p.y), 4, 0, Math.PI * 2)
    ctx.fillStyle = COLORS[labels.value[i] % COLORS.length] || '#888'
    ctx.fill()
  }
  // 质心
  for (let j = 0; j < centroids.value.length; j++) {
    const c = centroids.value[j]
    ctx.beginPath()
    ctx.arc(toCanvas(c.x), toCanvas(c.y), 8, 0, Math.PI * 2)
    ctx.fillStyle = COLORS[j % COLORS.length]
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 3
    ctx.stroke()
    // 叉号
    ctx.beginPath()
    ctx.moveTo(toCanvas(c.x) - 4, toCanvas(c.y) - 4)
    ctx.lineTo(toCanvas(c.x) + 4, toCanvas(c.y) + 4)
    ctx.moveTo(toCanvas(c.x) + 4, toCanvas(c.y) - 4)
    ctx.lineTo(toCanvas(c.x) - 4, toCanvas(c.y) + 4)
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function onCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * RANGE * 2 - RANGE
  const y = ((e.clientY - rect.top) / rect.height) * RANGE * 2 - RANGE
  points.value.push({ x, y })
  labels.value.push(0)
  if (centroids.value.length < k.value) {
    centroids.value = kmeansInit(points.value, k.value)
  }
  draw()
}

watch([preset, k], () => reset())

onMounted(() => reset())
onBeforeUnmount(() => pause())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <UCard>
      <div class="grid sm:grid-cols-3 gap-4 items-end">
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.kmeans.preset') }}</p>
          <USelect v-model="preset" :items="presetOptions" class="w-full" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">K = {{ k }}</p>
          <USlider v-model="k" :min="2" :max="8" :step="1" />
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="!playing"
            icon="i-lucide-play"
            :label="t('ml.kmeans.play')"
            color="primary"
            @click="play"
          />
          <UButton
            v-else
            icon="i-lucide-pause"
            :label="t('ml.kmeans.pause')"
            color="error"
            variant="subtle"
            @click="pause"
          />
          <UButton
            icon="i-lucide-step-forward"
            :label="t('ml.kmeans.step')"
            color="neutral"
            variant="subtle"
            :disabled="playing"
            @click="step"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            :label="t('ml.kmeans.reset')"
            color="neutral"
            variant="subtle"
            @click="reset"
          />
          <UButton
            icon="i-lucide-trash-2"
            :label="t('ml.kmeans.clear')"
            color="neutral"
            variant="ghost"
            :disabled="!points.length"
            @click="clearPoints"
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
        <p class="text-xs text-muted text-center">{{ t('ml.kmeans.clickHint') }}</p>
      </div>
      <UCard>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.kmeans.iteration') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ iteration }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.kmeans.inertia') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ inertia.toFixed(2) }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.kmeans.points') }}</p>
            <p class="text-2xl font-bold tabular-nums text-highlighted">{{ points.length }}</p>
          </div>
        </div>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
