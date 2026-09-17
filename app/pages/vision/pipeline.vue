<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 图像处理入门（教学页，与「像素原理」同组）。
 *
 * 一条固定的六步演示，点着往下走，同一张图逐步被改造：
 *   1 输入 → 2 灰度化 → 3 降噪 → 4 增强 → 5 特征强调 → 6 处理结果
 * 每一步的输入都是上一步的输出 —— 这正是「图像处理是 AI 视觉第一步」的具体含义。
 *
 * 刻意不做成流水线搭建器：这里是课堂演示，链是固定的、顺序是要讲清的知识点，
 * 不给学生一个几十个算子的目录去挑。每一步背后的算子都来自图像处理工坊注册表
 * （页面会标出对应算子名，方便课后去工坊里单独试）。
 *
 * 逐步推进：学生点到第几步就算到第几步，因此第 5 步的 OpenCV（约 10MB）
 * 只在真正点到那一步时才加载。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { PipelineStage, PipelineStep } from '~/utils/image-pipeline'
import { humanError } from '~/utils/errors'
import { loadImageData } from '~/utils/image'
import { buildLessonSteps, pipelineTool, runSegment } from '~/utils/image-pipeline'
import { buildParamSpecs, pickText } from '~/utils/localized'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'pipeline')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

/** 处理尺寸上限：课堂演示要即时出结果，原图直接跑会明显卡顿（工坊页也是同样的取舍） */
const MAX_EDGE = 1280

// ===== 六步定义（顺序即讲解顺序）=====
interface LessonStep {
  /** 'input' | 'result' | 算子下标字符串 */
  id: string
  icon: string
  /** 侧栏第一行：课堂上的叫法 */
  title: L
  /** 侧栏第二行：对应的工坊算子与引擎 */
  kind: string
  /** 这一步到底做了什么（一句话讲清） */
  note: L
}

/** 四条算子步骤：参数与开关都是可改的，所以是 ref 而不是 computed */
const steps = ref<PipelineStep[]>(buildLessonSteps())

const lesson: LessonStep[] = [
  {
    id: 'input',
    icon: 'i-lucide-image',
    title: { zh: '1 输入', en: '1 Input' },
    kind: 'ORIGINAL',
    note: { zh: '原始图片：AI 拿到的第一手数据。可以先看看它的像素与色彩。', en: 'The raw image: the very first data AI receives. Start by looking at its pixels and colors.' }
  },
  {
    id: '0',
    icon: 'i-lucide-contrast',
    title: { zh: '2 灰度化', en: '2 Grayscale' },
    kind: 'CANVAS · GRAYSCALE',
    note: { zh: '把三个颜色通道压成一个亮度值：数据量降到三分之一，后续运算更快，也让只关心形状的任务不再受颜色干扰。', en: 'Collapses three color channels into one brightness value: a third of the data, faster math, and no color distraction for shape-only tasks.' }
  },
  {
    id: '1',
    icon: 'i-lucide-eraser',
    title: { zh: '3 降噪', en: '3 Noise Reduction' },
    kind: 'CANVAS · DENOISE',
    note: { zh: '噪声是随机的高频跳变，用邻域平均把它抹平。这一步必须在增强之前做 —— 否则噪声会被一起放大，再也去不掉。', en: 'Noise is random high-frequency jitter; neighborhood averaging smooths it out. This must come before enhancement, or the noise gets amplified and can never be removed.' }
  },
  {
    id: '2',
    icon: 'i-lucide-sun-medium',
    title: { zh: '4 增强', en: '4 Enhancement' },
    kind: 'CANVAS · ENHANCE',
    note: { zh: '重新分配灰度范围，把过暗过亮的细节拉开，让明暗对比更清楚。注意它同样会放大残留的噪声，所以顺序不能反。', en: 'Redistributes the gray range so details in dark or bright areas become visible. It also amplifies any remaining noise, which is why the order cannot be swapped.' }
  },
  {
    id: '3',
    icon: 'i-lucide-pen-tool',
    title: { zh: '5 特征强调', en: '5 Feature Emphasis' },
    kind: 'OPENCV · SOBEL',
    note: { zh: 'Sobel 计算亮度梯度，把「变化剧烈的地方」——边缘与轮廓——留成亮线。这才是 AI 真正拿去判断的信息。首次运行需要加载 OpenCV（约 10MB）。', en: 'Sobel computes the brightness gradient and keeps the places that change sharply — edges and contours — as bright lines. This is what AI actually uses to decide. The first run loads OpenCV (~10MB).' }
  },
  {
    id: 'result',
    icon: 'i-lucide-check-check',
    title: { zh: '6 处理结果', en: '6 Processed' },
    kind: 'RESULT',
    note: { zh: '整条链的产物。和原图对比一下：质量更好了、关键信息被突出了，这就是图像处理交给 AI 的东西。', en: 'The output of the whole chain. Compare it with the original: better quality, key information highlighted — this is what image processing hands over to AI.' }
  }
]
const active = ref(0)

const sidebarItems = computed<ToolSidebarItem[]>(() => lesson.map(s => ({
  id: s.title.zh,
  label: pick(s.title),
  kind: s.kind,
  icon: s.icon
})))
const activeId = computed(() => lesson[active.value]?.title.zh ?? '')
function setActive(id: string | number) {
  const index = lesson.findIndex(s => s.title.zh === id)
  if (index >= 0) active.value = index
}

// ===== 状态 =====
const source = ref<ImageData | null>(null)
const sourceLabel = ref('')
const stages = ref<PipelineStage[]>([])
const running = ref(false)
const errorMsg = ref('')
const skipped = ref<string[]>([])
const downloadFormat = ref<'png' | 'jpeg' | 'webp'>('png')
const quality = ref(0.92)

const client = ref(false)
let rerunTimer: ReturnType<typeof setTimeout> | null = null

/** 看第 active 步需要算完几个算子（第 1 步原图不用算，第 6 步结果等于算完全部） */
const needed = computed(() => Math.min(lesson.length - 2, Math.max(0, active.value)))
/** 链上最后一个产物的图像（第 6 步「处理结果」就是它；一个算子都没跑时就是原图） */
const resultImage = computed<ImageData | null>(() => stages.value[stages.value.length - 1]?.image ?? null)

/** 当前步骤对应的产物 */
const currentStage = computed<PipelineStage | undefined>(() => {
  const id = lesson[active.value]?.id
  if (!id) return undefined
  // 第 6 步没有独立的 stages 条目：它就是最后一个算子的产物
  if (id === 'result') {
    const image = resultImage.value
    return image ? { id: 'result', image, toolId: null, ms: null } : undefined
  }
  return stages.value.find(s => s.id === id)
})
const currentStep = computed<PipelineStep | null>(() => {
  const index = active.value - 1
  return index >= 0 && index < steps.value.length ? steps.value[index] ?? null : null
})
const currentTool = computed(() => (currentStep.value ? pipelineTool(currentStep.value.toolId) : undefined))
const currentSpecs = computed(() => buildParamSpecs(currentTool.value?.params, lang.value))
/** 当前这一步是否被跳过（停用 / 算子失败） */
const currentSkipped = computed(() => Boolean(currentStep.value && skipped.value.includes(currentStep.value.toolId)))
const stepMs = computed(() => {
  const ms = currentStage.value?.ms
  return typeof ms === 'number' && ms > 0 ? ms : null
})
// ===== 逐步推进 =====
/**
 * 走到第 stepIndex 步。执行本身全在 runSegment 里（可单测），这里只管状态：
 * 学生点到第几步就算到第几步，所以第 5 步的 OpenCV 只在真正点到时才加载。
 * 正在运行时先把目标记在 active 上，跑完再补一次 —— 否则快速连点会丢掉中间的步。
 */
async function go(stepIndex: number) {
  active.value = Math.max(0, Math.min(lesson.length - 1, stepIndex))
  const image = source.value
  if (!image || !client.value) return
  if (running.value) {
    if (rerunTimer) clearTimeout(rerunTimer)
    rerunTimer = setTimeout(() => {
      void go(active.value)
    }, 120)
    return
  }
  running.value = true
  try {
    const segment = await runSegment(image, stages.value, steps.value, needed.value, lang.value)
    stages.value = segment.stages
    skipped.value = segment.skipped
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = humanError(e, t)
  } finally {
    running.value = false
    if (active.value > needed.value) {
      rerunTimer = setTimeout(() => {
        void go(active.value)
      }, 0)
    }
  }
}

/** 改了第 i 个算子的参数 / 开关：它之后的产物全部作废，再补算到当前看到的这一步 */
function invalidateFrom(operatorIndex: number) {
  stages.value = stages.value.filter(s => s.id === 'input' || (s.id !== 'result' && Number(s.id) < operatorIndex))
  if (rerunTimer) clearTimeout(rerunTimer)
  rerunTimer = setTimeout(() => {
    void go(active.value)
  }, 160)
}

function setStepParams(value: unknown) {
  const index = active.value - 1
  const step = steps.value[index]
  if (!step) return
  const next = steps.value.slice()
  next[index] = { ...step, params: (value ?? {}) as Record<string, number | string | boolean> }
  steps.value = next
  invalidateFrom(index)
}

/** 跳过 / 恢复某一步：让学生亲眼看到「少了这一步会怎样」 */
function setStepEnabled(value: unknown) {
  const index = active.value - 1
  const step = steps.value[index]
  if (!step) return
  const next = steps.value.slice()
  next[index] = { ...step, enabled: Boolean(value) }
  steps.value = next
  invalidateFrom(index)
}

// ===== 输入 =====
const samples = computed(() => [
  { label: t('samples.noisy'), url: '/samples/images/noisy.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' },
  { label: t('samples.face'), url: '/samples/images/portrait.jpg' }
])

async function useSample(url: string, label: string) {
  try {
    errorMsg.value = ''
    source.value = await loadImageData(url, MAX_EDGE)
    sourceLabel.value = label
    resetStages()
  } catch (e: any) {
    errorMsg.value = humanError(e, t)
  }
}
function onFile(file: File) {
  void (async () => {
    try {
      errorMsg.value = ''
      source.value = await loadImageData(file, MAX_EDGE)
      sourceLabel.value = file.name
      resetStages()
    } catch (e: any) {
      errorMsg.value = humanError(e, t)
    }
  })()
}

function resetStages() {
  const image = source.value
  stages.value = image ? [{ id: 'input', image, toolId: null, ms: null }] : []
  skipped.value = []
  if (rerunTimer) clearTimeout(rerunTimer)
  rerunTimer = setTimeout(() => {
    void go(active.value)
  }, 60)
}

// ===== 画布 =====
const mainCanvas = ref<HTMLCanvasElement>()
const compareOrigCanvas = ref<HTMLCanvasElement>()
const resultCanvas = ref<HTMLCanvasElement>()

function drawTo(target: HTMLCanvasElement | undefined, image: ImageData | null | undefined) {
  if (!target || !image) return
  if (target.width !== image.width) target.width = image.width
  if (target.height !== image.height) target.height = image.height
  const ctx = target.getContext('2d')
  if (!ctx) return
  ctx.putImageData(image, 0, 0)
}

watch([currentStage, active, stages], () => {
  drawTo(mainCanvas.value, currentStage.value?.image)
  if (active.value === lesson.length - 1) {
    drawTo(compareOrigCanvas.value, stages.value[0]?.image)
    drawTo(resultCanvas.value, resultImage.value)
  }
}, { flush: 'post' })

// ===== 下载 =====
function download() {
  const image = resultImage.value
  if (!image) return
  const fmt = downloadFormat.value
  const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png'
  const target = document.createElement('canvas')
  target.width = image.width
  target.height = image.height
  const ctx = target.getContext('2d')
  if (!ctx) return
  // JPEG 不支持透明：不铺白底的话透明区会变黑
  if (fmt === 'jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, target.width, target.height)
  }
  ctx.putImageData(image, 0, 0)
  target.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `image-processing.${fmt === 'jpeg' ? 'jpg' : fmt}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, mime, quality.value)
}

// ===== 教学卡片（对应演示页的三段说明）=====
const whyCards = [
  { icon: '📈', title: { zh: '更准', en: 'Improves accuracy' }, text: { zh: '图更好，AI 的预测就更准。', en: 'Better images mean more accurate predictions.' } },
  { icon: '👁️', title: { zh: '更少出错', en: 'Reduces errors' }, text: { zh: '干净的输入，模型犯的错更少。', en: 'Cleaner input means fewer mistakes.' } },
  { icon: '⚡', title: { zh: '更快', en: 'Speeds up processing' }, text: { zh: '更简单清晰的图，算得更快。', en: 'Simpler, clearer images compute faster.' } },
  { icon: '🎯', title: { zh: '突出关键', en: 'Highlights key info' }, text: { zh: '把注意力集中在关键特征上，忽略干扰。', en: 'Focuses on key features and ignores distractions.' } }
]
const whereUsed = [
  { icon: '📱', label: { zh: '人脸解锁', en: 'Face unlock' } },
  { icon: '🩻', label: { zh: '医学影像', en: 'Medical imaging' } },
  { icon: '🚗', label: { zh: '自动驾驶', en: 'Self-driving cars' } },
  { icon: '📷', label: { zh: '照片增强', en: 'Photo enhancement' } },
  { icon: '📄', label: { zh: '文档扫描', en: 'Document scanning' } },
  { icon: '🛰️', label: { zh: '安防与无人机', en: 'Security cameras & drones' } }
]

onMounted(() => {
  client.value = true
  // 开箱可玩：默认用「噪点照」，正好能看出降噪与增强在做什么
  void useSample(samples.value[0]?.url ?? '', pick({ zh: '噪点示例', en: 'Noisy sample' }))
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <ToolSidebar
      :model-value="activeId"
      :title="pick({ zh: '六个步骤', en: 'Six steps' })"
      title-icon="i-lucide-list-ordered"
      :items="sidebarItems"
      @update:model-value="setActive"
    >
      <div class="space-y-4">
        <!-- 这一步的画面 -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  :name="lesson[active]?.icon ?? 'i-lucide-image'"
                  class="size-4 text-primary"
                />
                <span>{{ pick(lesson[active]?.title ?? { zh: '', en: '' }) }}</span>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ lesson[active]?.kind }}
                </UBadge>
                <UBadge
                  v-if="running"
                  color="info"
                  variant="subtle"
                  size="xs"
                >
                  {{ t('image.processing') }}
                </UBadge>
                <UBadge
                  v-else-if="stepMs !== null"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ Math.round(stepMs) }} ms
                </UBadge>
              </div>
              <div class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-chevron-left"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  :disabled="active === 0 || running"
                  @click="go(active - 1)"
                >
                  {{ pick({ zh: '上一步', en: 'Previous' }) }}
                </UButton>
                <UButton
                  icon="i-lucide-chevron-right"
                  size="xs"
                  color="primary"
                  variant="subtle"
                  :trailing="true"
                  :disabled="active === lesson.length - 1 || running"
                  @click="go(active + 1)"
                >
                  {{ pick({ zh: '下一步', en: 'Next' }) }}
                </UButton>
              </div>
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

          <!-- 第 1 步：输入（上传 / 示例） -->
          <div
            v-if="active === 0"
            class="space-y-4"
          >
            <MediaInput
              accept="image/*"
              :samples="samples"
              @select="onFile"
              @sample="(url: string) => useSample(url, samples.find(s => s.url === url)?.label ?? '')"
            />
          </div>

          <!-- 画面：第 1 步是原图，第 2~5 步是这一步的产物，第 6 步是最终结果 -->
          <div class="relative mt-4">
            <canvas
              v-if="currentStage"
              ref="mainCanvas"
              data-slot="stage-main"
              class="w-full rounded border border-default"
            />
            <p
              v-else
              class="rounded border border-dashed border-default p-8 text-center text-sm text-muted"
            >
              {{ pick({ zh: '先在上面选一张图。', en: 'Pick an image above first.' }) }}
            </p>
            <p
              v-if="running"
              class="absolute inset-0 flex items-center justify-center rounded bg-black/40 text-sm text-white"
            >
              {{ t('image.processing') }}
            </p>
          </div>
          <p
            v-if="active === 0 && source"
            class="mt-2 text-xs text-dimmed"
          >
            {{ sourceLabel }} · {{ source.width }}×{{ source.height }}
            <span v-if="Math.max(source.width, source.height) >= MAX_EDGE">{{ pick({ zh: `（已缩到最长边 ${MAX_EDGE}px）`, en: ` (scaled to ${MAX_EDGE}px)` }) }}</span>
          </p>

          <!-- 第 2~5 步：参数 + 「跳过这一步」 -->
          <template v-if="active > 0 && active < lesson.length - 1">
            <DemoParams
              v-if="currentSpecs.length"
              class="mt-4"
              :model-value="currentStep?.params ?? {}"
              :specs="currentSpecs"
              :running="running"
              :title="pick({ zh: '这一步的参数', en: 'Parameters for this step' })"
              @update:model-value="setStepParams($event)"
            />
            <div class="mt-4 flex items-center gap-3 rounded-lg border border-default p-3">
              <USwitch
                :model-value="currentStep?.enabled ?? true"
                size="sm"
                @update:model-value="setStepEnabled($event)"
              />
              <div>
                <p class="text-sm text-highlighted">
                  {{ pick({ zh: '跳过这一步', en: 'Skip this step' }) }}
                </p>
                <p class="text-xs text-dimmed">
                  {{ pick({ zh: '关掉它，看后面的结果有什么不同 —— 顺序为什么不能反，一眼就看出来了。', en: 'Turn it off and compare the later steps — it shows at a glance why the order matters.' }) }}
                </p>
              </div>
            </div>
          </template>

          <p class="mt-3 text-sm text-muted">
            {{ pick(lesson[active]?.note ?? { zh: '', en: '' }) }}
          </p>
          <p
            v-if="currentSkipped"
            class="mt-2 text-xs text-warning"
          >
            {{ pick({ zh: '这一步已跳过：上图显示的是上一步的产物。', en: 'This step is skipped: the image above is the previous step’s output.' }) }}
          </p>
          <p
            v-if="currentTool"
            class="mt-1 text-xs text-dimmed"
          >
            {{ pick({ zh: '对应工坊算子：', en: 'Workbench operator: ' }) }}{{ pickText(currentTool.name, lang) }}
          </p>
        </UCard>

        <!-- 第 6 步：与第 5 步同屏对比 + 下载 -->
        <UCard v-if="active === lesson.length - 1">
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                name="i-lucide-git-compare"
                class="size-4 text-primary"
              />
              <span>{{ pick({ zh: '原图 vs 处理结果', en: 'Original vs processed' }) }}</span>
            </div>
          </template>
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <p class="text-xs text-muted mb-1">
                {{ t('image.original') }}
              </p>
              <canvas
                ref="compareOrigCanvas"
                data-slot="stage-original"
                class="w-full rounded border border-default"
              />
            </div>
            <div>
              <p class="text-xs text-muted mb-1">
                {{ t('image.result') }}
              </p>
              <canvas
                ref="resultCanvas"
                data-slot="stage-result"
                class="w-full rounded border border-default"
              />
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <p class="text-xs text-muted mb-1">
                {{ t('image.format') }}
              </p>
              <USelect
                v-model="downloadFormat"
                :items="[{ label: 'PNG', value: 'png' }, { label: 'JPEG', value: 'jpeg' }, { label: 'WebP', value: 'webp' }]"
              />
            </div>
            <div v-if="downloadFormat !== 'png'">
              <p class="text-xs text-muted mb-1">
                {{ t('image.quality') }} · {{ Math.round(quality * 100) }}%
              </p>
              <input
                v-model.number="quality"
                type="range"
                min="0.3"
                max="1"
                step="0.02"
                class="w-40 accent-primary"
              >
            </div>
            <UButton
              icon="i-lucide-download"
              color="primary"
              :disabled="!resultImage"
              @click="download"
            >
              {{ t('image.download') }}
            </UButton>
          </div>
        </UCard>

        <!-- 三段教学说明（对应演示页的 Why / Where / Think） -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                name="i-lucide-graduation-cap"
                class="size-4 text-primary"
              />
              <span>{{ pick({ zh: '为什么图像处理是 AI 视觉的第一步', en: 'Why image processing comes first' }) }}</span>
            </div>
          </template>
          <div class="space-y-5">
            <div>
              <p class="text-sm font-medium text-highlighted mb-2">
                ⭐ {{ pick({ zh: '为什么重要', en: 'Why it matters' }) }}
              </p>
              <ul class="grid sm:grid-cols-2 gap-2">
                <li
                  v-for="c in whyCards"
                  :key="c.title.en"
                  class="flex gap-2 text-sm text-muted"
                >
                  <span>{{ c.icon }}</span>
                  <span><span class="text-highlighted">{{ pick(c.title) }}</span> —— {{ pick(c.text) }}</span>
                </li>
              </ul>
            </div>
            <div>
              <p class="text-sm font-medium text-highlighted mb-2">
                🌍 {{ pick({ zh: '用在哪里', en: 'Where it is used' }) }}
              </p>
              <div class="flex flex-wrap gap-2">
                <UBadge
                  v-for="w in whereUsed"
                  :key="w.label.en"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  {{ w.icon }} {{ pick(w.label) }}
                </UBadge>
              </div>
            </div>
            <div>
              <p class="text-sm font-medium text-highlighted mb-2">
                💡 {{ pick({ zh: '想一想', en: 'Think about it' }) }}
              </p>
              <p class="text-sm text-muted">
                {{ pick({
                  zh: '如果图很模糊或者太暗，AI 会遇到什么麻烦？把第 3 步（降噪）关掉再看第 5 步的边缘，会出现什么变化？',
                  en: 'What trouble does a blurry or too-dark image cause for AI? Turn step 3 (denoise) off and look at step 5’s edges again — what changes?'
                }) }}
              </p>
            </div>
            <p
              v-if="skipped.length"
              class="text-xs text-warning"
            >
              {{ pick({ zh: '跳过的步骤：', en: 'Skipped steps: ' }) }}{{ skipped.join(', ') }}
            </p>
          </div>
        </UCard>
      </div>
    </ToolSidebar>
  </MediaDemoShell>
</template>
