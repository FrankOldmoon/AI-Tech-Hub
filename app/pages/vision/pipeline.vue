<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 图像处理流水线（教学页）：上传一张图，把它串进一条算子链，
 * **每一步的输入是上一步的输出**，因此可以一步步看清图像是怎么被改造的。
 *
 * 与「图像处理工坊」的区别：工坊里一个算子一张卡，都作用在原图上；
 * 这里是链式处理 —— 灰度 → 降噪 → 增强 → 细节强化（默认链），
 * 每一步的产物都留档，可以点回去看，也可以改参数、停用、换算子、调顺序。
 *
 * 数据模型与执行器在 ~/utils/image-pipeline（纯 ImageData 运算，Node 里可直接测），
 * 算子全部复用 ~/utils/image-tools 的注册表 —— 这里不新写任何图像算法。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { PipelinePreset, PipelineStage, PipelineStep } from '~/utils/image-pipeline'
import { humanError } from '~/utils/errors'
import { loadImageData } from '~/utils/image'
import {
  buildStep, buildStepsFromPreset, defaultPreset, pipelineCatalog,
  pipelinePresets, pipelineTool, runPipeline
} from '~/utils/image-pipeline'
import { buildParamSpecs, pickText } from '~/utils/localized'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'pipeline')!)

type L = { zh: string, en: string }
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: L) => (lang.value === 'zh' ? o.zh : o.en)

/** 处理尺寸上限：链上可能串十几个算子，原图直接跑会明显卡顿（工坊页也是同样的取舍） */
const MAX_EDGE = 1600

// ===== 状态 =====
/** 当前链。初始化放在 setup 里（纯函数），这样 SSR 就能渲染出步骤列表 */
const steps = ref<PipelineStep[]>(buildStepsFromPreset(defaultPreset, 'zh'))
const presetId = ref(defaultPreset.id)
const source = ref<ImageData | null>(null)
const sourceLabel = ref('')
const stages = ref<PipelineStage[]>([])
const selected = ref<'input' | 'result' | number>('result')
const running = ref(false)
const totalMs = ref(0)
const skipped = ref<string[]>([])
const errorMsg = ref('')
const downloadFormat = ref<'png' | 'jpeg' | 'webp'>('png')
const quality = ref(0.92)
const thumbs = ref<Record<string, string>>({})

const client = ref(false)
/** 已加载图片后是否仍展开上传区（否则只剩示例，没法换自己的图） */
const showInput = ref(false)
let rerunTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false

// ===== 算子目录（左侧）=====
const catalogItems = computed<ToolSidebarItem[]>(() => pipelineCatalog().flatMap(group => group.tools.map(tool => ({
  id: tool.id,
  label: pickText(tool.name, lang.value),
  kind: tool.kind === 'opencv' ? 'OpenCV' : 'Canvas',
  section: pickText(group.label, lang.value)
}))))
const activeCatalog = ref('grayscale')
const catalogCount = computed(() => catalogItems.value.length)

/** 算子目录点击 → 追加到链尾（ToolSidebar 的 id 可能是 string | number） */
function addStep(raw: string | number) {
  const toolId = String(raw)
  const step = buildStep(toolId, lang.value)
  if (!step) return
  steps.value = [...steps.value, step]
  selected.value = steps.value.length - 1
  activeCatalog.value = toolId
}

// ===== 参数与步骤操作 =====
const selectedIndex = computed(() => (typeof selected.value === 'number' ? selected.value : -1))
const selectedStep = computed(() => steps.value[selectedIndex.value] ?? null)
/** 该步的参数规范（按当前语言解析标签）；参数值仍是步骤自己那份 */
const selectedSpecs = computed(() => buildParamSpecsSafe(selectedStep.value))
function buildParamSpecsSafe(step: PipelineStep | null) {
  const tool = step ? pipelineTool(step.toolId) : undefined
  if (!tool) return []
  return buildParamSpecs(tool.params, lang.value)
}

function toolName(toolId: string): string {
  const tool = pipelineTool(toolId)
  return tool ? pickText(tool.name, lang.value) : toolId
}
function engineLabel(toolId: string): string {
  const tool = pipelineTool(toolId)
  return tool?.kind === 'opencv' ? 'OpenCV' : 'Canvas'
}

function patchStep(index: number, patch: Partial<PipelineStep>) {
  const next = steps.value.slice()
  const step = next[index]
  if (!step) return
  next[index] = { ...step, ...patch }
  steps.value = next
}
/** 事件处理器统一收 unknown 再自己收窄，避免和 Nuxt UI 的 emit 类型打架 */
function setStepEnabled(index: number, value: unknown) {
  patchStep(index, { enabled: Boolean(value) })
}
function setStepParams(index: number, value: unknown) {
  patchStep(index, { params: (value ?? {}) as Record<string, number | string | boolean> })
}
function moveStep(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= steps.value.length) return
  const next = steps.value.slice()
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  steps.value = next
  if (typeof selected.value === 'number') selected.value = target
}
function removeStep(index: number) {
  steps.value = steps.value.filter((_, i) => i !== index)
  if (typeof selected.value === 'number' && selected.value >= steps.value.length) selected.value = 'result'
}
function resetStepParams(index: number) {
  const step = steps.value[index]
  if (!step) return
  const fresh = buildStep(step.toolId, lang.value)
  if (fresh) patchStep(index, { params: fresh.params })
}

const activePreset = computed<PipelinePreset | undefined>(() => pipelinePresets.find(p => p.id === presetId.value))
function applyPreset(raw: unknown) {
  const id = String(raw)
  const preset = pipelinePresets.find(p => p.id === id)
  if (!preset) return
  presetId.value = id
  steps.value = buildStepsFromPreset(preset, lang.value)
  selected.value = 'result'
}

// ===== 执行 =====
function scheduleRun(delay = 140) {
  if (rerunTimer) clearTimeout(rerunTimer)
  rerunTimer = setTimeout(() => {
    void execute()
  }, delay)
}

async function execute() {
  const image = source.value
  if (!image || !client.value) return
  // 运行中又来了新改动：记一笔，跑完后再补一次（否则最后那次修改会被丢掉）
  if (running.value) {
    dirty = true
    return
  }
  running.value = true
  try {
    const run = await runPipeline(image, steps.value, lang.value)
    stages.value = run.stages
    totalMs.value = run.totalMs
    skipped.value = run.skipped
    thumbs.value = buildThumbs(run.stages)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = humanError(e, t)
  } finally {
    running.value = false
    if (dirty) {
      dirty = false
      void execute()
    }
  }
}

/** 每步产物的缩略图（dataURL）：挂在列表里当「这一步长什么样」的证据 */
function buildThumbs(list: PipelineStage[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const stage of list) out[stage.id] = makeThumb(stage.image)
  return out
}
function makeThumb(image: ImageData, maxW = 128): string {
  const scale = Math.min(1, maxW / image.width)
  const w = Math.max(1, Math.round(image.width * scale))
  const h = Math.max(1, Math.round(image.height * scale))
  const full = document.createElement('canvas')
  full.width = image.width
  full.height = image.height
  const fullCtx = full.getContext('2d')
  if (!fullCtx) return ''
  fullCtx.putImageData(image, 0, 0)
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const smallCtx = small.getContext('2d')
  if (!smallCtx) return ''
  smallCtx.drawImage(full, 0, 0, w, h)
  return small.toDataURL('image/jpeg', 0.72)
}

// ===== 流水线行（原图 / 各步 / 结果）=====
interface Row {
  key: string
  kind: 'input' | 'step' | 'result'
  title: string
  meta: string
  stageId: string
  stepIndex: number
  enabled: boolean
  image: ImageData | null
}

const rows = computed<Row[]>(() => {
  const list: Row[] = [{
    key: 'input',
    kind: 'input',
    title: t('image.original'),
    meta: source.value ? `${source.value.width}×${source.value.height}` : '',
    stageId: 'input',
    stepIndex: -1,
    enabled: true,
    image: source.value
  }]
  steps.value.forEach((step, index) => {
    const stage = stages.value.find(s => s.id === String(index))
    list.push({
      key: `step-${index}`,
      kind: 'step',
      title: `${index + 1}. ${toolName(step.toolId)}`,
      meta: step.enabled
        ? [
            engineLabel(step.toolId),
            stage?.ms !== undefined && stage?.ms !== null ? `${Math.round(stage.ms)} ms` : ''
          ].filter(Boolean).join(' · ')
        : pick({ zh: '已停用', en: 'Disabled' }),
      stageId: String(index),
      stepIndex: index,
      enabled: step.enabled,
      image: stage?.image ?? null
    })
  })
  const result = stages.value.find(s => s.id === 'result')
  list.push({
    key: 'result',
    kind: 'result',
    title: t('image.result'),
    meta: result ? `${result.image.width}×${result.image.height} · ${Math.round(totalMs.value)} ms` : '',
    stageId: 'result',
    stepIndex: -1,
    enabled: true,
    image: result?.image ?? null
  })
  return list
})

function rowSelected(row: Row): boolean {
  if (row.kind === 'input') return selected.value === 'input'
  if (row.kind === 'result') return selected.value === 'result'
  return selected.value === row.stepIndex
}
function selectRow(row: Row) {
  if (row.kind === 'input') selected.value = 'input'
  else if (row.kind === 'result') selected.value = 'result'
  else selected.value = row.stepIndex
}

// ===== 详情区 =====
/** 步骤前后的对照图（步骤 i 的输入 = 阶段序列里前一个产物） */
const beforeAfter = computed(() => {
  const index = selectedIndex.value
  if (index < 0) return null
  const after = stages.value.find(s => s.id === String(index)) ?? null
  const position = stages.value.findIndex(s => s.id === String(index))
  const before = position > 0 ? stages.value[position - 1] ?? null : stages.value[0] ?? null
  return { before, after }
})
const detailImage = computed<ImageData | null>(() => {
  if (selected.value === 'input') return source.value
  if (selected.value === 'result') return stages.value.find(s => s.id === 'result')?.image ?? null
  return beforeAfter.value?.after?.image ?? null
})

const origCanvas = ref<HTMLCanvasElement>()
const beforeCanvas = ref<HTMLCanvasElement>()
const afterCanvas = ref<HTMLCanvasElement>()
const resultCanvas = ref<HTMLCanvasElement>()

function drawTo(canvas: HTMLCanvasElement | undefined, image: ImageData | null | undefined) {
  if (!canvas || !image) return
  if (canvas.width !== image.width) canvas.width = image.width
  if (canvas.height !== image.height) canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.putImageData(image, 0, 0)
}

watch([detailImage, selected], () => {
  const image = detailImage.value
  if (selected.value === 'input') drawTo(origCanvas.value, image)
  else if (selected.value === 'result') drawTo(resultCanvas.value, image)
  else {
    drawTo(beforeCanvas.value, beforeAfter.value?.before?.image)
    drawTo(afterCanvas.value, beforeAfter.value?.after?.image)
  }
}, { flush: 'post' })

// ===== 输入 =====
const samples = computed(() => [
  { label: t('samples.noisy'), url: '/samples/images/noisy.jpg' },
  { label: t('samples.street'), url: '/samples/images/street.jpg' },
  { label: t('samples.face'), url: '/samples/images/portrait.jpg' }
])

async function loadSource(input: File | string, label: string) {
  try {
    errorMsg.value = ''
    source.value = await loadImageData(input, MAX_EDGE)
    sourceLabel.value = label
    selected.value = 'result'
    showInput.value = false
    // 执行交给 watch([steps, source]) 统一触发，避免这里再跑一遍（重复执行一遍整条链）
  } catch (e: any) {
    errorMsg.value = humanError(e, t)
  }
}
function onFile(file: File) {
  void loadSource(file, file.name)
}
function onSample(url: string, label: string) {
  void loadSource(url, label)
}

// ===== 下载 =====
function download() {
  const image = stages.value.find(s => s.id === 'result')?.image
  if (!image) return
  const fmt = downloadFormat.value
  const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png'
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // JPEG 不支持透明：不铺白底的话透明区会变黑
  if (fmt === 'jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.putImageData(image, 0, 0)
  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `pipeline-result.${fmt === 'jpeg' ? 'jpg' : fmt}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, mime, quality.value)
}

// ===== 生命周期 =====
watch([steps, source], () => scheduleRun(), { deep: true })
watch(lang, () => {
  // 语言切换只影响标签，不必重跑算法；但如果步骤是空的（极端情况）补一次默认链
  if (steps.value.length === 0) steps.value = buildStepsFromPreset(defaultPreset, lang.value)
})

onMounted(() => {
  client.value = true
  const preset = activePreset.value ?? defaultPreset
  steps.value = buildStepsFromPreset(preset, lang.value)
  // 开箱可玩：默认用「噪点照」，正好能看出降噪与增强的作用
  void onSample(samples.value[0]?.url ?? '', pick({ zh: '噪点示例', en: 'Noisy sample' }))
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <ToolSidebar
      v-model="activeCatalog"
      :title="pick({ zh: '算子目录', en: 'Operator catalog' })"
      title-icon="i-lucide-blend"
      :items="catalogItems"
      @update:model-value="addStep"
    >
      <div class="space-y-4">
        <!-- 输入 -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-image-plus"
                  class="size-4 text-primary"
                />
                <span>{{ pick({ zh: '输入图片', en: 'Input image' }) }}</span>
              </div>
              <div
                v-if="source"
                class="text-xs text-dimmed"
              >
                {{ sourceLabel }} · {{ source.width }}×{{ source.height }}
                <span v-if="Math.max(source.width, source.height) >= MAX_EDGE">{{ pick({ zh: `（已缩到最长边 ${MAX_EDGE}px）`, en: ` (scaled to ${MAX_EDGE}px)` }) }}</span>
              </div>
            </div>
          </template>
          <MediaInput
            v-if="!source || showInput"
            accept="image/*"
            :samples="samples"
            @select="onFile"
            @sample="(url: string) => onSample(url, samples.find(s => s.url === url)?.label ?? '')"
          />
          <div
            v-else
            class="flex flex-wrap items-center gap-3"
          >
            <img
              v-if="thumbs.input"
              :src="thumbs.input"
              :alt="t('image.original')"
              class="h-20 w-auto rounded border border-default object-contain"
            >
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="s in samples"
                :key="s.url"
                size="xs"
                color="neutral"
                variant="subtle"
                @click="onSample(s.url, s.label)"
              >
                {{ s.label }}
              </UButton>
              <UButton
                icon="i-lucide-upload"
                size="xs"
                color="primary"
                variant="subtle"
                @click="showInput = true"
              >
                {{ t('image.upload') }}
              </UButton>
            </div>
          </div>
        </UCard>

        <UAlert
          v-if="errorMsg"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="errorMsg"
        />

        <!-- 流水线 -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-git-branch"
                  class="size-4 text-primary"
                />
                <span>{{ pick({ zh: '处理流水线', en: 'Processing pipeline' }) }}</span>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ steps.length }} {{ pick({ zh: '步', en: 'steps' }) }}
                </UBadge>
              </div>
              <div class="flex items-center gap-2">
                <USelect
                  :model-value="presetId"
                  :items="pipelinePresets.map(p => ({ label: pickText(p.label, lang), value: p.id }))"
                  size="xs"
                  @update:model-value="applyPreset($event)"
                />
                <UBadge
                  v-if="running"
                  color="info"
                  variant="subtle"
                  size="xs"
                >
                  {{ t('image.processing') }}
                </UBadge>
                <UBadge
                  v-else-if="totalMs > 0"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ Math.round(totalMs) }} ms
                </UBadge>
              </div>
            </div>
          </template>

          <p class="text-xs text-muted mb-3">
            {{ pick({
              zh: '每一步的输入是上一步的输出。点任意一行查看它产出的图像；左侧算子目录里点一下就会追加到最后。',
              en: 'Each step takes the previous step’s output as its input. Click any row to inspect what it produced; clicking an operator in the left catalog appends it to the end.'
            }) }}
          </p>

          <ol class="space-y-2">
            <li
              v-for="row in rows"
              :key="row.key"
            >
              <div
                data-slot="pipeline-row"
                :data-step="row.kind === 'step' ? row.stepIndex : row.kind"
                :data-enabled="row.enabled"
                class="flex items-center gap-3 rounded-lg border p-2 transition cursor-pointer"
                :class="rowSelected(row) ? 'border-primary ring-1 ring-primary/40 bg-primary/5' : 'border-default hover:bg-elevated/60'"
                @click="selectRow(row)"
              >
                <span
                  class="w-6 shrink-0 text-center text-xs font-mono"
                  :class="row.kind === 'step' ? 'text-muted' : 'text-primary'"
                >
                  {{ row.kind === 'input' ? '·' : row.kind === 'result' ? '=' : row.stepIndex + 1 }}
                </span>

                <img
                  v-if="thumbs[row.stageId]"
                  :src="thumbs[row.stageId]"
                  :alt="row.title"
                  class="h-10 w-auto rounded border border-default object-contain"
                  :class="row.enabled ? '' : 'opacity-40'"
                >
                <div
                  v-else
                  class="h-10 w-14 rounded border border-default bg-elevated/60"
                />

                <div class="min-w-0 flex-1">
                  <p class="text-sm truncate text-highlighted">
                    {{ row.title }}
                  </p>
                  <p class="text-[11px] text-dimmed truncate">
                    {{ row.meta }}
                  </p>
                </div>

                <div
                  v-if="row.kind === 'step'"
                  class="flex items-center gap-1 shrink-0"
                  @click.stop
                >
                  <USwitch
                    :model-value="row.enabled"
                    size="xs"
                    @update:model-value="setStepEnabled(row.stepIndex, $event)"
                  />
                  <UButton
                    icon="i-lucide-arrow-up"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="row.stepIndex === 0"
                    @click="moveStep(row.stepIndex, -1)"
                  />
                  <UButton
                    icon="i-lucide-arrow-down"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="row.stepIndex === steps.length - 1"
                    @click="moveStep(row.stepIndex, 1)"
                  />
                  <UButton
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="removeStep(row.stepIndex)"
                  />
                </div>
              </div>
            </li>
          </ol>

          <p
            v-if="skipped.length"
            class="mt-3 text-xs text-warning"
          >
            {{ pick({ zh: '跳过的步骤：', en: 'Skipped steps: ' }) }}{{ skipped.join(', ') }}
          </p>
        </UCard>

        <!-- 详情 -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  name="i-lucide-scan-eye"
                  class="size-4 text-primary"
                />
                <span v-if="selected === 'input'">{{ t('image.original') }}</span>
                <span v-else-if="selected === 'result'">{{ t('image.result') }}</span>
                <span v-else>
                  {{ selectedIndex + 1 }} · {{ selectedStep ? toolName(selectedStep.toolId) : '' }}
                </span>
                <UBadge
                  v-if="selectedStep"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ engineLabel(selectedStep.toolId) }}
                </UBadge>
              </div>
              <div
                v-if="selectedStep"
                class="flex items-center gap-2"
              >
                <UButton
                  icon="i-lucide-rotate-ccw"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  @click="resetStepParams(selectedIndex)"
                >
                  {{ pick({ zh: '恢复默认参数', en: 'Reset params' }) }}
                </UButton>
              </div>
            </div>
          </template>

          <!-- 原图 -->
          <div v-if="selected === 'input'">
            <canvas
              v-if="source"
              ref="origCanvas"
              data-slot="stage-input"
              class="max-w-full rounded border border-default"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ pick({ zh: '先在上面选一张图。', en: 'Pick an image above first.' }) }}
            </p>
          </div>

          <!-- 某一步：参数 + 前后对照 -->
          <div
            v-else-if="selectedStep"
            class="space-y-4"
          >
            <DemoParams
              v-if="selectedSpecs.length"
              :model-value="selectedStep.params"
              :specs="selectedSpecs"
              :running="running"
              :title="pick({ zh: '本步参数', en: 'Step parameters' })"
              @update:model-value="setStepParams(selectedIndex, $event)"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ pick({ zh: '这一步没有可调参数。', en: 'This step has no parameters.' }) }}
            </p>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <p class="text-xs text-muted mb-1">
                  {{ pick({ zh: '上一步的输出（本步的输入）', en: 'Previous output (this step’s input)' }) }}
                </p>
                <canvas
                  ref="beforeCanvas"
                  data-slot="stage-before"
                  class="w-full rounded border border-default"
                />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">
                  {{ pick({ zh: '本步的输出', en: 'This step’s output' }) }}
                </p>
                <canvas
                  ref="afterCanvas"
                  data-slot="stage-after"
                  class="w-full rounded border border-default"
                />
              </div>
            </div>
          </div>

          <!-- 结果 + 下载 -->
          <div
            v-else
            class="space-y-4"
          >
            <canvas
              v-if="detailImage"
              ref="resultCanvas"
              data-slot="stage-result"
              class="max-w-full rounded border border-default"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ pick({ zh: '还没有结果 —— 先选一张图。', en: 'No result yet — pick an image first.' }) }}
            </p>

            <div
              v-if="detailImage"
              class="flex flex-wrap items-end gap-3"
            >
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
                @click="download"
              >
                {{ t('image.download') }}
              </UButton>
              <p class="text-xs text-dimmed">
                {{ detailImage.width }}×{{ detailImage.height }} · {{ steps.filter(s => s.enabled).length }}
                {{ pick({ zh: '步生效', en: 'steps active' }) }}
              </p>
            </div>
          </div>
        </UCard>

        <!-- 教学说明 -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                name="i-lucide-lightbulb"
                class="size-4 text-primary"
              />
              <span>{{ pick({ zh: '为什么这样串', en: 'Why this order' }) }}</span>
            </div>
          </template>
          <div class="space-y-3 text-sm text-muted">
            <p v-if="activePreset">
              <span class="text-highlighted font-medium">{{ pickText(activePreset.label, lang) }}</span> —— {{ pickText(activePreset.hint, lang) }}
            </p>
            <ul class="space-y-2">
              <li>
                <span class="text-highlighted">{{ pick({ zh: '① 先降维再处理', en: '① Reduce first' }) }}</span> ——
                {{ pick({ zh: '灰度化把 3 个通道压成 1 个，后面的运算量直接降到三分之一，也让「只关心形状」的任务不再受颜色干扰。', en: 'Grayscale collapses three channels into one, cutting the work to a third and removing color distractions when only shape matters.' }) }}
              </li>
              <li>
                <span class="text-highlighted">{{ pick({ zh: '② 先降噪再增强', en: '② Denoise before enhancing' }) }}</span> ——
                {{ pick({ zh: '顺序反了会把噪点一起放大：增强和锐化都是放大局部差异的算子，噪声先被放大就再也去不掉了。', en: 'Reverse the order and you amplify noise: enhancement and sharpening both boost local differences, and once noise is boosted it can never be removed.' }) }}
              </li>
              <li>
                <span class="text-highlighted">{{ pick({ zh: '③ 特征强化放最后', en: '③ Feature emphasis last' }) }}</span> ——
                {{ pick({ zh: '边缘/锐化是「提纯」步骤，应该在图像已经干净之后再提取结构，否则提取到的多半是噪声的轮廓。', en: 'Edges and sharpening are refinement steps; run them on an already-clean image, otherwise you mostly outline the noise.' }) }}
              </li>
            </ul>
            <p class="text-xs text-dimmed">
              {{ pick({
                zh: `一句话：流水线里每一步的输入都是上一步的输出，所以「顺序」本身就是算法的一部分 —— 这也正是把 ${catalogCount} 个算子串起来演示的意义。`,
                en: `In short: every step consumes the previous step’s output, so the order itself is part of the algorithm — which is exactly why chaining the ${catalogCount} operators is worth demonstrating.`
              }) }}
            </p>
          </div>
        </UCard>
      </div>
    </ToolSidebar>
  </MediaDemoShell>
</template>
