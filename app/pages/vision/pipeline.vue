<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 图像处理入门（教学页，与「像素原理」同组）。
 *
 * 一条固定的六步演示，同一张图逐步被改造：
 *   1 输入 → 2 灰度化 → 3 降噪 → 4 增强 → 5 特征强调 → 6 处理结果（美化）
 * 前五步的输入都是上一步的输出 —— 这正是「图像处理是 AI 视觉第一步」的具体含义。
 * 第 6 步是收尾：前面几步是算法视角（灰度化丢掉颜色、特征强调只剩边缘），
 * 照直串下去最终只能是张边缘图，所以「美化」改读彩色原图，给出给人看的成品。
 *
 * 页面只做一件事：把六步摆出来，每步左边给原图、右边给这一步的效果，
 * 一眼看出「这一小步到底改变了什么」。所以刻意不做流水线搭建器，也不堆文字说明。
 *
 * 执行是渐进的：canvas 算子（灰度 / 降噪 / 增强 / 美化）立刻出结果，
 * 第 5 步的 OpenCV Sobel（约 10MB）加载完成后补上，不会拖住前面的步骤。
 */
import type { PipelineStage, PipelineStep } from '~/utils/image-pipeline'
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import { humanError } from '~/utils/errors'
import { loadImageData } from '~/utils/image'
import { buildLessonSteps, runSegment } from '~/utils/image-pipeline'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'pipeline')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

/** 处理尺寸上限：课堂演示要即时出结果，原图直接跑会明显卡顿（工坊页也是同样的取舍） */
const MAX_EDGE = 1280

/** 六步定义：顺序即讲解顺序，与演示图一一对应 */
const lesson: Array<{ id: string, icon: string, title: L, kind: string }> = [
  { id: 'input', icon: 'i-lucide-image', title: { zh: '1 输入图像', en: '1 Input Image' }, kind: 'ORIGINAL' },
  { id: '0', icon: 'i-lucide-contrast', title: { zh: '2 灰度化', en: '2 Grayscale' }, kind: 'CANVAS · GRAYSCALE' },
  { id: '1', icon: 'i-lucide-eraser', title: { zh: '3 降噪', en: '3 Noise Reduction' }, kind: 'CANVAS · DENOISE' },
  { id: '2', icon: 'i-lucide-sun-medium', title: { zh: '4 增强', en: '4 Enhancement' }, kind: 'CANVAS · ENHANCE' },
  { id: '3', icon: 'i-lucide-pen-tool', title: { zh: '5 特征强调', en: '5 Feature Emphasis' }, kind: 'OPENCV · SOBEL' },
  { id: 'result', icon: 'i-lucide-sparkles', title: { zh: '6 处理结果', en: '6 Processed Image' }, kind: 'CANVAS · BEAUTIFY' }
]

/** 五个算子步骤（灰度 / 降噪 / 增强 / Sobel / 美化），参数取各算子的默认值 */
const steps = ref<PipelineStep[]>(buildLessonSteps())

// ===== 状态 =====
const source = ref<ImageData | null>(null)
const sourceLabel = ref('')
const stages = ref<PipelineStage[]>([])
const running = ref(false)
const errorMsg = ref('')
const client = ref(false)

const originalImage = computed<ImageData | null>(() => stages.value[0]?.image ?? null)
/** 整条链是否算完（第 6 步「处理结果」= 最后一个算子的产物，算完才有意义） */
const complete = computed(() => source.value !== null && stages.value.length === steps.value.length + 1)

/** 第 i 步的产物：0 = 原图，1~4 = 中间算子输出，5 = 整条链的美化成品 */
function outputAt(i: number): ImageData | null {
  const s = stages.value
  if (i === 0) return s[0]?.image ?? null
  if (i === lesson.length - 1) return complete.value ? s[s.length - 1]?.image ?? null : null
  return s[i]?.image ?? null
}

/** 每一行：这一步的效果 + 用来对照的原图 */
const rows = computed(() => lesson.map((step, i) => ({
  ...step,
  index: i,
  isInput: i === 0,
  original: originalImage.value,
  output: outputAt(i)
})))

/** 当前查看的步骤（左侧工具栏选中项，id 即 lesson 的 id） */
const selected = ref(lesson[0]!.id)
const activeRow = computed(() => rows.value.find(r => r.id === selected.value) ?? rows.value[0]!)

/** 左侧步骤工具栏：点一步看一步，不再把六步一屏到底铺下去 */
const sidebarItems = computed<ToolSidebarItem[]>(() => rows.value.map(row => ({
  id: row.id,
  label: pick(row.title),
  kind: row.kind,
  icon: row.icon,
  badge: running.value && !row.output ? t('image.processing') : undefined
})))

// ===== 执行 =====
/** 递增的轮次标记：换了图 / 重复触发时，旧的那一轮会在每个 await 后自行退出 */
let runToken = 0

/**
 * 从原图开始逐步推进：每算完一步就刷新一次画面。
 * 这样慢的 OpenCV 只影响第 5、6 步，前几步立刻可见。
 */
async function runAll() {
  const image = source.value
  if (!image || !client.value) return
  const token = ++runToken
  running.value = true
  errorMsg.value = ''
  try {
    stages.value = [{ id: 'input', image, toolId: null, ms: null }]
    for (let i = 0; i < steps.value.length; i++) {
      if (token !== runToken) return
      const segment = await runSegment(image, stages.value, steps.value, i + 1, lang.value)
      if (token !== runToken) return
      stages.value = segment.stages
    }
  } catch (e: any) {
    if (token === runToken) errorMsg.value = humanError(e, t)
  } finally {
    if (token === runToken) running.value = false
  }
}

// ===== 画布 =====
/** 行号 → canvas 元素；用函数 ref 收集，一有产物就整批重绘 */
const canvases = new Map<string, HTMLCanvasElement>()

function setCanvas(key: string, el: unknown) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el)
  else canvases.delete(key)
}

function drawCanvas(key: string, image: ImageData | null | undefined) {
  const el = canvases.get(key)
  if (!el || !image) return
  if (el.width !== image.width) el.width = image.width
  if (el.height !== image.height) el.height = image.height
  const ctx = el.getContext('2d')
  if (ctx) ctx.putImageData(image, 0, 0)
}

async function drawAll() {
  await nextTick()
  for (const row of rows.value) {
    if (row.isInput) {
      drawCanvas('solo-0', row.output)
      continue
    }
    drawCanvas(`orig-${row.index}`, row.original)
    drawCanvas(`out-${row.index}`, row.output)
  }
}

watch([rows, selected], () => {
  void drawAll()
}, { flush: 'post' })

// ===== 输入 =====
const samples = computed(() => [
  { label: t('samples.noisy'), url: '/samples/images/noisy.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' },
  { label: t('samples.face'), url: '/samples/images/portrait.jpg' }
])

function setSource(image: ImageData, label: string) {
  source.value = image
  sourceLabel.value = label
  void runAll()
}

async function useSample(url: string, label: string) {
  try {
    errorMsg.value = ''
    setSource(await loadImageData(url, MAX_EDGE), label)
  } catch (e: any) {
    errorMsg.value = humanError(e, t)
  }
}

function onFile(file: File) {
  void (async () => {
    try {
      errorMsg.value = ''
      setSource(await loadImageData(file, MAX_EDGE), file.name)
    } catch (e: any) {
      errorMsg.value = humanError(e, t)
    }
  })()
}

function onSample(url: string) {
  void useSample(url, samples.value.find(s => s.url === url)?.label ?? '')
}

onMounted(() => {
  client.value = true
  // 开箱可玩：默认用「噪点照」，正好能看出降噪与增强在做什么
  void useSample(samples.value[0]?.url ?? '', pick({ zh: '噪点示例', en: 'Noisy sample' }))
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <!-- 输入：通用图片输入组件（拖拽 / 示例 / 摄像头） -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon
              name="i-lucide-image-up"
              class="size-4 text-primary"
            />
            <span>{{ pick({ zh: '选择一张图片', en: 'Choose an image' }) }}</span>
            <UBadge
              v-if="sourceLabel"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              {{ sourceLabel }}
            </UBadge>
            <UBadge
              v-if="source"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              {{ source.width }} × {{ source.height }}
            </UBadge>
          </div>
        </template>

        <UAlert
          v-if="errorMsg"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="errorMsg"
          class="mb-3"
        />

        <MediaInput
          accept="image/*"
          camera
          :samples="samples"
          @select="onFile"
          @sample="onSample"
        />
      </UCard>

      <!-- 六步：左侧步骤工具栏，点一步看一步（不再一屏到底往下滚） -->
      <ToolSidebar
        :model-value="selected"
        :items="sidebarItems"
        :title="pick({ zh: '处理步骤', en: 'Steps' })"
        title-icon="i-lucide-list-ordered"
        @update:model-value="(v: string | number) => { selected = String(v) }"
      >
        <UCard :key="activeRow.id">
          <template #header>
            <div class="flex flex-wrap items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                :name="activeRow.icon"
                class="size-4 text-primary"
              />
              <span>{{ pick(activeRow.title) }}</span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ activeRow.kind }}
              </UBadge>
              <UBadge
                v-if="running && !activeRow.output"
                color="info"
                variant="subtle"
                size="xs"
              >
                {{ t('image.processing') }}
              </UBadge>
            </div>
          </template>

          <!-- 第 1 步：输入图本身 -->
          <template v-if="activeRow.isInput">
            <canvas
              v-if="activeRow.output"
              :ref="el => setCanvas('solo-0', el)"
              class="w-full rounded border border-default"
            />
            <p
              v-else
              class="rounded border border-dashed border-default p-8 text-center text-sm text-muted"
            >
              {{ pick({ zh: '先在上面选一张图。', en: 'Pick an image above first.' }) }}
            </p>
          </template>

          <!-- 第 2~6 步：左原图 / 右本步效果 -->
          <div
            v-else
            class="grid gap-4 sm:grid-cols-2"
          >
            <div>
              <p class="mb-1 text-xs text-muted">
                {{ t('image.original') }}
              </p>
              <canvas
                v-if="activeRow.original"
                :ref="el => setCanvas(`orig-${activeRow.index}`, el)"
                class="w-full rounded border border-default"
              />
              <p
                v-else
                class="rounded border border-dashed border-default p-8 text-center text-xs text-muted"
              >
                —
              </p>
            </div>
            <div>
              <p class="mb-1 text-xs text-muted">
                {{ t('image.result') }}
              </p>
              <canvas
                v-if="activeRow.output"
                :ref="el => setCanvas(`out-${activeRow.index}`, el)"
                class="w-full rounded border border-default"
              />
              <p
                v-else
                class="rounded border border-dashed border-default p-8 text-center text-xs text-muted"
              >
                {{ pick({ zh: '处理中…', en: 'Processing…' }) }}
              </p>
            </div>
          </div>
        </UCard>
      </ToolSidebar>
    </div>
  </MediaDemoShell>
</template>
