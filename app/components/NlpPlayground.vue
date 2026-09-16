<script setup lang="ts">
/**
 * NLP playground：能力页 / 引擎页的通用工作台。
 *
 * 与 ImagePlayground / AudioPlayground 同构：左侧「工具/任务」栏（共享 ToolSidebar）+ 输入区 + 参数 + 结果。
 * 页面归属完全由注册表（utils/nlp-tools 的 NlpTool.pages）决定，本组件不认识任何具体模型。
 *
 * 与语音/视觉的差异：
 * - 输入是**多输入框文本**（text-embedder 要两个），所以按 tool.inputs 动态渲染，
 *   而不是像视觉那样固定一个图像槽位。
 * - 结果有四个通道（headline / items / text / info），因为 NLP 任务的输出形态差别很大：
 *   余弦相似度是一个数、分类是一组带分数的标签、摘要是段文本。
 * - 所有任务的输入都是纯文本、都是「点一下跑一次」，没有实时流，所以不需要 AudioPlayground
 *   那套 file/live/session 的模态切换。
 */
import type { ToolSidebarItem } from '~/components/ToolSidebar.vue'
import type { LocalizedDemo } from '~/utils/demos'
import type { NlpTool, NlpToolResult } from '~/utils/nlp-tools'
import { nlpKindLabels } from '~/utils/nlp-tools'
import { buildParamSpecs } from '~/utils/localized'
import { paramDefaults } from '~/utils/params'
import { humanError } from '~/utils/errors'

const props = defineProps<{
  demo: LocalizedDemo
  tools: NlpTool[]
}>()

const { t, locale } = useI18n()
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))

// ===== 工具切换 =====
const activeToolId = ref(props.tools[0]?.id ?? '')
const activeTool = computed<NlpTool | undefined>(() => props.tools.find(x => x.id === activeToolId.value))

const specs = computed(() => buildParamSpecs(activeTool.value?.params, lang.value))
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

/** 侧栏：分组按当前页 slug 解析 —— 能力页显示引擎名，引擎页显示任务族 */
function sectionFor(tool: NlpTool): string | undefined {
  const key = tool.section?.[props.demo.slug ?? ''] ?? tool.section?.['*']
  return key ? t(key) : undefined
}

const toolItems = computed<ToolSidebarItem[]>(() => props.tools.map(tool => ({
  id: tool.id,
  label: lang.value === 'zh' ? tool.name.zh : tool.name.en,
  kind: nlpKindLabels[tool.engine],
  section: sectionFor(tool)
})))

// ===== 输入框（按 tool.inputs 动态渲染）=====
const values = ref<Record<string, string>>({})

function initValues() {
  const next: Record<string, string> = {}
  for (const input of activeTool.value?.inputs ?? []) next[input.key] = input.default ?? ''
  values.value = next
}

function activateTool() {
  initValues()
  params.value = paramDefaults(specs.value)
  resetRun()
}

// 不写成 `watch(..., { immediate: true })`：那会在 setup 阶段同步执行，
// 而 resetRun() 引用的 result 等 ref 尚未初始化（TDZ）
watch(activeToolId, activateTool)
onMounted(activateTool)

// ===== 运行状态 =====
const running = ref(false)
const error = ref<string | null>(null)
const result = ref<NlpToolResult | null>(null)
const lastRunMs = ref<number | null>(null)
const progressPercent = ref(0)
const progressText = ref('')

function resetRun() {
  result.value = null
  error.value = null
  lastRunMs.value = null
  progressPercent.value = 0
  progressText.value = ''
}

/** 示例按钮：按 examples.values 填充对应输入框 */
function applyExample(example: { values: Record<string, string> }) {
  for (const [key, text] of Object.entries(example.values)) values.value[key] = text
  resetRun()
}

const hasEmptyInput = computed(() =>
  (activeTool.value?.inputs ?? []).some(i => !(values.value[i.key] ?? '').trim())
)

async function run() {
  const tool = activeTool.value
  if (!tool) return
  if (hasEmptyInput.value) {
    error.value = t('tf.inputRequired')
    return
  }
  error.value = null
  running.value = true
  progressPercent.value = 0
  const t0 = performance.now()
  try {
    const res = await tool.run({
      lang: lang.value,
      values: { ...values.value },
      params: params.value,
      onProgress: (p) => {
        progressPercent.value = p.percent
        progressText.value = p.done ? t('nlp.playground.ready') : [p.status, p.file].filter(Boolean).join(' · ')
      },
      isCancelled: () => !running.value
    })
    lastRunMs.value = Math.round(performance.now() - t0)
    // 工具在输入为空时会返回空对象：保留上一次结果，不把「没跑」渲染成「没结果」
    if (Object.keys(res).length > 0) result.value = res
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
    progressPercent.value = 0
  }
}

const runMetaText = computed(() => {
  const parts: string[] = []
  if (lastRunMs.value !== null) parts.push(`${t('nlp.playground.elapsed')} ${lastRunMs.value} ms`)
  return parts.join(' · ')
})
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="space-y-6">
      <!-- 页面标题（与 ImagePlayground / AudioPlayground 同构：playground 自带页头） -->
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

      <HowItWorksSection :text="demo.howItWorks" />

      <ToolSidebar
        v-model="activeToolId"
        :items="toolItems"
        :title="t('nlp.playground.toolbox')"
        title-icon="i-lucide-languages"
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
                name="i-lucide-type"
                class="size-4"
              />
              {{ t('demo.input') }}
              <UBadge
                v-if="activeTool"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ nlpKindLabels[activeTool.engine] }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <!-- 输入框：按 tool.inputs 渲染（text-embedder 有两个） -->
            <div
              v-for="input in activeTool?.inputs ?? []"
              :key="input.key"
              class="space-y-1.5"
            >
              <label
                :for="`nlp-input-${input.key}`"
                class="block text-sm font-medium text-muted"
              >
                {{ t(input.labelKey) }}
              </label>
              <UTextarea
                v-if="input.type === 'textarea'"
                :id="`nlp-input-${input.key}`"
                v-model="values[input.key]"
                :rows="3"
                class="w-full"
                :placeholder="input.placeholderKey ? t(input.placeholderKey) : undefined"
                :disabled="running"
              />
              <UInput
                v-else
                :id="`nlp-input-${input.key}`"
                v-model="values[input.key]"
                class="w-full"
                :placeholder="input.placeholderKey ? t(input.placeholderKey) : undefined"
                :disabled="running"
              />
            </div>

            <!-- 预置示例 -->
            <div
              v-if="activeTool?.examples?.length"
              class="flex flex-wrap items-center gap-2"
            >
              <span class="text-xs text-dimmed">{{ t('nlp.tryExample') }}</span>
              <UButton
                v-for="example in activeTool.examples"
                :key="example.labelKey"
                :label="t(example.labelKey)"
                variant="soft"
                size="xs"
                :disabled="running"
                @click="applyExample(example)"
              />
            </div>

            <!-- 参数面板（无参数的工具不渲染空面板） -->
            <DemoParams
              v-if="specs.length"
              v-model="params"
              :specs="specs"
              :running="running"
            />
          </div>

          <template #footer>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-play"
                :label="t('nlp.playground.run')"
                color="primary"
                :loading="running"
                :disabled="running"
                @click="run"
              />
              <UButton
                v-if="result || error"
                icon="i-lucide-rotate-ccw"
                :label="t('demo.reset')"
                variant="soft"
                color="neutral"
                :disabled="running"
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
                {{ t('tf.loadingModel') }} {{ progressPercent }}% · {{ progressText }}
              </p>
            </div>

            <!-- 大字指标（余弦相似度） -->
            <div
              v-if="result?.headline"
              class="mb-4 flex items-baseline gap-3"
            >
              <span class="text-sm font-medium text-muted">{{ result.headline.label }}</span>
              <span class="text-3xl font-bold text-highlighted tabular-nums">{{ result.headline.value }}</span>
            </div>

            <!-- 列表项（分类 / 语言检测 / NER / 零样本 / 问答 / 完形填空） -->
            <div
              v-if="result?.items?.length"
              class="space-y-2"
            >
              <div
                v-for="(item, i) in result.items"
                :key="`${item.label}-${i}`"
                class="flex items-center justify-between gap-4"
              >
                <div class="min-w-0">
                  <span class="text-sm font-medium">{{ item.label }}</span>
                  <span
                    v-if="item.value"
                    class="text-sm text-muted ms-2 truncate"
                  >{{ item.value }}</span>
                </div>
                <div
                  v-if="item.score !== undefined"
                  class="flex items-center gap-2 flex-1 max-w-xs"
                >
                  <UProgress
                    :model-value="Math.round(item.score * 100)"
                    size="sm"
                  />
                  <span class="text-sm text-muted w-12 text-right">{{ Math.round(item.score * 100) }}%</span>
                </div>
              </div>
            </div>

            <!-- 纯文本结果（摘要） -->
            <p
              v-if="result?.text"
              class="whitespace-pre-wrap rounded-lg border border-default p-3 text-sm leading-relaxed"
            >
              {{ result.text }}
            </p>

            <!-- 附加信息行（模型 / 耗时） -->
            <dl
              v-if="result?.info?.length"
              class="mt-4 space-y-1.5"
            >
              <div
                v-for="(row, i) in result.info"
                :key="`${row.label}-${i}`"
                class="flex items-baseline gap-3 text-sm"
              >
                <dt class="w-24 shrink-0 truncate text-muted">
                  {{ row.label }}
                </dt>
                <dd class="min-w-0 break-words tabular-nums text-highlighted">
                  {{ row.value }}
                </dd>
              </div>
            </dl>

            <p
              v-if="!result && !error"
              class="text-sm text-muted"
            >
              {{ t('nlp.playground.noResult') }}
            </p>
          </template>
        </UCard>
      </ToolSidebar>
    </div>
  </UContainer>
</template>
