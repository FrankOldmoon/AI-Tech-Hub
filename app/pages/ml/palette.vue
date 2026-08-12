<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'palette')!)

const fileInput = ref<HTMLInputElement>()
const imgRef = ref<HTMLImageElement>()
const k = ref(5)
const loading = ref(false)
const error = ref<string | null>(null)
const colors = ref<Array<{ hex: string, rgb: string, ratio: number }>>([])
const copied = ref(false)
let lastFile: File | null = null

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] || lastFile
  if (!file) return
  lastFile = file
  await processFile(file)
  if (input.value) input.value = ''
}

async function processFile(file: File) {
  error.value = null
  colors.value = []
  loading.value = true
  try {
    const url = URL.createObjectURL(file)
    const img = imgRef.value!
    img.src = url
    await img.decode()
    // 缩放绘制到离屏 canvas（最长边 400）
    const maxSide = 400
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    // 采样 ≤ 4000 点
    const total = w * h
    const step = Math.max(1, Math.floor(total / 4000))
    const pts: number[][] = []
    for (let i = 0; i < total; i += step) {
      const idx = i * 4
      if (data[idx + 3] < 128) continue // 跳过透明
      pts.push([data[idx] / 255, data[idx + 1] / 255, data[idx + 2] / 255])
    }
    if (pts.length < 4) {
      error.value = t('ml.palette.noPixels')
      return
    }
    colors.value = runKMeans(pts, k.value)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

function dist2(a: number[], b: number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function runKMeans(pts: number[][], kk: number): Array<{ hex: string, rgb: string, ratio: number }> {
  // k-means++ 初始化
  const centers: number[][] = [pts[Math.floor(Math.random() * pts.length)].slice()]
  while (centers.length < kk) {
    const dists = pts.map(p => Math.min(...centers.map(c => dist2(p, c))))
    const total = dists.reduce((a, b) => a + b, 0) || 1
    let r = Math.random() * total
    let pick = pts.length - 1
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]
      if (r <= 0) { pick = i; break }
    }
    centers.push(pts[pick].slice())
  }
  // Lloyd 迭代
  for (let iter = 0; iter < 20; iter++) {
    const sums: number[][] = centers.map(() => [0, 0, 0])
    const counts: number[] = new Array(kk).fill(0)
    for (const p of pts) {
      let best = 0
      let bestD = Infinity
      for (let j = 0; j < kk; j++) {
        const d = dist2(p, centers[j])
        if (d < bestD) { bestD = d; best = j }
      }
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]
      counts[best]++
    }
    let moved = false
    for (let j = 0; j < kk; j++) {
      if (counts[j] === 0) continue
      const nc = [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]]
      if (dist2(nc, centers[j]) > 1e-6) moved = true
      centers[j] = nc
    }
    if (!moved) break
  }
  // 统计占比
  const counts: number[] = new Array(kk).fill(0)
  for (const p of pts) {
    let best = 0
    let bestD = Infinity
    for (let j = 0; j < kk; j++) {
      const d = dist2(p, centers[j])
      if (d < bestD) { bestD = d; best = j }
    }
    counts[best]++
  }
  const total = pts.length || 1
  return centers
    .map((c, i) => {
      const r = Math.round(c[0] * 255)
      const g = Math.round(c[1] * 255)
      const b = Math.round(c[2] * 255)
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
      return { hex, rgb: `${r}, ${g}, ${b}`, ratio: counts[i] / total }
    })
    .sort((a, b) => b.ratio - a.ratio)
}

async function copyColors() {
  const text = colors.value.map(c => `${c.hex} ${c.rgb} ${(c.ratio * 100).toFixed(1)}%`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* ignore */ }
}

watch(k, () => {
  if (lastFile) processFile(lastFile)
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        icon="i-lucide-upload"
        :label="t('ml.palette.upload')"
        color="primary"
        variant="subtle"
        :disabled="loading"
        @click="fileInput?.click()"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">{{ t('ml.palette.colors') }}: {{ k }}</span>
        <USlider v-model="k" :min="3" :max="8" :step="1" class="w-40" :disabled="loading" />
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <div class="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
      <div class="space-y-2">
        <img
          ref="imgRef"
          class="max-w-xs rounded-xl border border-default bg-elevated/40 hidden"
          alt=""
        >
        <div
          class="w-72 h-56 rounded-xl border border-default bg-elevated/40 flex items-center justify-center text-muted text-sm"
        >
          {{ t('ml.palette.preview') }}
        </div>
      </div>

      <div class="w-full space-y-3">
        <div v-if="colors.length" class="space-y-2">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium text-highlighted">{{ t('ml.palette.result') }}</p>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="subtle"
              :label="copied ? t('ml.palette.copied') : t('ml.palette.copy')"
              @click="copyColors"
            />
          </div>
          <div
            v-for="(c, i) in colors"
            :key="i"
            class="flex items-center gap-3 rounded-lg border border-default p-2"
          >
            <div class="size-10 rounded-lg shrink-0 border border-default" :style="{ background: c.hex }" />
            <div class="flex-1">
              <UProgress :model-value="c.ratio * 100" size="sm" class="w-full" />
            </div>
            <span class="text-sm font-mono text-highlighted w-20">{{ c.hex }}</span>
            <span class="text-sm text-muted w-24 font-mono">{{ c.rgb }}</span>
            <span class="text-sm text-muted w-12 text-right tabular-nums">{{ (c.ratio * 100).toFixed(1) }}%</span>
          </div>
        </div>
        <p v-else class="text-sm text-muted">{{ t('ml.palette.noResult') }}</p>
      </div>
    </div>
  </MediaDemoShell>
</template>
