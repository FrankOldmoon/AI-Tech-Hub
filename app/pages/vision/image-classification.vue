<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 图像分类入门（教学页，与「图像处理入门」「特征提取入门」「边缘检测入门」同组）。
 *
 * 教学图讲五步：输入图像 → 特征提取 → 学习与模式 → 分类 → 输出。
 *
 * 这页的两条线是刻意并排的：
 *   真实线（第 1、2、4、5 步）—— 用通用图片输入组件挑一张 dog / cat / 任意照片，
 *                               第 4 步直接跑 MediaPipe EfficientNet-Lite0，给出 Top-5 与置信度；
 *   迷你线（第 3、4 步）      —— 用一个「能看见」的四类形状小模型，把「学习」和「打分」摊开讲：
 *                               同类例子平均成原型（学习），余弦相似度 + softmax 变成百分比（分类）。
 *
 * 为什么要并排：真实模型的「学习」发生在几百万张图和几百亿参数里，屏幕上看不见；
 * 而「余弦 + softmax」这套打分逻辑，小模型和真实模型其实是一样的。于是：
 * 小模型负责「看得懂」，真实模型负责「用得上」。
 *
 * 执行层在 ~/utils/image-classification（纯函数，Node 里可测）；这页只管摆画面与交互。
 * 计算全部在浏览器本地完成，不上传任何图片。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { ScalarField } from '~/utils/feature-extraction'
import { humanError } from '~/utils/errors'
import { loadImageData } from '~/utils/image'
import { fieldToImageData, toGrayFloat } from '~/utils/feature-extraction'
import { gradientFields, magnitudeField } from '~/utils/edge-detection'
import {
  SHAPE_CLASSES,
  DEFAULT_TEMPERATURE,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
  shapeSample,
  descriptorOf,
  thumbnailImage,
  trainPrototypes,
  scoreClasses,
  learningCurve,
  type Prototype,
  type ClassScore,
  type TrainingExample
} from '~/utils/image-classification'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'image-classification')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

/** 处理尺寸上限：卷积/边缘都是逐像素运算，原图直接跑会卡（课堂要即时反馈） */
const MAX_EDGE = 720
/** 学习曲线的采样点 */
const CURVE_COUNTS = [1, 2, 4, 8, 16]

/** 五个步骤：顺序即讲解顺序，与教学图一一对应 */
const lesson: Array<{ id: string, icon: string, title: L, kind: string }> = [
  { id: 'input', icon: 'i-lucide-image', title: { zh: '1 输入图像', en: '1 Input Image' }, kind: 'CHOOSE · UPLOAD' },
  { id: 'features', icon: 'i-lucide-grid-3x3', title: { zh: '2 特征提取', en: '2 Feature Extraction' }, kind: 'GRAY · EDGE' },
  { id: 'learn', icon: 'i-lucide-brain', title: { zh: '3 学习与模式', en: '3 Learn Patterns' }, kind: 'PROTOTYPES' },
  { id: 'classify', icon: 'i-lucide-scan-search', title: { zh: '4 分类', en: '4 Classify' }, kind: 'COSINE · SOFTMAX · EfficientNet-Lite0' },
  { id: 'output', icon: 'i-lucide-trophy', title: { zh: '5 输出', en: '5 Output' }, kind: 'ANSWER · CONFIDENCE' }
]

/** 为什么重要（教学图右侧那一栏） */
const whyItems: Array<{ icon: string, title: L, text: L }> = [
  {
    icon: 'i-lucide-tags',
    title: { zh: '让电脑认识世界', en: 'Lets computers recognise the world' },
    text: { zh: '分类是绝大多数视觉任务的第一步：认出图里是猫是狗，还是别的什么。', en: 'Classification is the first step of most vision tasks: telling what is in the picture.' }
  },
  {
    icon: 'i-lucide-layer-group',
    title: { zh: '把混乱变有序', en: 'Turns chaos into order' },
    text: { zh: '海量图片按类别归拢后，搜索、相册、质检才能跑起来。', en: 'Sorting huge image collections by category powers search, albums and inspection.' }
  },
  {
    icon: 'i-lucide-shield-alert',
    title: { zh: '自动发现异常', en: 'Auto-spots what is wrong' },
    text: { zh: '分不进已知类别的东西，往往就是需要警惕的异常。', en: 'Things that do not fit any known class are often exactly what we should worry about.' }
  },
  {
    icon: 'i-lucide-rocket',
    title: { zh: '驱动无数应用', en: 'Powers countless apps' },
    text: { zh: '从相册整理到医学诊断，分类模型就在每个人的口袋里。', en: 'From photo organising to medical diagnosis, classifiers live in everyone’s pocket.' }
  }
]

/** 用在哪里（教学图底部那一排） */
const useItems: Array<{ icon: string, label: L }> = [
  { icon: 'i-lucide-images', label: { zh: '相册自动整理', en: 'Photo albums' } },
  { icon: 'i-lucide-stethoscope', label: { zh: '医学影像', en: 'Medical imaging' } },
  { icon: 'i-lucide-car', label: { zh: '自动驾驶', en: 'Self-driving' } },
  { icon: 'i-lucide-leaf', label: { zh: '农作物识别', en: 'Crop recognition' } },
  { icon: 'i-lucide-camera', label: { zh: '拍照翻译', en: 'Camera translation' } },
  { icon: 'i-lucide-bot', label: { zh: '智能机器人', en: 'Smart robots' } }
]

/** 想一想（教学图底部） */
const thinkItems: Array<{ icon: string, text: L }> = [
  {
    icon: 'i-lucide-help-circle',
    text: { zh: '如果每个类别只给 1 张图，小模型会学到什么？多给图又能补上什么？', en: 'With only one example per class, what does the mini model learn? What do more examples add?' }
  },
  {
    icon: 'i-lucide-scales',
    text: { zh: '分数高一定是对的吗？「很自信却错了」在哪些场景最危险？', en: 'Is a high score always right? Where is being confidently wrong the most dangerous?' }
  },
  {
    icon: 'i-lucide-shapes',
    text: { zh: '为什么轮廓（边缘）比实心填充更利于分类？想想上一页讲的边缘检测。', en: 'Why are outlines (edges) better for classification than solid fills? Recall the edge-detection page.' }
  }
]

// ===== 状态 =====
const selected = ref(lesson[0]!.id)
const errorMsg = ref('')

// 真实线
const source = ref<ImageData | null>(null)
const sourceLabel = ref('')
const gray = ref<ScalarField | null>(null)
const edges = ref<ScalarField | null>(null)
const computing = ref(false)
const predictions = ref<Array<{ name: string, score: number }>>([])
const classifying = ref(false)
const classifyMs = ref<number | null>(null)
const classifyError = ref('')

// 迷你线（四类形状）
const toyClassId = ref(SHAPE_CLASSES[0]!.id)
const toyInput = ref<ScalarField | null>(null)
const perClass = ref(8)
const temperature = ref(DEFAULT_TEMPERATURE)
const prototypes = ref<Prototype[]>([])
const examples = ref<Record<string, TrainingExample[]>>({})
const curve = ref<Array<{ count: number, accuracy: number }>>([])

const activeRow = computed(() => lesson.find(s => s.id === selected.value) ?? lesson[0]!)
const sidebarItems = computed<ToolSidebarItem[]>(() =>
  lesson.map(step => ({
    id: step.id,
    label: pick(step.title),
    kind: step.kind,
    icon: step.icon,
    badge: step.id === 'features' && computing.value ? t('image.processing') : undefined
  }))
)

// ===== 迷你线的派生 =====
const toyDescriptor = computed(() => (toyInput.value ? descriptorOf(toyInput.value, { edge: true }) : null))
const toyRanked = computed<ClassScore[]>(() =>
  (toyDescriptor.value && prototypes.value.length)
    ? scoreClasses(toyDescriptor.value, prototypes.value, temperature.value)
    : []
)
const toyPredictions = computed(() => toyRanked.value.map(r => ({ name: pick(r.name), score: r.score })))

// ===== 真实线的派生 =====
const topPrediction = computed(() => predictions.value[0] ?? null)
const secondScore = computed(() => predictions.value[1]?.score ?? 0)
const topMargin = computed(() => (topPrediction.value ? topPrediction.value.score - secondScore.value : 0))

// ===== 输入 =====
const samples = computed(() => [
  { label: t('samples.dog'), url: '/samples/images/dog.jpg' },
  { label: t('samples.cat'), url: '/samples/images/cat.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' },
  { label: t('samples.texture'), url: '/samples/images/texture.jpg' }
])

async function computeFeatures(image: ImageData) {
  computing.value = true
  await new Promise(resolve => setTimeout(resolve, 0))
  try {
    const g = toGrayFloat(image)
    gray.value = g
    const fields = gradientFields(g, 'sobel')
    edges.value = magnitudeField(fields.gx, fields.gy)
  } finally {
    computing.value = false
  }
}

function setSource(image: ImageData, label: string) {
  source.value = image
  sourceLabel.value = label
  // 换图后上一次的结论作废；模型已加载的话顺手重跑一遍
  predictions.value = []
  classifyMs.value = null
  const rerun = !!classifier
  void computeFeatures(image).then(() => {
    if (rerun) void runClassify()
  })
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

// ===== 迷你线：学习 =====
function retrain() {
  const res = trainPrototypes(SHAPE_CLASSES, { perClass: perClass.value, edge: true })
  prototypes.value = res.prototypes
  examples.value = res.examples
}

function setToyShape(classId: string) {
  toyClassId.value = classId
  const seed = Math.floor(Math.random() * 1e9) + 1
  const { field } = shapeSample(classId, { difficulty: 0.45, seed })
  toyInput.value = field
}

// ===== 分类：真实模型 =====
let classifier: any = null

async function ensureClassifier() {
  if (classifier) return classifier
  const [{ ImageClassifier, FilesetResolver }, { mediapipeWasm, mediapipeModels }] = await Promise.all([
    import('@mediapipe/tasks-vision'),
    import('~/utils/mediapipe')
  ])
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  const baseOptions = { modelAssetPath: mediapipeModels.imageClassifier, delegate: 'GPU' as const }
  const options = { baseOptions, runningMode: 'IMAGE' as const, maxResults: 5 }
  try {
    classifier = await ImageClassifier.createFromOptions(vision, options)
  } catch {
    // 没有 WebGL2 的机器上用 CPU 兜底，慢一点但能跑
    classifier = await ImageClassifier.createFromOptions(vision, {
      ...options,
      baseOptions: { ...baseOptions, delegate: 'CPU' as const }
    })
  }
  return classifier
}

/** 真的跑一遍分类：输入是原图，输出是 Top-5 类别与置信度 */
async function runClassify() {
  const image = source.value
  if (!image || classifying.value) return
  classifying.value = true
  classifyError.value = ''
  const started = performance.now()
  try {
    const model = await ensureClassifier()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d')!.putImageData(image, 0, 0)
    const bitmap = await createImageBitmap(canvas)
    let result: any
    try {
      result = model.classify(bitmap)
    } finally {
      bitmap.close?.()
    }
    const categories: any[] = result?.classifications?.[0]?.categories ?? []
    predictions.value = categories.map(c => ({
      name: c.categoryName || c.displayName || c.label || '?',
      score: Number(c.score) || 0
    }))
    classifyMs.value = Math.round(performance.now() - started)
  } catch (e: any) {
    classifyError.value = humanError(e, t)
  } finally {
    classifying.value = false
  }
}

// ===== 画布 =====
const canvases = new Map<string, HTMLCanvasElement>()

function setCanvas(key: string, el: unknown) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el)
  else canvases.delete(key)
}

function imageFor(key: string): ImageData | null {
  if (key === 'src' || key === 'src2' || key === 'src3') return source.value
  if (key === 'gray') return gray.value ? fieldToImageData(gray.value) : null
  if (key === 'edges') return edges.value ? fieldToImageData(edges.value) : null
  if (key === 'toy' && toyInput.value) return fieldToImageData(toyInput.value)
  if (key.startsWith('proto-') && prototypes.value.length) {
    const id = key.slice('proto-'.length)
    const p = prototypes.value.find(pp => pp.classId === id)
    return p ? thumbnailImage(p.thumbnail, p.grid) : null
  }
  if (key.startsWith('ex-') && examples.value) {
    const rest = key.slice('ex-'.length)
    const dash = rest.lastIndexOf('-')
    const id = rest.slice(0, dash)
    const idx = Number(rest.slice(dash + 1))
    const ex = examples.value[id]?.[idx]
    return ex ? fieldToImageData(ex.field) : null
  }
  return null
}

function drawCanvas(el: HTMLCanvasElement, image: ImageData | null) {
  if (!image) return
  if (el.width !== image.width) el.width = image.width
  if (el.height !== image.height) el.height = image.height
  const ctx = el.getContext('2d')
  if (ctx) ctx.putImageData(image, 0, 0)
}

async function drawAll() {
  await nextTick()
  for (const [key, el] of canvases) drawCanvas(el, imageFor(key))
}

watch(
  [source, gray, edges, toyInput, toyDescriptor, prototypes, examples, selected],
  () => { void drawAll() },
  { flush: 'post' }
)

/** 切步骤：第一次进「分类」时才去加载分类模型（约 18MB，不提前占带宽） */
function selectStep(id: string | number) {
  selected.value = String(id)
  if (selected.value === 'classify' && source.value && !predictions.value.length) void runClassify()
}

onMounted(() => {
  void useSample(samples.value[0]?.url ?? '', samples.value[0]?.label ?? '')
  retrain()
  setToyShape(SHAPE_CLASSES[0]!.id)
  curve.value = learningCurve(CURVE_COUNTS, {
    edge: true,
    evalJitter: { translation: 0.15, scale: 0.2, rotation: 0, noise: 0.17 }
  })
})

onBeforeUnmount(() => {
  try {
    classifier?.close?.()
  } catch {
    // 忽略卸载时的关闭异常
  }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <!-- 出错提示放页面级：任何一步失败都要看得见 -->
      <UAlert
        v-if="errorMsg"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="errorMsg"
      />

      <!-- 五步：左侧步骤工具栏，点一步看一步 -->
      <ToolSidebar
        :model-value="selected"
        :items="sidebarItems"
        :title="pick({ zh: '五个步骤', en: 'Five steps' })"
        title-icon="i-lucide-list-ordered"
        @update:model-value="selectStep"
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
                v-if="activeRow.id === 'input' && sourceLabel"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ sourceLabel }}
              </UBadge>
              <UBadge
                v-if="activeRow.id === 'input' && source"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ source.width }} × {{ source.height }}
              </UBadge>
              <UBadge
                v-if="activeRow.id === 'features' && computing"
                color="info"
                variant="subtle"
                size="xs"
              >
                {{ t('image.processing') }}
              </UBadge>
            </div>
          </template>

          <!-- ===== 1 输入图像 ===== -->
          <template v-if="activeRow.id === 'input'">
            <canvas
              v-if="source"
              :ref="el => setCanvas('src', el)"
              class="w-full rounded border border-default"
            />
            <p
              v-else
              class="rounded border border-dashed border-default p-8 text-center text-sm text-muted"
            >
              {{ pick({ zh: '还没有选图。', en: 'No image selected yet.' }) }}
            </p>

            <p class="mt-3 text-sm text-muted">
              {{ pick({
                zh: '分类的第一步永远是「有一张图」。选一张示例图（比如 dog 或 cat），或拖入自己的照片 —— 它会被送进后面的每一步。',
                en: 'Classification always starts with an image. Pick a sample (say dog or cat), or drop in your own photo — it will travel through every step below.'
              }) }}
            </p>

            <MediaInput
              class="mt-4"
              accept="image/*"
              camera
              :samples="samples"
              @select="onFile"
              @sample="onSample"
            />

            <div class="mt-6">
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '为什么这一步重要？', en: 'Why is it important?' }) }}
              </p>
              <div class="grid gap-3 sm:grid-cols-2">
                <div
                  v-for="item in whyItems"
                  :key="item.icon"
                  class="flex gap-3 rounded border border-default p-3"
                >
                  <UIcon
                    :name="item.icon"
                    class="mt-0.5 size-5 shrink-0 text-primary"
                  />
                  <div>
                    <p class="text-sm font-medium text-highlighted">
                      {{ pick(item.title) }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ pick(item.text) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- ===== 2 特征提取 ===== -->
          <template v-if="activeRow.id === 'features'">
            <p class="text-sm text-muted">
              {{ pick({
                zh: '计算机不「看」图，它算数。这一步先把彩色图压成灰度（亮度），再算每一点和邻居差多少 —— 差值大的地方就是轮廓。轮廓比颜色更稳：同一只猫换个背景、换点光线，轮廓还在。',
                en: 'A computer does not “look” at an image — it does maths. This step first flattens colour into brightness (grayscale), then measures how much each pixel differs from its neighbours. Big differences are outlines. Outlines are steadier than colour: move the cat to another background and the outline is still there.'
              }) }}
            </p>

            <div class="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p class="mb-1 text-xs font-medium text-dimmed">
                  {{ pick({ zh: '原图', en: 'Original' }) }}
                </p>
                <canvas
                  v-if="source"
                  :ref="el => setCanvas('src2', el)"
                  class="aspect-square w-full rounded border border-default bg-black"
                />
              </div>
              <div>
                <p class="mb-1 text-xs font-medium text-dimmed">
                  {{ pick({ zh: '灰度（只看亮度）', en: 'Grayscale (brightness only)' }) }}
                </p>
                <canvas
                  v-if="gray"
                  :ref="el => setCanvas('gray', el)"
                  class="aspect-square w-full rounded border border-default bg-black"
                />
              </div>
              <div>
                <p class="mb-1 text-xs font-medium text-dimmed">
                  {{ pick({ zh: '轮廓（边缘强度）', en: 'Outline (edge strength)' }) }}
                </p>
                <canvas
                  v-if="edges"
                  :ref="el => setCanvas('edges', el)"
                  class="aspect-square w-full rounded border border-default bg-black"
                />
              </div>
            </div>

            <p class="mt-4 text-xs text-muted">
              {{ pick({
                zh: '这里展示的是「手工特征」—— 人能算、能看的特征。真实的分类模型则是在训练里自己学出成千上万个更好的特征，这一步只让你看清「特征」到底长什么样。',
                en: 'What you see here are hand-made features — ones a person can compute and look at. A real classifier instead learns thousands of far better features during training; this step just makes “a feature” visible.'
              }) }}
            </p>

            <UButton
              class="mt-3"
              to="/vision/feature-extraction"
              variant="ghost"
              color="neutral"
              size="xs"
            >
              <UIcon
                name="i-lucide-arrow-right"
                class="size-3.5"
              />
              {{ pick({ zh: '想深入看「特征提取」的原理 →', en: 'Go deeper on feature extraction →' }) }}
            </UButton>
          </template>

          <!-- ===== 3 学习与模式 ===== -->
          <template v-if="activeRow.id === 'learn'">
            <p class="text-sm text-muted">
              {{ pick({
                zh: '真实模型是在几百万张带标签的图上学的，这个过程屏幕里看不见。于是这里用一个「迷你模型」把学习摊开：给四类形状各若干带变化的例子，把它们对齐、归一化后平均成一张「原型」。原型就是它学到的东西 —— 一张能直接看的模板。',
                en: 'Real models learn from millions of labelled images — a process you cannot see on screen. So here a “mini model” opens it up: give each of four shapes a few varied examples, align and normalise them, then average into a “prototype”. The prototype is what it learned — a template you can look at.'
              }) }}
            </p>

            <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div
                v-for="cls in SHAPE_CLASSES"
                :key="cls.id"
                class="rounded border border-default p-2 text-center"
              >
                <canvas
                  :ref="el => setCanvas('proto-' + cls.id, el)"
                  class="aspect-square w-full rounded bg-black"
                />
                <p class="mt-1 text-xs font-medium text-highlighted">
                  {{ pick(cls.name) }}
                </p>
                <p class="text-[10px] text-dimmed uppercase tracking-wide">
                  {{ pick({ zh: '原型', en: 'prototype' }) }}
                </p>
              </div>
            </div>

            <div class="mt-4 rounded border border-default p-3">
              <div class="flex items-center justify-between gap-3">
                <label class="text-xs font-medium text-highlighted">{{ pick({ zh: '每类训练例子数', en: 'Examples per class' }) }}</label>
                <span class="text-xs tabular-nums text-muted">{{ perClass }}</span>
              </div>
              <input
                v-model.number="perClass"
                type="range"
                min="1"
                max="16"
                step="1"
                class="mt-2 w-full accent-primary"
                @input="retrain"
              >
              <p class="mt-2 text-[11px] text-dimmed">
                {{ pick({
                  zh: '少给例子，原型还模糊；多给例子，平均之后轮廓才清晰。下面这条曲线用「更难」的测试集，能看出例子越多、准确率越高。',
                  en: 'Few examples → the prototype is blurry; many examples → averaging reveals a clean outline. The curve below uses a harder test set, so accuracy rises as examples grow.'
                }) }}
              </p>
            </div>

            <!-- 学习曲线 -->
            <div class="mt-4 rounded border border-default p-3">
              <p class="mb-2 text-xs font-medium text-highlighted">
                {{ pick({ zh: '学习曲线：例子越多越准', en: 'Learning curve: more examples → better' }) }}
              </p>
              <div class="flex h-28 items-end gap-2">
                <div
                  v-for="pt in curve"
                  :key="pt.count"
                  class="flex flex-1 flex-col items-center justify-end gap-1"
                >
                  <span class="text-[10px] tabular-nums text-muted">{{ Math.round(pt.accuracy * 100) }}%</span>
                  <div
                    class="w-full rounded-t bg-primary/70"
                    :style="{ height: `${Math.max(4, pt.accuracy * 100)}%` }"
                  />
                  <span class="text-[10px] text-dimmed">{{ pt.count }}</span>
                </div>
              </div>
              <p class="mt-1 text-center text-[10px] text-dimmed">
                {{ pick({ zh: '横轴 = 每类例子数', en: 'x = examples per class' }) }}
              </p>
            </div>

            <!-- 训练样例网格 -->
            <div class="mt-4">
              <p class="mb-2 text-xs font-medium text-highlighted">
                {{ pick({ zh: '部分训练样例', en: 'Some training examples' }) }}
              </p>
              <div
                v-for="cls in SHAPE_CLASSES"
                :key="cls.id"
                class="mb-2"
              >
                <p class="mb-1 text-[11px] text-dimmed">
                  {{ pick(cls.name) }}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <canvas
                    v-for="(ex, i) in (examples[cls.id] || []).slice(0, 6)"
                    :key="i"
                    :ref="el => setCanvas('ex-' + cls.id + '-' + i, el)"
                    class="size-10 rounded border border-default bg-black"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- ===== 4 分类 ===== -->
          <template v-if="activeRow.id === 'classify'">
            <p class="text-sm text-muted">
              {{ pick({
                zh: '分类就是「给每个类别打分」。左边是迷你模型：你能看清每一步怎么算；右边是真实模型：同样的思路，但特征和参数都是它自己学出来的。',
                en: 'Classification means scoring every class. On the left is the mini model, where you can see every calculation; on the right is the real model — the same idea, but with features and parameters it learned itself.'
              }) }}
            </p>

            <div class="mt-4 grid gap-4 lg:grid-cols-2">
              <!-- 迷你模型：透明打分 -->
              <div class="rounded-lg border border-default p-3">
                <p class="mb-2 flex items-center gap-2 text-xs font-medium text-highlighted">
                  <UIcon
                    name="i-lucide-shapes"
                    class="size-4 text-primary"
                  />
                  {{ pick({ zh: '迷你模型（四类形状 · 可看穿）', en: 'Mini model (four shapes · transparent)' }) }}
                </p>

                <div class="mb-3 flex flex-wrap gap-1.5">
                  <UButton
                    v-for="cls in SHAPE_CLASSES"
                    :key="cls.id"
                    :variant="cls.id === toyClassId ? 'solid' : 'soft'"
                    color="neutral"
                    size="xs"
                    @click="setToyShape(cls.id)"
                  >
                    <UIcon
                      :name="cls.icon"
                      class="size-3.5"
                    />
                    {{ pick(cls.name) }}
                  </UButton>
                </div>

                <div class="grid grid-cols-[88px_1fr] items-start gap-3">
                  <div>
                    <canvas
                      v-if="toyInput"
                      :ref="el => setCanvas('toy', el)"
                      class="aspect-square w-full rounded border border-default bg-black"
                    />
                    <p class="mt-1 text-center text-[10px] text-dimmed">
                      {{ pick({ zh: '输入形状', en: 'input' }) }}
                    </p>
                  </div>
                  <div data-testid="toy-bars">
                    <PredictionBars
                      :predictions="toyPredictions"
                      :top-class="toyPredictions[0]?.name"
                    />
                  </div>
                </div>

                <div class="mt-3 overflow-hidden rounded border border-default">
                  <table class="w-full text-xs">
                    <thead class="bg-elevated/50 text-dimmed">
                      <tr>
                        <th class="px-2 py-1.5 text-left font-medium">
                          {{ pick({ zh: '类别', en: 'Class' }) }}
                        </th>
                        <th class="px-2 py-1.5 text-right font-medium">
                          {{ pick({ zh: '余弦', en: 'Cosine' }) }}
                        </th>
                        <th class="px-2 py-1.5 text-right font-medium">
                          {{ pick({ zh: '得分', en: 'Score' }) }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="r in toyRanked"
                        :key="r.classId"
                        class="border-t border-default"
                        :class="r.classId === toyRanked[0]?.classId ? 'bg-primary/5' : ''"
                      >
                        <td class="px-2 py-1.5">
                          <UIcon
                            :name="r.icon"
                            class="mr-1 size-3.5 align-middle text-primary"
                          />
                          {{ pick(r.name) }}
                        </td>
                        <td class="px-2 py-1.5 text-right tabular-nums">
                          {{ r.similarity.toFixed(3) }}
                        </td>
                        <td class="px-2 py-1.5 text-right tabular-nums">
                          {{ Math.round(r.score * 100) }}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="mt-3 rounded border border-default p-3">
                  <div class="flex items-center justify-between gap-3">
                    <label class="text-xs font-medium text-highlighted">{{ pick({ zh: '温度（果断程度）', en: 'Temperature (decisiveness)' }) }}</label>
                    <span class="text-xs tabular-nums text-muted">{{ temperature.toFixed(2) }}</span>
                  </div>
                  <input
                    v-model.number="temperature"
                    type="range"
                    :min="TEMPERATURE_MIN"
                    :max="TEMPERATURE_MAX"
                    step="0.01"
                    class="mt-2 w-full accent-primary"
                  >
                  <p class="mt-2 text-[11px] text-dimmed">
                    {{ pick({
                      zh: '把「不像的程度」变成百分比用的是 softmax：温度小 → 第一名吃掉几乎所有概率；温度大 → 各家平分、显得犹豫。',
                      en: 'Turning “how unlike” into percentages uses softmax: a small temperature lets the top class swallow almost all probability; a large one spreads it out and looks hesitant.'
                    }) }}
                  </p>
                </div>
              </div>

              <!-- 真实模型：跑当前图 -->
              <div class="rounded-lg border border-default p-3">
                <p class="mb-2 flex items-center gap-2 text-xs font-medium text-highlighted">
                  <UIcon
                    name="i-lucide-sparkles"
                    class="size-4 text-primary"
                  />
                  {{ pick({ zh: '真实模型（EfficientNet-Lite0 · ImageNet）', en: 'Real model (EfficientNet-Lite0 · ImageNet)' }) }}
                </p>

                <div class="grid grid-cols-[88px_1fr] items-start gap-3">
                  <div>
                    <canvas
                      v-if="source"
                      :ref="el => setCanvas('src3', el)"
                      class="aspect-square w-full rounded border border-default bg-black"
                    />
                    <p class="mt-1 text-center text-[10px] text-dimmed">
                      {{ sourceLabel || pick({ zh: '当前图', en: 'current' }) }}
                    </p>
                  </div>
                  <div data-testid="real-model-bars">
                    <div
                      v-if="classifying"
                      class="flex items-center gap-2 text-sm text-muted"
                    >
                      <UIcon
                        name="i-lucide-loader-circle"
                        class="size-4 animate-spin"
                      />
                      <span>{{ t('demo.inferring') }}</span>
                    </div>
                    <PredictionBars
                      v-else-if="predictions.length"
                      :predictions="predictions"
                      :top-class="predictions[0]?.name"
                    />
                    <p
                      v-else
                      class="text-xs text-muted"
                    >
                      {{ pick({ zh: '点「跑一次」加载模型并分类（模型约 18MB，只加载一次）。', en: 'Hit “Run” to load the model and classify (about 18MB, loaded once).' }) }}
                    </p>
                  </div>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <UButton
                    data-testid="run-classify"
                    size="xs"
                    color="primary"
                    variant="soft"
                    :loading="classifying"
                    :disabled="!source"
                    @click="runClassify"
                  >
                    <UIcon
                      name="i-lucide-play"
                      class="size-3.5"
                    />
                    {{ pick({ zh: '跑一次', en: 'Run' }) }}
                  </UButton>
                  <UBadge
                    v-if="classifyMs !== null"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ t('image.elapsed') }} {{ classifyMs }} ms
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    EfficientNet-Lite0 · ImageNet 1000
                  </UBadge>
                </div>

                <UAlert
                  v-if="classifyError"
                  class="mt-3"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  :title="classifyError"
                />

                <p class="mt-3 text-[11px] text-dimmed">
                  {{ pick({
                    zh: '换成 dog / cat 或任意照片，结果会跟着变。这两种模型对同一张图给出的答案通常不同 —— 因为「特征」不一样，别指望它们一致。',
                    en: 'Swap in dog / cat or any photo and the result changes. The two models usually disagree on the same image — their features differ, so do not expect them to match.'
                  }) }}
                </p>
              </div>
            </div>
          </template>

          <!-- ===== 5 输出 ===== -->
          <template v-if="activeRow.id === 'output'">
            <div class="flex flex-col items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
              <p class="text-xs uppercase tracking-wide text-dimmed">
                {{ pick({ zh: '真实模型的判断', en: 'The real model says' }) }}
              </p>
              <p class="text-2xl font-semibold text-highlighted">
                {{ topPrediction?.name || '—' }}
              </p>
              <p class="text-sm text-muted">
                {{ pick({ zh: '置信度', en: 'Confidence' }) }} {{ Math.round((topPrediction?.score ?? 0) * 100) }}%
              </p>
              <UBadge
                v-if="topPrediction"
                :color="topMargin > 0.25 ? 'success' : topMargin > 0.1 ? 'warning' : 'error'"
                variant="subtle"
                size="sm"
              >
                {{ pick({
                  zh: topMargin > 0.25 ? '把握很大' : topMargin > 0.1 ? '比较有把握' : '不太确定',
                  en: topMargin > 0.25 ? 'Very sure' : topMargin > 0.1 ? 'Fairly sure' : 'Not so sure'
                }) }}
              </UBadge>
            </div>

            <p
              v-if="!topPrediction"
              class="mt-3 text-sm text-muted"
            >
              {{ pick({ zh: '还没有结果，先去第 4 步点「跑一次」。', en: 'No result yet — go to step 4 and hit “Run”.' }) }}
            </p>

            <p class="mt-4 text-sm text-muted">
              {{ pick({
                zh: '输出就是「分数最高的那个类别」。但分数高不等于一定对：图太模糊、太陌生，或几类本来就很像时，模型也可能自信地犯错。所以真实系统里，低分和「拿不准」都要被单独处理。',
                en: 'Output is simply “the class with the highest score”. But a high score is not always right: when an image is blurry, unfamiliar, or the classes are just similar, a model can be confidently wrong. That is why real systems treat low scores and “not sure” separately.'
              }) }}
            </p>

            <div class="mt-4">
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '用在哪里', en: 'Where it is used' }) }}
              </p>
              <div class="grid gap-2 sm:grid-cols-3">
                <div
                  v-for="item in useItems"
                  :key="item.icon"
                  class="flex items-center gap-2 rounded border border-default p-2 text-xs text-muted"
                >
                  <UIcon
                    :name="item.icon"
                    class="size-4 shrink-0 text-primary"
                  />
                  {{ pick(item.label) }}
                </div>
              </div>
            </div>

            <div class="mt-4">
              <p class="mb-2 text-sm font-medium text-highlighted">
                {{ pick({ zh: '想一想', en: 'Think about it' }) }}
              </p>
              <ul class="space-y-2">
                <li
                  v-for="item in thinkItems"
                  :key="item.icon"
                  class="flex gap-2 rounded border border-default p-2 text-xs text-muted"
                >
                  <UIcon
                    :name="item.icon"
                    class="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  {{ pick(item.text) }}
                </li>
              </ul>
            </div>
          </template>

          <!-- 底部：相关教学页 -->
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton
              v-for="link in [
                { to: '/vision/pipeline', label: { zh: '图像处理入门', en: 'Image Processing' } },
                { to: '/vision/feature-extraction', label: { zh: '特征提取入门', en: 'Feature Extraction' } },
                { to: '/vision/edge-detection', label: { zh: '边缘检测入门', en: 'Edge Detection' } }
              ]"
              :key="link.to"
              :to="link.to"
              variant="ghost"
              color="neutral"
              size="xs"
            >
              <UIcon
                name="i-lucide-arrow-left"
                class="size-3.5"
              />
              {{ pick(link.label) }}
            </UButton>
          </div>
        </UCard>
      </ToolSidebar>
    </div>
  </MediaDemoShell>
</template>
