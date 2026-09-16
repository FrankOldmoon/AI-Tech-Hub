/**
 * Transformers.js 文本引擎：情感 / NER / 零样本 / 摘要 / 问答 / 完形填空（6 个工具）。
 *
 * 搬移来源（重构计划 §4.3）：
 * - utils/transformers.ts 的 transformersTextTasks（ner / zero-shot / summarization / qa / fill-mask 共 5 项）
 *   + components/TransformersTextRunner.vue 的执行逻辑；
 * - 情感分类为本次**新增**（计划 §2.2：text-classifier 能力页的第二实现）。
 *
 * 为什么这层只是 adapter：每个任务的 inputs / buildArgs / callOptions / parseItems / parseText / examples
 * **直接复用 transformersTextTasks 的原配置**，`run` 只做「按 device 建 pipeline（按 task|model|device 缓存）
 * → 调 buildArgs / callOptions → 结果走 parseItems 或 parseText」。行为等价性因此由「复用原配置」保证，
 * 而不是靠人肉搬运解析逻辑（硬性规则 3）。唯一的例外是情感与嵌入，它们在源注册表里没有条目。
 *
 * 与源实现有意为之的两处差异（其余逐项等价）：
 * 1. **WebGPU 失败回退 WASM**：源 TransformersTextRunner.vue 是直接报错，计划 §4.3 明确要求回退，
 *    且同族的 audio-engines/transformers.ts 也是这个处理，故照办（对用户是「更晚失败」，不是行为改向）。
 * 2. **pipeline 缓存在模块级**：源 Runner 是组件级单例（随页面挂载/卸载），注册表是长生命周期模块，
 *    故按 `${task}|${model}|${device}` 建键复用；创建失败不留缓存，否则一次网络失败会永久卡死。
 *
 * 文本嵌入（text-embedder）**不在本文件**：它的源实现其实是 MediaPipe
 * （text-embedder.vue 用 @mediapipe/tasks-text 的 TextEmbedder + universal_sentence_encoder.tflite），
 * 故按引擎归属搬到 nlp-engines/mediapipe.ts（engine: 'mediapipe'）；模型 id、L2/量化选项、
 * 余弦相似度调用在那里照搬源页面（硬性规则 2），本文件不再声明任何 MediaPipe 依赖。
 */
import type { LocalizedParamSpec, LocalizedText } from '~/utils/localized'
import type { NlpPageSlug, NlpResultItem, NlpTool, NlpToolContext, NlpToolResult } from '~/utils/nlp-tools'
import type { TransformersTextTaskConfig } from '~/utils/transformers'
import { parseDownloadProgress } from '~/utils/audio-progress'
import { preferredDevice, setupTransformersEnv, transformersModels, transformersTextTasks } from '~/utils/transformers'

type PipelineFn = (...args: unknown[]) => Promise<unknown>
type PipelineFactory = (task: string, model: string, options: Record<string, unknown>) => Promise<PipelineFn>

/** 引擎页侧栏的任务族分组（i18n key 由 nlp-tools 统一声明，这里只允许用这几个） */
type TaskFamily = 'classify' | 'extract' | 'summarize' | 'answer' | 'fill' | 'embed'

// ===== pipeline 生命周期：建一次、按 key 复用 =====

const pipelineCache = new Map<string, Promise<PipelineFn>>()

/** 首次加载探测出的设备；WebGPU 起不来后固定为 wasm（源 Runner 的 device 回退语义） */
let activeDevice: 'webgpu' | 'wasm' | null = null

/**
 * 取（必要时创建）指定 task|model 的 pipeline。
 * 设备探测延到首次调用：本模块在 SSR 阶段也会被 import，那时没有 navigator。
 */
function loadPipeline(task: string, model: string, ctx: NlpToolContext): Promise<PipelineFn> {
  const device = activeDevice ?? preferredDevice()
  const key = `${task}|${model}|${device}`
  const hit = pipelineCache.get(key)
  if (hit) return hit
  const p = createPipeline(task, model, device, ctx).catch((e: unknown) => {
    // 失败不留缓存：注册表是模块级长生命周期，否则一次失败会永久卡死（源 Runner 随组件卸载自然作废）
    pipelineCache.delete(key)
    // WebGPU 失败时改用 WASM 重建；已是 wasm 还失败说明模型本身加载不了，抛给 playground 展示
    if (device !== 'webgpu') throw e
    activeDevice = 'wasm'
    return loadPipeline(task, model, ctx)
  })
  pipelineCache.set(key, p)
  return p
}

async function createPipeline(
  task: string,
  model: string,
  device: 'webgpu' | 'wasm',
  ctx: NlpToolContext
): Promise<PipelineFn> {
  await setupTransformersEnv()
  const { pipeline } = await import('@huggingface/transformers')
  // 下载进度样板统一走 parseDownloadProgress；文案由 playground 渲染
  const onProgress = (raw: unknown) => {
    const parsed = parseDownloadProgress(raw)
    if (parsed) ctx.onProgress?.(parsed)
  }
  // dtype 与源 Runner 一致：q8 量化
  const options = { device, dtype: 'q8' as const, progress_callback: onProgress }
  return (pipeline as unknown as PipelineFactory)(task, model, options)
}

/**
 * 跑一次文本任务：源 Runner 的 run() 去掉 UI 部分（loading / error / result ref）。
 * 校验与报错归 playground（源 Runner 的「必填校验 + humanError」在 AudioPlayground 里也是这一层做的）。
 */
async function runTask(config: TransformersTextTaskConfig, ctx: NlpToolContext): Promise<NlpToolResult> {
  const pipe = await loadPipeline(config.task, config.model, ctx)
  if (ctx.isCancelled?.()) return {}
  const args = config.buildArgs(ctx.values)
  // 源 Runner 无论有无 callOptions 都把选项对象作为最后一个位置参数传入（没有时是空对象）
  const options = config.callOptions ? config.callOptions(ctx.values, ctx.params) : {}
  const raw = await pipe(...args, options)
  if (ctx.isCancelled?.()) return {}
  // 解析优先级与源页面模板一致：有 parseItems 走列表，否则走 parseText
  if (config.parseItems) return { items: config.parseItems(raw) }
  if (config.parseText) return { text: config.parseText(raw) }
  return {}
}

// ===== 参数文案：工具层不能用 useI18n，故内联与 zh/en 语言包逐条对应的译文 =====

/** i18n key → 内联双语文案（硬性规则 4：label 只能内联，key 不允许新建） */
const PARAM_LABELS: Record<string, LocalizedText> = {
  'params.topK': { zh: '返回数量', en: 'Top K' },
  'tf.multiLabel': { zh: '多标签', en: 'Multi-label' },
  'tf.multiLabelHelp': { zh: '允许文本匹配多个标签。', en: 'Allow the text to match multiple labels.' },
  'tf.maxNewTokens': { zh: '最大生成长度', en: 'Max new tokens' },
  'tf.minLength': { zh: '最小长度', en: 'Min length' }
}

/**
 * 把源配置的 `params(t)` 适配成工具层的 LocalizedParamSpec[]。
 *
 * 做法：给 `t` 传恒等函数，源配置就会把 label/help **原样回吐成 i18n key**，再查 PARAM_LABELS 换成内联双语。
 * 这样 type / default / min / max / step 与参数顺序**全部沿用源配置**（硬性规则 2 的「默认值不能改」），
 * 只把文案本地化。源配置里没有 options（都是 slider / switch），故此处不透传 options。
 */
function localizeParams(params?: TransformersTextTaskConfig['params']): LocalizedParamSpec[] | undefined {
  if (!params) return undefined
  return params(key => key).map(s => ({
    key: s.key,
    label: PARAM_LABELS[s.label] ?? { zh: s.key, en: s.key },
    type: s.type,
    default: s.default,
    min: s.min,
    max: s.max,
    step: s.step,
    help: s.help ? PARAM_LABELS[s.help] ?? { zh: s.key, en: s.key } : undefined
  }))
}

// ===== 新增：情感分类（计划 §2.2）=====

/**
 * text-classification 输出归一化：`[{ label, score }]`。
 * 源 parseItems 用的 toItems() 是 utils/transformers.ts 的私有函数，工具侧不能引用，故在此等价重写
 * （只做「数组/单对象」归一化 + label 兜底，没有改写任何解析语义）。
 */
function parseClassification(raw: unknown): NlpResultItem[] {
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((r) => {
    const item = (r ?? {}) as { label?: string, score?: number }
    return { label: item.label || '—', score: item.score }
  })
}

/**
 * 情感二分类任务配置。形状与 transformersTextTasks 的条目一致，但**不写进**那个注册表
 * （计划只允许给它加 transformersModels.sentiment 一个键，不动既有条目），所以放在引擎侧。
 * 输入框 key 与样例沿用 text-classifier 页既有例句（samples.exSentimentPos / exSentimentNeg）。
 */
const sentimentConfig: TransformersTextTaskConfig = {
  task: 'text-classification',
  model: transformersModels.sentiment,
  inputs: [
    {
      key: 'text',
      labelKey: 'tf.inputText',
      type: 'textarea',
      default: 'I absolutely love this new feature, it works perfectly and saves me so much time!'
    }
  ],
  buildArgs: v => [v.text],
  parseItems: parseClassification,
  examples: [
    {
      labelKey: 'samples.exSentimentPos',
      values: { text: 'I absolutely love this new feature, it works perfectly and saves me so much time!' }
    },
    {
      labelKey: 'samples.exSentimentNeg',
      values: { text: 'This was the worst experience ever, I am extremely disappointed with the service.' }
    }
  ]
}

// ===== 其余 6 个任务：同一套 run，只是配置与侧栏归属不同 =====

interface TaskToolSpec {
  id: string
  /** 能力页 slug（引擎页固定挂到 transformers） */
  page: NlpPageSlug
  /** 任务族：引擎页侧栏的分组 */
  family: TaskFamily
  name: LocalizedText
  description: LocalizedText
  config: TransformersTextTaskConfig
}

/** 由既有任务配置生成工具：数据全复用，只有身份与分组是新的 */
function createTool(spec: TaskToolSpec): NlpTool {
  const familyKey = `nlp.sections.${spec.family}`
  return {
    id: spec.id,
    pages: [spec.page, 'transformers'],
    engine: 'transformers',
    // 与 nlp-tools.ts 的注释一致：能力页写引擎名、引擎页写任务族
    section: { [spec.page]: 'nlp.sections.transformers', 'transformers': familyKey, '*': familyKey },
    name: spec.name,
    description: spec.description,
    inputs: spec.config.inputs,
    params: localizeParams(spec.config.params),
    examples: spec.config.examples,
    run: ctx => runTask(spec.config, ctx)
  }
}

/** 缺键说明源注册表被改过：直接抛错比静默拿 undefined 去建 pipeline 更容易定位 */
function taskConfig(key: string): TransformersTextTaskConfig {
  const cfg = transformersTextTasks[key]
  if (!cfg) throw new Error(`unknown transformers text task: ${key}`)
  return cfg
}

export const transformersNlpTools: NlpTool[] = [
  createTool({
    id: 'transformers-sentiment',
    page: 'text-classifier',
    family: 'classify',
    name: { zh: '情感分类（SST-2）', en: 'Sentiment Analysis (SST-2)' },
    description: {
      zh: 'distilbert 情感二分类，只输出 POSITIVE / NEGATIVE；标签空间与 MediaPipe 文本分类不同，两引擎结果不可直接比较（首次使用需下载模型）。',
      en: 'DistilBERT sentiment (SST-2) outputs only POSITIVE / NEGATIVE; its label space differs from MediaPipe text classification, so the two engines are not directly comparable (first run downloads the model).'
    },
    config: sentimentConfig
  }),
  createTool({
    id: 'transformers-ner',
    page: 'ner',
    family: 'extract',
    name: { zh: '命名实体识别 (NER)', en: 'Named Entity Recognition (NER)' },
    description: {
      zh: '识别文本中的人名、地名、机构等实体，给出实体类型与置信度（首次使用需下载模型）。',
      en: 'Tag people, places and organizations in text with entity type and confidence (first run downloads the model).'
    },
    config: taskConfig('ner')
  }),
  createTool({
    id: 'transformers-zero-shot',
    page: 'zero-shot',
    family: 'extract',
    name: { zh: '零样本文本分类', en: 'Zero-shot Classification' },
    description: {
      zh: '用自定义候选标签对文本分类，无需训练（首次使用需下载模型）。',
      en: 'Classify text against custom candidate labels without training (first run downloads the model).'
    },
    config: taskConfig('zero-shot')
  }),
  createTool({
    id: 'transformers-summarization',
    page: 'summarization',
    family: 'summarize',
    name: { zh: '文本摘要', en: 'Summarization' },
    description: {
      zh: '把长文压缩成要点，可调最小长度与最大生成长度（首次使用需下载模型）。',
      en: 'Condense long text into key points, with min length and max new tokens controls (first run downloads the model).'
    },
    config: taskConfig('summarization')
  }),
  createTool({
    id: 'transformers-qa',
    page: 'qa',
    family: 'answer',
    name: { zh: '问答抽取', en: 'Question Answering' },
    description: {
      zh: '基于给定上下文提问，模型从上下文中抽取答案片段（首次使用需下载模型）。',
      en: 'Ask a question about a context; the model extracts the answer span (first run downloads the model).'
    },
    config: taskConfig('qa')
  }),
  createTool({
    id: 'transformers-fill-mask',
    page: 'fill-mask',
    family: 'fill',
    name: { zh: '完形填空', en: 'Fill-Mask' },
    description: {
      zh: '输入含 [MASK] 的句子，预测最可能填入的词（首次使用需下载模型）。',
      en: 'Type a sentence with [MASK]; the model predicts the most likely token (first run downloads the model).'
    },
    config: taskConfig('fill-mask')
  })
]
