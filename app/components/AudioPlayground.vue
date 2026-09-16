<script setup lang="ts">
/**
 * 语音 playground：能力页 / 引擎页的通用工作台。
 *
 * 与 ImagePlayground 的分工一致：左侧「工具/任务」栏（共享 ToolSidebar）+ 输入区 + 参数 + 结果。
 * 页面归属完全由注册表（utils/audio-tools）决定，本组件不认识任何具体模型。
 *
 * 与 ImagePlayground 的关键差异（因为语音输入有三种互不兼容的模态）：
 * - 输入区按 activeTool.inputs 渲染：file（上传/示例）、text（文本框）、live（麦克风）
 * - live 又分两路：frames（playground 开麦喂帧）与 session（工具自管会话，如 Web Speech）
 * - 结果可能是文本（转写）、音频（合成）、分段（带时间戳）或纯信息行，故结果区是「多通道」的
 *
 * 耗时与后端标注沿用视觉侧 P0.1 的结论：同一任务多实现对比时，不标后端就会把
 * 「后端差距」误读成「模型差距」。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { LocalizedDemo } from '~/utils/demos'
import type { AudioTool, AudioInputKind, AudioToolResult } from '~/utils/audio-tools'
import { audioKindLabels } from '~/utils/audio-tools'
import { buildParamSpecs } from '~/utils/localized'
import type { LocalizedParamSpec } from '~/utils/localized'
import { paramDefaults } from '~/utils/params'
import { humanError, mediaError } from '~/utils/errors'
import { downloadBlob, formatClock } from '~/utils/wav'

const props = defineProps<{
  demo: LocalizedDemo
  tools: AudioTool[]
  /** 该页专属示例音频（未配置则退回通用列表） */
  samples?: { label: string, url: string }[] | null
}>()

const { t, locale } = useI18n()
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))

// ===== 工具切换 =====
const activeToolId = ref(props.tools[0]?.id ?? '')
const activeTool = computed<AudioTool | undefined>(() => props.tools.find(x => x.id === activeToolId.value))

/** 接口来源的参数（如 Edge TTS 的音色列表）：拿到后覆盖静态 params */
const dynamicSpecs = ref<LocalizedParamSpec[] | null>(null)
const specs = computed(() => buildParamSpecs(dynamicSpecs.value ?? activeTool.value?.params, lang.value))
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

/** 侧栏：分组按当前页 slug 解析——能力页显示引擎名，引擎页显示任务族 */
function sectionFor(tool: AudioTool): string | undefined {
  const key = tool.section?.[props.demo.slug ?? ''] ?? tool.section?.['*']
  return key ? t(key) : undefined
}

const toolItems = computed<ToolSidebarItem[]>(() => props.tools.map(tool => ({
  id: tool.id,
  label: lang.value === 'zh' ? tool.name.zh : tool.name.en,
  kind: audioKindLabels[tool.kind],
  section: sectionFor(tool)
})))

/** 输入模态：默认取工具声明的第一个 */
const inputKind = ref<AudioInputKind>(props.tools[0]?.inputs[0] ?? 'file')
const hasInputChoice = computed(() => (activeTool.value?.inputs.length ?? 0) > 1)

const inputItems = computed(() => {
  const kinds = activeTool.value?.inputs ?? []
  return kinds.map(k => ({
    key: k,
    label: t(`speech.playground.input.${k}`),
    icon: k === 'file' ? 'i-lucide-file-audio' : (k === 'text' ? 'i-lucide-type' : 'i-lucide-mic')
  }))
})

/**
 * 切换工具：重置输入与参数，并为「选项来自接口」的工具补一次异步参数。
 * 注意不能写成 `watch(..., { immediate: true })`：那会在 setup 阶段同步执行，
 * 而 resetRun() 引用的 result / liveHistory 等 ref 尚未初始化（TDZ）。
 */
async function activateTool() {
  dynamicSpecs.value = null
  inputKind.value = activeTool.value?.inputs[0] ?? 'file'
  params.value = paramDefaults(specs.value)
  resetRun()
  const tool = activeTool.value
  if (!tool?.asyncParams) return
  try {
    const next = await tool.asyncParams({ lang: lang.value })
    // 请求期间用户可能已切走：只在仍是同一工具时应用
    if (activeTool.value?.id !== tool.id) return
    dynamicSpecs.value = next
    params.value = paramDefaults(specs.value)
  } catch {
    /* 拿不到就继续用静态兜底参数，不打断使用 */
  }
}

watch(activeToolId, activateTool)
onMounted(activateTool)

// ===== 输入源（上传 / 示例）=====
const fallbackSamples = computed(() => props.samples
  ?? [
    { label: t('samples.speech'), url: '/samples/audio/speech.wav' },
    { label: t('samples.noisySpeech'), url: '/samples/audio/noisy-speech.wav' }
  ])

const source = useAudioSource({ defaultSampleUrl: fallbackSamples.value[0]?.url })

const textInput = ref('')

// ===== 运行状态 =====
const running = ref(false)
const liveRunning = ref(false)
const error = ref<string | null>(null)
const result = ref<AudioToolResult | null>(null)
const lastRunMs = ref<number | null>(null)
const liveHistory = ref<{ at: string, info: { label: string, value: string }[] }[]>([])

// 模型下载进度（transformers.js / mediapipe / kokoro 都通过 onProgress 回吐）
const progressPercent = ref(0)
const progressText = ref('')

const liveMode = computed(() => activeTool.value?.live?.mode ?? 'frames')
const liveSupported = computed(() => {
  const spec = activeTool.value?.live
  if (!spec) return false
  if (spec.mode === 'session') return spec.session?.supported() ?? false
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
})

/** 工具上下文：run 与 live 共用同一份参数快照 */
function context(): Parameters<AudioTool['run']>[0] {
  return {
    text: textInput.value,
    params: params.value,
    lang: lang.value,
    onProgress: (p) => {
      progressPercent.value = p.percent
      progressText.value = p.done ? t('speech.playground.ready') : [p.status, p.file].filter(Boolean).join(' · ')
    },
    isCancelled: () => !running.value && !liveRunning.value
  }
}

function resetRun() {
  result.value = null
  error.value = null
  lastRunMs.value = null
  progressPercent.value = 0
  progressText.value = ''
  liveHistory.value = []
}

function applyLive(r: AudioToolResult | null | undefined) {
  if (!r) return
  if (liveMode.value === 'frames') {
    // frames 模式每秒可能回吐多帧，只留最近若干条，避免结果区被刷屏
    if (r.info?.length) {
      liveHistory.value.unshift({ at: new Date().toLocaleTimeString(), info: r.info })
      if (liveHistory.value.length > 12) liveHistory.value.pop()
    }
  }
  result.value = r
}

async function runFile() {
  const tool = activeTool.value
  if (!tool) return
  if (tool.inputs.includes('file') && !source.file.value) {
    error.value = t('speech.noFile')
    return
  }
  error.value = null
  running.value = true
  progressPercent.value = 0
  const t0 = performance.now()
  try {
    const ctx = context()
    if (tool.inputs.includes('file')) ctx.samples = await source.toSamples16k()
    if (tool.inputs.includes('file')) ctx.file = source.file.value
    const res = await tool.run(ctx)
    lastRunMs.value = Math.round(performance.now() - t0)
    // 取消时工具返回空对象：保留上一次结果，不把「取消」渲染成「没结果」
    if (Object.keys(res).length > 0) result.value = res
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
    progressPercent.value = 0
  }
}

async function runText() {
  const tool = activeTool.value
  if (!tool) return
  if (!textInput.value.trim()) {
    error.value = t('speech.playground.noText')
    return
  }
  error.value = null
  running.value = true
  progressPercent.value = 0
  const t0 = performance.now()
  try {
    const res = await tool.run(context())
    lastRunMs.value = Math.round(performance.now() - t0)
    if (Object.keys(res).length > 0) result.value = res
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
    progressPercent.value = 0
  }
}

// ===== 实时（麦克风）=====
const mic = useMicStream()

function micError(e: unknown) {
  error.value = mediaError(e, t)
}

async function startLive() {
  const tool = activeTool.value
  const spec = tool?.live
  if (!tool || !spec) return
  error.value = null
  progressPercent.value = 0
  try {
    await spec.prepare?.(context())
    if (spec.mode === 'session') {
      if (!spec.session) return
      liveRunning.value = true
      await spec.session.start(context(), applyLive, () => {
        // continuous=false 时浏览器自行结束，必须在这里复位，否则会一直显示「聆听中」
        liveRunning.value = false
      })
      return
    }
    liveRunning.value = true
    await mic.start({
      onFrame: frame => applyLive(spec.frame?.(frame, context())),
      onError: micError
    })
  } catch (e) {
    error.value = humanError(e, t)
    liveRunning.value = false
  }
}

function stopLive() {
  const spec = activeTool.value?.live
  if (spec?.mode === 'session') spec.session?.stop()
  else mic.stop()
  liveRunning.value = false
  progressPercent.value = 0
}

onBeforeUnmount(() => {
  stopLive()
  activeTool.value?.live?.dispose?.()
})

// ===== 结果区的多通道渲染 =====
const resultText = computed(() => result.value?.text ?? '')

/** 合成音频的播放地址：blob 变化时回收上一个，避免连续合成把 blob 堆在内存里 */
const resultAudioUrl = ref('')

watch(() => result.value?.audio?.blob, (blob) => {
  if (resultAudioUrl.value) {
    URL.revokeObjectURL(resultAudioUrl.value)
    resultAudioUrl.value = ''
  }
  if (blob) resultAudioUrl.value = URL.createObjectURL(blob)
})

onBeforeUnmount(() => {
  if (resultAudioUrl.value) URL.revokeObjectURL(resultAudioUrl.value)
})

function downloadResultAudio() {
  const audio = result.value?.audio
  if (!audio) return
  downloadBlob(audio.blob, audio.filename)
}

const runMetaText = computed(() => {
  const parts: string[] = []
  if (lastRunMs.value !== null && !liveRunning.value) parts.push(`${t('speech.playground.elapsed')} ${lastRunMs.value} ms`)
  if (result.value?.device) parts.push(`${t('speech.playground.backend')} ${result.value.device}`)
  return parts.join(' · ')
})

/** 转写时间戳 → SRT（HH:MM:SS,mmm） */
function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec - Math.floor(sec)) * 1000)
  const pad = (v: number, n: number) => String(v).padStart(n, '0')
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

function downloadText(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function downloadSrt() {
  const segs = result.value?.segments ?? []
  downloadText(
    segs.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'),
    'transcript.srt',
    'text/plain;charset=utf-8'
  )
}

const copied = ref(false)

async function copyText() {
  try {
    await navigator.clipboard.writeText(resultText.value)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    /* 非 https / 无权限时静默失败，用户仍可手动选中复制 */
  }
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="space-y-6">
      <!-- 页面标题（与 ImagePlayground 同构：playground 自带页头，页面文件只做分发） -->
      <div class="flex items-start gap-4">
        <div class="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UIcon
            :name="demo.icon"
            class="size-6"
          />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ demo.title }}
            </h1>
            <DemoStatusBadge :status="demo.status" />
          </div>
          <p class="mt-1 text-muted">
            {{ demo.description }}
          </p>
        </div>
      </div>

      <!-- 工作原理（教学向） -->
      <HowItWorksSection :text="demo.howItWorks" />

      <ToolSidebar
        v-model="activeToolId"
        :items="toolItems"
        :title="t('speech.playground.toolbox')"
        title-icon="i-lucide-audio-lines"
      >
        <p
          v-if="activeTool?.description"
          class="text-sm text-muted"
        >
          {{ lang === 'zh' ? activeTool.description.zh : activeTool.description.en }}
        </p>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                name="i-lucide-keyboard"
                class="size-4"
              />
              {{ t('demo.input') }}
              <UBadge
                v-if="activeTool"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ audioKindLabels[activeTool.kind] }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <!-- 输入模态切换（工具支持多种输入时才出现） -->
            <div
              v-if="hasInputChoice"
              class="flex flex-wrap items-center gap-2"
            >
              <button
                v-for="item in inputItems"
                :key="item.key"
                type="button"
                class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer disabled:opacity-50"
                :class="inputKind === item.key
                  ? 'bg-primary border-primary text-white'
                  : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
                :disabled="running || liveRunning"
                @click="inputKind = item.key"
              >
                <UIcon
                  :name="item.icon"
                  class="size-4"
                />
                {{ item.label }}
              </button>
            </div>

            <!-- 文件输入 -->
            <template v-if="inputKind === 'file'">
              <input
                :ref="source.inputRef"
                type="file"
                :accept="source.accept"
                class="hidden"
                @change="source.onFileChange"
              >
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  icon="i-lucide-upload"
                  :label="source.file.value ? source.file.value.name : t('speech.uploadAudio')"
                  variant="outline"
                  :disabled="running || liveRunning"
                  @click="source.pick()"
                />
                <UButton
                  v-for="s in fallbackSamples"
                  :key="s.url"
                  icon="i-lucide-flask-conical"
                  :label="s.label"
                  variant="soft"
                  size="sm"
                  :disabled="running || liveRunning"
                  @click="source.useSample(s.url)"
                />
              </div>
              <audio
                v-if="source.url.value"
                :src="source.url.value"
                controls
                class="w-full"
              />
              <p
                v-if="source.seconds.value"
                class="text-xs text-dimmed"
              >
                {{ t('speech.playground.duration') }}: {{ formatClock(source.seconds.value) }}
              </p>
            </template>

            <!-- 文本输入 -->
            <template v-else-if="inputKind === 'text'">
              <UTextarea
                v-model="textInput"
                :rows="4"
                class="w-full"
                :placeholder="t('speech.playground.textPlaceholder')"
                :disabled="running"
              />
            </template>

            <!-- 实时输入 -->
            <template v-else>
              <p class="text-sm text-muted">
                {{ t('speech.playground.liveHint') }}
              </p>
              <p
                v-if="!liveSupported"
                class="text-sm text-warning"
              >
                {{ t('speech.unsupported') }}
              </p>
            </template>

            <!-- 参数面板（无参数的工具不渲染空面板） -->
            <DemoParams
              v-if="specs.length"
              v-model="params"
              :specs="specs"
              :running="running || liveRunning"
            />
          </div>

          <template #footer>
            <div class="flex flex-wrap items-center gap-2">
              <template v-if="inputKind === 'live'">
                <UButton
                  v-if="!liveRunning"
                  icon="i-lucide-mic"
                  :label="t('speech.start')"
                  color="primary"
                  :disabled="!liveSupported || running"
                  @click="startLive"
                />
                <UButton
                  v-else
                  icon="i-lucide-square"
                  :label="t('speech.stop')"
                  color="error"
                  @click="stopLive"
                />
                <span
                  v-if="liveRunning"
                  class="text-sm text-muted"
                >
                  {{ t('speech.listening') }}
                </span>
              </template>
              <template v-else>
                <UButton
                  icon="i-lucide-play"
                  :label="t('speech.playground.run')"
                  color="primary"
                  :loading="running"
                  :disabled="running || liveRunning"
                  @click="inputKind === 'text' ? runText() : runFile()"
                />
              </template>
              <UButton
                v-if="result || error"
                icon="i-lucide-rotate-ccw"
                :label="t('demo.reset')"
                variant="soft"
                color="neutral"
                :disabled="running || liveRunning"
                @click="resetRun"
              />
              <span
                v-if="runMetaText"
                class="text-xs text-dimmed"
              >{{ runMetaText }}</span>
            </div>
          </template>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon
                name="i-lucide-terminal"
                class="size-4"
              />
              {{ t('demo.result') }}
              <UIcon
                v-if="running"
                name="i-lucide-loader-circle"
                class="size-4 animate-spin ms-1"
              />
            </div>
          </template>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="error"
          />

          <template v-else>
            <!-- 模型下载进度 -->
            <div
              v-if="running && progressPercent > 0"
              class="mb-4 space-y-1"
            >
              <UProgress
                :model-value="progressPercent"
                size="sm"
              />
              <p class="text-xs text-dimmed">
                {{ t('speech.playground.loading') }} {{ progressPercent }}% · {{ progressText }}
              </p>
            </div>

            <!-- 音频结果 -->
            <div
              v-if="result?.audio"
              class="mb-4 flex flex-wrap items-center gap-2"
            >
              <audio
                :src="resultAudioUrl"
                controls
                class="w-full"
              />
              <UButton
                icon="i-lucide-download"
                :label="t('speech.playground.download')"
                variant="soft"
                size="sm"
                @click="downloadResultAudio"
              />
            </div>

            <!-- 文本结果（转写 / 翻译） -->
            <div
              v-if="resultText"
              class="mb-4 space-y-2"
            >
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-highlighted">
                  {{ t('speech.playground.transcript') }}
                </p>
                <UButton
                  icon="i-lucide-copy"
                  :label="copied ? t('speech.playground.copied') : t('speech.playground.copy')"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="copyText"
                />
                <UButton
                  icon="i-lucide-download"
                  label="TXT"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="downloadText(resultText, 'transcript.txt', 'text/plain;charset=utf-8')"
                />
                <UButton
                  v-if="result?.segments?.length"
                  icon="i-lucide-download"
                  label="SRT"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="downloadSrt"
                />
              </div>
              <p class="whitespace-pre-wrap rounded-lg border border-default p-3 text-sm">
                {{ resultText }}
              </p>
            </div>

            <!-- 分段（带时间戳） -->
            <div
              v-if="result?.segments?.length"
              class="mb-4 max-h-64 overflow-auto rounded-lg border border-default"
            >
              <table class="w-full text-xs">
                <tbody>
                  <tr
                    v-for="(seg, i) in result.segments"
                    :key="i"
                    class="border-t border-default first:border-t-0"
                  >
                    <td class="w-24 px-3 py-1.5 tabular-nums text-dimmed">
                      {{ seg.start.toFixed(1) }}s
                    </td>
                    <td class="px-3 py-1.5">
                      {{ seg.text }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 信息行 -->
            <dl
              v-if="result?.info?.length"
              class="space-y-1.5"
            >
              <div
                v-for="(row, i) in result.info"
                :key="`${row.label}-${i}`"
                class="flex items-baseline gap-3 text-sm"
              >
                <dt class="w-32 shrink-0 truncate text-muted">
                  {{ row.label }}
                </dt>
                <dd class="min-w-0 break-words tabular-nums text-highlighted">
                  {{ row.value }}
                </dd>
              </div>
            </dl>

            <!-- 实时历史（frames 模式逐帧回吐，只留最近若干条） -->
            <div
              v-if="liveHistory.length"
              class="mt-4 space-y-1 border-t border-default pt-3"
            >
              <p class="text-xs font-medium text-muted">
                {{ t('speech.playground.history') }}
              </p>
              <div
                v-for="(h, i) in liveHistory"
                :key="i"
                class="flex items-baseline gap-3 text-xs"
              >
                <span class="w-20 shrink-0 tabular-nums text-dimmed">{{ h.at }}</span>
                <span class="min-w-0 truncate text-muted">{{ h.info.map(x => x.value).join(' · ') }}</span>
              </div>
            </div>

            <p
              v-if="!result && !error"
              class="text-sm text-muted"
            >
              {{ t('speech.playground.noResult') }}
            </p>
          </template>
        </UCard>
      </ToolSidebar>
    </div>
  </UContainer>
</template>
