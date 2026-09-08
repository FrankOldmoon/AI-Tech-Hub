<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/no-explicit-any */
/** 图像像素原理教学页：左侧导航（存储原理/RGB/大小计算/像素绘制），右侧对应内容 */
import { humanError } from '~/utils/errors'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'pixel')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

const client = ref(false)
onMounted(() => { client.value = true })

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(2)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
function rgbHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}
function srcLabel(k: 'photo' | 'gradient' | 'noise'): string {
  return pick({ photo: { zh: '真实照片', en: 'Photo' }, gradient: { zh: '渐变', en: 'Gradient' }, noise: { zh: '随机噪点', en: 'Noise' } }[k])
}
/** 确定性伪随机 0..1（用于像素噪声，避免每次重绘闪烁） */
function ph(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// ===== 左侧导航 =====
const sections = [
  { id: 1, icon: 'i-lucide-database', title: { zh: '存储原理', en: 'Storage' } },
  { id: 2, icon: 'i-lucide-palette', title: { zh: 'RGB 颜色', en: 'RGB color' } },
  { id: 3, icon: 'i-lucide-calculator', title: { zh: '图片大小', en: 'Image size' } },
  { id: 4, icon: 'i-lucide-brush', title: { zh: '像素绘制', en: 'Pixel drawing' } }
] as const
const active = ref<(typeof sections)[number]['id']>(1)

// ===== 模块 1：存储原理 =====
const SRC_N = 8
const SCALE = 42
const srcImg = ref<ImageData | null>(null)
const storageCanvas = ref<HTMLCanvasElement>()
const storageSel = ref<{ x: number, y: number } | null>(null)
const rbgaOf = ref('')
const sourceKind = ref<'photo' | 'gradient' | 'noise'>('photo')

function buildProc(kind: 'gradient' | 'noise') {
  const img = new ImageData(SRC_N, SRC_N)
  for (let y = 0; y < SRC_N; y++) {
    for (let x = 0; x < SRC_N; x++) {
      const i = (y * SRC_N + x) * 4
      if (kind === 'noise') {
        img.data[i] = Math.round(ph(x, y) * 255)
        img.data[i + 1] = Math.round(ph(x + 7, y + 3) * 255)
        img.data[i + 2] = Math.round(ph(x + 13, y + 5) * 255)
      } else {
        img.data[i] = Math.round((x / (SRC_N - 1)) * 255)
        img.data[i + 1] = Math.round((y / (SRC_N - 1)) * 255)
        img.data[i + 2] = Math.round(((x + y) / (2 * (SRC_N - 1))) * 255)
      }
      img.data[i + 3] = 255
    }
  }
  return img
}
function applySource() {
  if (!client.value) return
  if (sourceKind.value === 'photo') {
    const img = new Image()
    img.src = '/samples/images/parrot.jpg'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = SRC_N; c.height = SRC_N
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, SRC_N, SRC_N)
      srcImg.value = ctx.getImageData(0, 0, SRC_N, SRC_N)
      storageSel.value = null
      drawStorage()
    }
    img.onerror = () => {
      sourceKind.value = 'gradient'
      srcImg.value = buildProc('gradient')
      drawStorage()
    }
    return
  }
  srcImg.value = buildProc(sourceKind.value)
  storageSel.value = null
  drawStorage()
}
function drawStorage() {
  const c = storageCanvas.value
  if (!c || !srcImg.value) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  const tmp = new OffscreenCanvas(SRC_N, SRC_N)
  tmp.getContext('2d')!.putImageData(srcImg.value, 0, 0)
  ctx.drawImage(tmp, 0, 0, SRC_N, SRC_N, 0, 0, c.width, c.height)
  ctx.strokeStyle = 'rgba(0,0,0,.15)'
  ctx.lineWidth = 1
  for (let i = 1; i < SRC_N; i++) {
    ctx.beginPath(); ctx.moveTo(i * SCALE, 0); ctx.lineTo(i * SCALE, c.height); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * SCALE); ctx.lineTo(c.width, i * SCALE); ctx.stroke()
  }
  if (storageSel.value) {
    const { x, y } = storageSel.value
    ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 3
    ctx.strokeRect(x * SCALE, y * SCALE, SCALE, SCALE)
  }
}
function onStoragePointer(e: PointerEvent) {
  const c = storageCanvas.value
  if (!c || !srcImg.value) return
  const r = c.getBoundingClientRect()
  const x = Math.min(SRC_N - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * SRC_N)))
  const y = Math.min(SRC_N - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * SRC_N)))
  storageSel.value = { x, y }
  const i = (y * SRC_N + x) * 4
  const [r0, g0, b0, a0] = [srcImg.value.data[i]!, srcImg.value.data[i + 1]!, srcImg.value.data[i + 2]!, srcImg.value.data[i + 3]!]
  rbgaOf.value = `rgba(${r0}, ${g0}, ${b0}, ${(a0 / 255).toFixed(2)})`
  drawStorage()
}
const srcSizeBytes = computed(() => srcImg.value ? srcImg.value.width * srcImg.value.height * 4 : 0)
const rawHexRows = computed(() => {
  if (!srcImg.value) return []
  const rows: string[] = []
  const data = srcImg.value.data
  const n = Math.min(32, data.length)
  for (let i = 0; i < n; i += 8)
    rows.push(Array.from(data.slice(i, i + 8)).map(v => v.toString(16).padStart(2, '0')).join(' '))
  return rows
})
watch(sourceKind, applySource)
watch(srcImg, drawStorage)
watch(storageSel, drawStorage)

// ===== 模块 2：RGB 颜色（单一调试 + 预设） =====
const col = ref({ r: 255, g: 0, b: 0 })
interface Preset { name: L, r: number, g: number, b: number }
const presets: Preset[] = [
  { name: { zh: '黑', en: 'Black' }, r: 0, g: 0, b: 0 },
  { name: { zh: '白', en: 'White' }, r: 255, g: 255, b: 255 },
  { name: { zh: '红', en: 'Red' }, r: 255, g: 0, b: 0 },
  { name: { zh: '橙', en: 'Orange' }, r: 255, g: 128, b: 0 },
  { name: { zh: '黄', en: 'Yellow' }, r: 255, g: 255, b: 0 },
  { name: { zh: '绿', en: 'Green' }, r: 0, g: 200, b: 0 },
  { name: { zh: '青', en: 'Cyan' }, r: 0, g: 255, b: 255 },
  { name: { zh: '蓝', en: 'Blue' }, r: 0, g: 0, b: 255 },
  { name: { zh: '品红', en: 'Magenta' }, r: 255, g: 0, b: 255 },
  { name: { zh: '紫', en: 'Violet' }, r: 128, g: 0, b: 255 },
  { name: { zh: '粉', en: 'Pink' }, r: 255, g: 128, b: 192 },
  { name: { zh: '棕', en: 'Brown' }, r: 139, g: 69, b: 19 },
  { name: { zh: '灰', en: 'Gray' }, r: 128, g: 128, b: 128 },
  { name: { zh: '琥珀', en: 'Amber' }, r: 255, g: 191, b: 0 }
]

// ===== 模块 3：图片大小（真实像素图 + 长宽 slider） =====
const calcW = ref(16)
const calcH = ref(12)
const calcBpp = ref(24)
const bppItems = [
  { label: '8 bit · 灰度 Grayscale', value: 8 },
  { label: '24 bit · RGB', value: 24 },
  { label: '32 bit · RGBA（含透明度）', value: 32 }
]
const sizeCanvas = ref<HTMLCanvasElement>()
const SIZE_SCALE = 360
const calcBytes = computed(() => {
  const w = Math.max(1, Number(calcW.value) || 1)
  const h = Math.max(1, Number(calcH.value) || 1)
  return Math.round(w * h * (Number(calcBpp.value) / 8))
})
function drawSize() {
  const c = sizeCanvas.value
  if (!c || !client.value) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const w = Math.max(1, Math.round(Number(calcW.value)) || 1)
  const h = Math.max(1, Math.round(Number(calcH.value)) || 1)
  const img = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      img.data[i] = Math.round((x / (w - 1)) * 200 + (ph(x, y) * 40 - 20))
      img.data[i + 1] = Math.round((y / (h - 1)) * 200 + (ph(x + 9, y + 4) * 40 - 20))
      img.data[i + 2] = Math.round(((x + y) / (w + h - 2)) * 255)
      img.data[i + 3] = 255
    }
  }
  const tmp = new OffscreenCanvas(w, h)
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.drawImage(tmp, 0, 0, w, h, 0, 0, c.width, c.height)
  const cellX = c.width / w
  const cellY = c.height / h
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 1; x < w; x++) { ctx.moveTo(x * cellX + 0.5, 0); ctx.lineTo(x * cellX + 0.5, c.height) }
  for (let y = 1; y < h; y++) { ctx.moveTo(0, y * cellY + 0.5); ctx.lineTo(c.width, y * cellY + 0.5) }
  ctx.stroke()
}
watch([calcW, calcH], drawSize)

// ===== 模块 4：像素绘制工具（默认全白背景） =====
const DRAW_N = 16
const drawGrid = ref<ImageData | null>(null)
const drawCanvas = ref<HTMLCanvasElement>()
const pen = ref({ r: 30, g: 144, b: 255 })
const hoverCell = ref<{ x: number, y: number } | null>(null)
const palettes = [
  { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 255, g: 0, b: 0 },
  { r: 255, g: 165, b: 0 }, { r: 255, g: 255, b: 0 }, { r: 0, g: 200, b: 0 },
  { r: 0, g: 200, b: 255 }, { r: 30, g: 144, b: 255 }, { r: 160, g: 32, b: 240 }
]
function initDraw() {
  const img = new ImageData(DRAW_N, DRAW_N)
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = 255 } // 默认全白
  drawGrid.value = img
  drawBuiltin()
}
function drawBuiltin() {
  const c = drawCanvas.value
  if (!c || !drawGrid.value) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  const tmp = new OffscreenCanvas(DRAW_N, DRAW_N)
  tmp.getContext('2d')!.putImageData(drawGrid.value, 0, 0)
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.drawImage(tmp, 0, 0, DRAW_N, DRAW_N, 0, 0, c.width, c.height)
  const cell = c.width / DRAW_N
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1
  for (let i = 1; i < DRAW_N; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, c.height); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(c.width, i * cell); ctx.stroke()
  }
  if (hoverCell.value) {
    ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 3
    ctx.strokeRect(hoverCell.value.x * cell, hoverCell.value.y * cell, cell, cell)
  }
}
function paintAt(e: PointerEvent) {
  if (!drawGrid.value || !client.value) return
  const c = drawCanvas.value
  if (!c) return
  const r = c.getBoundingClientRect()
  const x = Math.min(DRAW_N - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * DRAW_N)))
  const y = Math.min(DRAW_N - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * DRAW_N)))
  const i = (y * DRAW_N + x) * 4
  drawGrid.value.data[i] = pen.value.r
  drawGrid.value.data[i + 1] = pen.value.g
  drawGrid.value.data[i + 2] = pen.value.b
  drawGrid.value.data[i + 3] = 255
  drawBuiltin()
}
function onHover(e: PointerEvent) {
  if (!drawCanvas.value) return
  const c = drawCanvas.value
  const r = c.getBoundingClientRect()
  const x = Math.min(DRAW_N - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * DRAW_N)))
  const y = Math.min(DRAW_N - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * DRAW_N)))
  hoverCell.value = { x, y }
  drawBuiltin()
}
const hoverPixel = computed(() => {
  const h = hoverCell.value
  if (!h || !drawGrid.value) return null
  const i = (h.y * DRAW_N + h.x) * 4
  const [r, g, b] = [drawGrid.value.data[i]!, drawGrid.value.data[i + 1]!, drawGrid.value.data[i + 2]!]
  return { x: h.x, y: h.y, hex: rgbHex(r, g, b) }
})
function clearDraw() {
  if (!drawGrid.value) return
  for (let i = 0; i < drawGrid.value.data.length; i += 4) { drawGrid.value.data[i] = 255; drawGrid.value.data[i + 1] = 255; drawGrid.value.data[i + 2] = 255 }
  drawBuiltin()
}
function fillAll() {
  if (!drawGrid.value) return
  for (let i = 0; i < drawGrid.value.data.length; i += 4) {
    drawGrid.value.data[i] = pen.value.r
    drawGrid.value.data[i + 1] = pen.value.g
    drawGrid.value.data[i + 2] = pen.value.b
    drawGrid.value.data[i + 3] = 255
  }
  drawBuiltin()
}
function downloadDraw() {
  const c = drawCanvas.value
  if (!c) return
  c.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'pixel-art.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, 'image/png')
}

onMounted(() => {
  client.value = true
  try {
    applySource(); initDraw(); drawSize()
  } catch (e: any) { console.warn('pixel init', humanError(e, t)) }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="grid lg:grid-cols-[220px_1fr] gap-6 items-start">
      <!-- 左侧：四个选项导航 -->
      <nav class="lg:sticky lg:top-4 rounded-lg border border-default bg-elevated/50 p-2">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-left transition"
          :class="active === s.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted hover:bg-elevated hover:text-highlighted'"
          @click="active = s.id"
        >
          <UIcon
            :name="s.icon"
            class="size-4 shrink-0"
          />
          <span class="font-mono text-xs opacity-70">{{ s.id }}</span>
          <span>{{ pick(s.title as L) }}</span>
        </button>
      </nav>

      <!-- 右侧：正式内容 -->
      <div>
        <!-- 1 · 存储原理 -->
        <div v-if="active === 1">
          <UCard>
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                  <UIcon
                    name="i-lucide-database"
                    class="size-4 text-primary"
                  />
                  <span>{{ pick({ zh: '像素是如何存储在计算机里的？', en: 'How is a pixel stored?' }) }}</span>
                </div>
                <div class="flex gap-1">
                  <UButton
                    v-for="k in ['photo', 'gradient', 'noise'] as const"
                    :key="k"
                    size="xs"
                    color="neutral"
                    variant="subtle"
                    :class="sourceKind === k ? 'ring-1 ring-primary' : ''"
                    @click="sourceKind = k"
                  >
                    {{ srcLabel(k) }}
                  </UButton>
                </div>
              </div>
            </template>
            <div class="grid lg:grid-cols-2 gap-4">
              <div>
                <p class="text-sm text-muted mb-2">
                  {{ pick({ zh: '把鼠标移到放大后的图上查看每个像素，点击固定选中。每个像素按 RGBA 顺序用 4 字节存储。', en: 'Hover to inspect each pixel, or click to pin it. Every pixel is stored as 4 bytes in RGBA order.' }) }}
                </p>
                <canvas
                  ref="storageCanvas"
                  :width="SRC_N * SCALE"
                  :height="SRC_N * SCALE"
                  class="w-full max-w-[320px] rounded border border-default cursor-crosshair touch-none"
                  @pointermove="onStoragePointer"
                />
                <p
                  v-if="storageSel"
                  class="mt-2 text-sm text-highlighted font-mono"
                >
                  pixel({{ storageSel.x }}, {{ storageSel.y }}) = {{ rbgaOf }} · {{ pick({ zh: '字节', en: 'bytes' }) }}: R,G,B,A
                </p>
              </div>
              <div class="space-y-3 text-sm">
                <p class="text-muted">
                  {{ pick({ zh: '这图被缩到 8×8，每个像素用 4 字节 RGBA，所以内存占用：', en: 'Downsampled to 8×8; 4 RGBA bytes per pixel, so in memory:' }) }}
                  <span class="text-highlighted font-mono">{{ SRC_N }} × {{ SRC_N }} × 4 = {{ srcSizeBytes }} {{ pick({ zh: '字节', en: 'bytes' }) }}</span>
                </p>
                <p class="text-muted">
                  {{ pick({ zh: '数据是连续的一维数组，顺序 R,G,B,A,…。下面是最新一帧前 32 字节（hex）：', en: 'A flat array of R,G,B,A,… The first 32 bytes of this frame (hex):' }) }}
                </p>
                <pre class="rounded bg-elevated/60 p-3 text-[11px] leading-relaxed font-mono overflow-auto">{{ rawHexRows.join('\n') }}</pre>
                <p class="text-xs text-dimmed">
                  {{ pick({ zh: '多样：格式如 JPEG/PNG 会压缩；RAW 直接存这些值。', en: 'Note: JPEG/PNG compress; RAW stores these raw values.' }) }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <!-- 2 · RGB 颜色 -->
        <div v-else-if="active === 2">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-palette"
                  class="size-4 text-primary"
                />
                <span>{{ pick({ zh: 'RGB 颜色原理与混合', en: 'RGB color & mixing' }) }}</span>
              </div>
            </template>
            <p class="text-sm text-muted mb-4">
              {{ pick({ zh: '屏幕用红绿蓝三原色发光合成颜色；调节每通道 0–255 即得任意色彩。', en: 'Screens mix red/green/blue light; tuning each channel 0–255 yields any color.' }) }}
            </p>
            <div class="grid md:grid-cols-2 gap-6">
              <div class="space-y-3">
                <div class="flex items-center gap-3">
                  <div
                    class="size-12 rounded-lg border border-default shrink-0"
                    :style="{ background: rgbHex(col.r, col.g, col.b) }"
                  />
                  <div>
                    <p class="text-sm font-mono text-highlighted">
                      {{ rgbHex(col.r, col.g, col.b) }}
                    </p>
                    <p class="text-xs text-muted font-mono">
                      {{ col.r }}, {{ col.g }}, {{ col.b }} {{ pick({ zh: '（十进制）', en: '(decimal)' }) }}
                    </p>
                  </div>
                </div>
                <label class="block text-xs text-muted">R <span class="text-red-400 font-mono">{{ col.r }}</span> <input
                  v-model.number="col.r"
                  type="range"
                  min="0"
                  max="255"
                  class="w-full accent-primary"
                ></label>
                <label class="block text-xs text-muted">G <span class="text-green-400 font-mono">{{ col.g }}</span> <input
                  v-model.number="col.g"
                  type="range"
                  min="0"
                  max="255"
                  class="w-full accent-primary"
                ></label>
                <label class="block text-xs text-muted">B <span class="text-blue-400 font-mono">{{ col.b }}</span> <input
                  v-model.number="col.b"
                  type="range"
                  min="0"
                  max="255"
                  class="w-full accent-primary"
                ></label>
                <p class="text-xs text-dimmed">
                  {{ pick({ zh: '红+蓝=品红，红+绿=黄，绿+蓝=青——三原色相加可混合出任何颜色。', en: 'Red+Blue=Magenta, Red+Green=Yellow, Green+Blue=Cyan — the additive primaries mix any color.' }) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted mb-2">
                  {{ pick({ zh: '常用颜色预设（十进制 · 十六进制）', en: 'Color presets (decimal · hex)' }) }}
                </p>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="(p, i) in presets"
                    :key="i"
                    type="button"
                    class="flex items-center gap-2 rounded border p-1.5 text-left transition"
                    :class="col.r === p.r && col.g === p.g && col.b === p.b ? 'border-primary bg-primary/10' : 'border-default hover:bg-elevated'"
                    @click="col = { r: p.r, g: p.g, b: p.b }"
                  >
                    <span
                      class="size-7 shrink-0 rounded border border-default"
                      :style="{ background: rgbHex(p.r, p.g, p.b) }"
                    />
                    <span class="text-xs leading-tight">
                      <span class="block font-medium text-highlighted">{{ pick(p.name) }}</span>
                      <span class="block font-mono text-[10px] text-muted">{{ p.r }},{{ p.g }},{{ p.b }} · {{ rgbHex(p.r, p.g, p.b) }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <!-- 3 · 图片大小 -->
        <div v-else-if="active === 3">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-calculator"
                  class="size-4 text-primary"
                />
                <span>{{ pick({ zh: '图片大小怎么算？', en: 'How big is the image?' }) }}</span>
              </div>
            </template>
            <p class="text-sm text-muted mb-4">
              {{ pick({ zh: '未压缩体积 = 宽 × 高 × 每像素位数 ÷ 8。', en: 'Uncompressed size = width × height × bits-per-pixel ÷ 8.' }) }}
            </p>
            <div class="grid md:grid-cols-2 gap-6 items-start">
              <div class="space-y-4">
                <div>
                  <label class="block text-xs text-muted mb-1">{{ pick({ zh: '宽度', en: 'Width' }) }} · <span class="font-mono">{{ calcW }} px</span></label>
                  <input
                    v-model.number="calcW"
                    type="range"
                    min="1"
                    max="40"
                    class="w-full accent-primary"
                  >
                </div>
                <div>
                  <label class="block text-xs text-muted mb-1">{{ pick({ zh: '高度', en: 'Height' }) }} · <span class="font-mono">{{ calcH }} px</span></label>
                  <input
                    v-model.number="calcH"
                    type="range"
                    min="1"
                    max="40"
                    class="w-full accent-primary"
                  >
                </div>
                <div>
                  <label class="block text-xs text-muted mb-1">{{ pick({ zh: '每像素位数（位深）', en: 'Bits per pixel' }) }}</label>
                  <USelect
                    v-model="calcBpp"
                    :items="bppItems"
                    class="w-full"
                  />
                </div>
                <div class="rounded border border-default p-3">
                  <p class="text-sm text-muted">
                    {{ pick({ zh: '体积', en: 'Size' }) }} = <span class="font-mono text-highlighted">{{ calcW }} × {{ calcH }} × {{ calcBpp }} / 8</span> =
                    <span class="text-lg font-bold text-primary font-mono">{{ fmtBytes(calcBytes) }}</span>
                  </p>
                </div>
              </div>
              <div>
                <p class="text-xs text-muted mb-2">
                  {{ pick({ zh: '这就是由下方这么多真实像素组成的图：', en: 'This image is literally made of the pixels below:' }) }}
                </p>
                <canvas
                  ref="sizeCanvas"
                  :width="SIZE_SCALE"
                  :height="SIZE_SCALE"
                  class="w-full max-w-[360px] rounded border border-default"
                />
              </div>
            </div>
          </UCard>
        </div>

        <!-- 4 · 像素绘制工具 -->
        <div v-else>
          <UCard>
            <template #header>
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-brush"
                  class="size-4 text-primary"
                />
                <span>{{ pick({ zh: '像素绘制工具', en: 'Pixel drawing tool' }) }}</span>
              </div>
            </template>
            <div class="grid lg:grid-cols-[auto_1fr] gap-6">
              <div class="space-y-3">
                <canvas
                  ref="drawCanvas"
                  :width="400"
                  :height="400"
                  class="rounded border border-default cursor-pointer touch-none"
                  @pointerdown="paintAt"
                  @pointermove="onHover"
                />
                <p
                  v-if="hoverPixel"
                  class="text-xs text-muted font-mono"
                >
                  ({{ hoverPixel.x }}, {{ hoverPixel.y }}) · {{ hoverPixel.hex }}
                </p>
              </div>
              <div class="space-y-4">
                <div>
                  <p class="text-xs text-muted mb-2">
                    {{ pick({ zh: '画笔颜色', en: 'Brush color' }) }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="(c, i) in palettes"
                      :key="i"
                      type="button"
                      class="size-8 rounded border border-default cursor-pointer"
                      :style="{ background: `rgb(${c.r},${c.g},${c.b})` }"
                      @click="pen = { ...c }"
                    />
                  </div>
                  <div class="mt-3 flex items-center gap-3">
                    <div
                      class="size-8 rounded border border-default shrink-0"
                      :style="{ background: rgbHex(pen.r, pen.g, pen.b) }"
                    />
                    <div class="grid grid-cols-3 gap-2 flex-1">
                      <label class="block text-xs text-muted">R <input
                        v-model.number="pen.r"
                        type="range"
                        min="0"
                        max="255"
                        class="w-full accent-primary"
                      ></label>
                      <label class="block text-xs text-muted">G <input
                        v-model.number="pen.g"
                        type="range"
                        min="0"
                        max="255"
                        class="w-full accent-primary"
                      ></label>
                      <label class="block text-xs text-muted">B <input
                        v-model.number="pen.b"
                        type="range"
                        min="0"
                        max="255"
                        class="w-full accent-primary"
                      ></label>
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    icon="i-lucide-eraser"
                    color="neutral"
                    variant="subtle"
                    @click="clearDraw"
                  >
                    {{ pick({ zh: '清空', en: 'Clear' }) }}
                  </UButton>
                  <UButton
                    icon="i-lucide-paint-bucket"
                    color="neutral"
                    variant="subtle"
                    @click="fillAll"
                  >
                    {{ pick({ zh: '填充全部', en: 'Fill all' }) }}
                  </UButton>
                  <UButton
                    icon="i-lucide-download"
                    color="primary"
                    @click="downloadDraw"
                  >
                    {{ pick({ zh: '下载 PNG', en: 'Download PNG' }) }}
                  </UButton>
                </div>
                <p class="text-xs text-dimmed">
                  {{ pick({ zh: '画布默认全白，点击/拖动用当前画笔上色；底层就是 16×16×4 的字节数组。', en: 'Canvas starts all-white; click/drag to paint. Under the hood it is a 16×16×4 byte array.' }) }}
                </p>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>
