/**
 * MediaPipe Tasks Text 引擎（文本分类 / 语言检测 / 文本嵌入）。
 *
 * 声明式配置不在这里重写：`utils/mediapipe-text.ts` 的 `textTasks` 仍是「怎么建任务实例、调哪个方法」
 * 的唯一来源（§4 规则 3），本模块只补 `NlpTool` 需要的 pages / name / section，并把
 * `MediaTextRunner.vue` 的执行逻辑（懒加载 wasm 文件集 → 建实例并缓存 → 同步调用 → 归一化结果）搬进 `run`。
 *
 * 文本嵌入是例外：它在 `utils/mediapipe-text.ts` 里没有条目（`textTasks` 只描述 classify / detect 两种
 * 同步方法），源实现是 `pages/nlp/text-embedder.vue` 的 TextEmbedder + cosineSimilarity，
 * 故「建实例（按 l2Normalize / quantize 缓存）→ embed → 余弦相似度」照搬源页面写在本文件。
 * 它原先落在 nlp-engines/transformers.ts，但实现本就是 MediaPipe tasks-text，按引擎归属移到这里。
 *
 * 与原 Runner 的差异只有错误通道：原 Runner 把 `humanError(e, t)` 写进组件状态，
 * 这里改为抛给 playground（与语音/视觉引擎一致），只在 `Event` 上按语言给人话 ——
 * MediaPipe 拉模型失败时抛的正是 Event（没有 message），直接给 humanError 会显示 "[object Event]"。
 */
import type { LocalizedParamSpec } from '~/utils/localized'
import type { NlpInputSpec, NlpTool, NlpToolContext, NlpToolResult } from '~/utils/nlp-tools'
import type { TextTaskConfig } from '~/utils/mediapipe-text'
import type { Embedding, LanguageDetector, LanguageDetectorResult, TextClassifier, TextClassifierResult, TextEmbedder } from '@mediapipe/tasks-text'
import { mediapipeModels, mediapipeWasm } from '~/utils/mediapipe'

/** 本引擎的两个任务 slug，与 utils/mediapipe-text.ts 的 textTasks 键一一对应 */
type TextSlug = 'text-classifier' | 'language-detector'

/** 两种任务实例的并集（原 Runner 的 TextTask） */
type TextTask = TextClassifier | LanguageDetector

/**
 * 执行形态：`TextTaskConfig.method` 决定调 classify 还是 detect。
 * 用交叉类型而非 any，是为了拿到库里 classify / detect 的真实返回类型（分类与语言检测结果形状不同）。
 */
type RunnableTask = TextTask & {
  classify?: (text: string) => TextClassifierResult
  detect?: (text: string) => LanguageDetectorResult
}

/** wasm 文件集类型：库未导出该声明，从 textTasks.create 的参数推导（与原 Runner 同一手法） */
type WasmFileset = Parameters<TextTaskConfig['create']>[0]

/** 已就绪的任务实例 + 其配置；按 slug 缓存，与原 Runner 的「建一次、反复推理」等价 */
const ready = new Map<string, { task: TextTask, cfg: TextTaskConfig }>()

async function ensureTask(slug: TextSlug, lang: 'zh' | 'en'): Promise<{ task: TextTask, cfg: TextTaskConfig }> {
  const cached = ready.get(slug)
  if (cached) return cached
  try {
    // 动态 import：'@mediapipe/tasks-text' 与 textTasks 都只在客户端加载（源文件注释也声明了 SSR 不加载该库）
    const { FilesetResolver } = await import('@mediapipe/tasks-text')
    const { textTasks } = await import('~/utils/mediapipe-text')
    const cfg = textTasks[slug]
    if (!cfg) throw new Error(`MediaPipe text task not found: ${slug}`)
    const fileset: WasmFileset = await FilesetResolver.forTextTasks(mediapipeWasm.text)
    const task = await cfg.create(fileset)
    const entry = { task, cfg }
    ready.set(slug, entry)
    return entry
  } catch (e) {
    if (e instanceof Event) {
      const msg = lang === 'zh'
        ? '模型/WASM 加载失败，请检查网络或稍后重试'
        : 'Failed to load the model/WASM. Check your network and retry.'
      throw new Error(msg, { cause: e })
    }
    throw e
  }
}

/**
 * 一次推理。
 * 空输入直接返回空对象且不改动已有结果 —— 原 Runner 是 `if (!input.value.trim()) return`（按钮同时 disabled）。
 */
async function runTask(slug: TextSlug, ctx: NlpToolContext): Promise<NlpToolResult> {
  const text = ctx.values.text ?? ''
  if (!text.trim()) return {}
  const { task, cfg } = await ensureTask(slug, ctx.lang)
  const impl = task as RunnableTask
  // 模型名沿用 textTasks.model 的教学向字符串（原 Runner 顶部模型卡展示的就是它）
  const info = cfg.model ? [{ label: ctx.lang === 'zh' ? '模型' : 'Model', value: cfg.model }] : []
  if (cfg.method === 'classify') {
    // 原 #result 模板：classifications[0].categories → categoryName + score（分数即 0..1 概率）
    const categories = impl.classify?.(text)?.classifications[0]?.categories ?? []
    return { items: categories.map(c => ({ label: c.categoryName, score: c.score })), info }
  }
  // 原 #result 模板：languages → languageCode + probability
  const languages = impl.detect?.(text)?.languages ?? []
  return { items: languages.map(l => ({ label: l.languageCode, score: l.probability })), info }
}

/**
 * 两个工具共用同一个输入声明：MediaPipe 文本任务都是单输入同步推理（原 Runner 只有一个 textarea）。
 * 用函数返回新数组，避免两个工具共享同一个可变数组实例。
 * 不给 placeholderKey：tf.* 里没有这两个任务专用的占位文案（§4.2 明确要求省略），
 * 也不给 default：原 Runner 的默认值来自 i18n key `samples.textDefault`，而 NlpInputSpec.default 是纯字符串，
 * 硬编码只会给 en 用户塞中文，故交给 playground 的空状态 + examples 承担。
 */
function textInputs(): NlpInputSpec[] {
  return [{ key: 'text', labelKey: 'tf.inputText', type: 'textarea' }]
}

// ===== 文本嵌入（搬自 pages/nlp/text-embedder.vue）=====

/** 教学向模型名，沿用 utils/mediapipe-text.ts 里 `model` 字段的写法 */
const EMBEDDER_MODEL = 'universal_sentence_encoder.tflite · MediaPipe Text Embedder'

interface EmbedderBox {
  key: string
  instance: TextEmbedder
  cosine: (u: Embedding, v: Embedding) => number
}

/**
 * 嵌入器实例缓存。源页面用 `watch(params)` 在 l2Normalize / quantize 变更时 close + 重建
 * （这两个选项只能在 createFromOptions 时指定），模块级缓存同理按这两个选项建键。
 */
let embedderCache: EmbedderBox | null = null

async function ensureEmbedder(ctx: NlpToolContext): Promise<EmbedderBox> {
  const l2Normalize = Boolean(ctx.params.l2Normalize)
  const quantize = Boolean(ctx.params.quantize)
  const key = `${l2Normalize}|${quantize}`
  if (embedderCache && embedderCache.key === key) return embedderCache
  const { FilesetResolver, TextEmbedder: Embedder } = await import('@mediapipe/tasks-text')
  const wasm = await FilesetResolver.forTextTasks(mediapipeWasm.text)
  embedderCache?.instance.close()
  const instance = await Embedder.createFromOptions(wasm, {
    baseOptions: { modelAssetPath: mediapipeModels.textEmbedder },
    l2Normalize,
    quantize
  })
  // 余弦相似度是 TextEmbedder 的静态方法：包成闭包，避免依赖静态方法的 this
  embedderCache = { key, instance, cosine: (u, v) => Embedder.cosineSimilarity(u, v) }
  return embedderCache
}

/** 源页面 compute()：两段文本各 embed 一次，再算余弦相似度并展示推理耗时 */
async function runEmbedder(ctx: NlpToolContext): Promise<NlpToolResult> {
  const text1 = ctx.values.text1 ?? ''
  const text2 = ctx.values.text2 ?? ''
  // 源页面任一输入为空时直接不跑（按钮同时置灰）；playground 会先做非空校验，这里只兜底
  if (!text1.trim() || !text2.trim()) return {}
  const box = await ensureEmbedder(ctx)
  if (ctx.isCancelled?.()) return {}
  const ts = performance.now()
  const r1 = box.instance.embed(text1)
  const r2 = box.instance.embed(text2)
  // noUncheckedIndexedAccess：取不到首个 head 的嵌入就当作无结果（源页面直接下标访问）
  const [e1] = r1.embeddings
  const [e2] = r2.embeddings
  if (!e1 || !e2) return {}
  const similarity = box.cosine(e1, e2)
  const ms = Math.round(performance.now() - ts)
  return {
    headline: {
      label: ctx.lang === 'zh' ? '余弦相似度' : 'Cosine similarity',
      value: similarity.toFixed(4)
    },
    info: [
      { label: ctx.lang === 'zh' ? '模型' : 'Model', value: EMBEDDER_MODEL },
      { label: ctx.lang === 'zh' ? '耗时' : 'Time', value: `${ms} ms` }
    ]
  }
}

const embedderParams: LocalizedParamSpec[] = [
  {
    key: 'l2Normalize',
    label: { zh: 'L2 归一化', en: 'L2 normalize' },
    type: 'switch',
    default: false,
    help: { zh: '对嵌入向量做 L2 归一化，常用于余弦相似度。', en: 'L2-normalize embeddings, typical for cosine similarity.' }
  },
  {
    key: 'quantize',
    label: { zh: '量化', en: 'Quantize' },
    type: 'switch',
    default: false,
    help: { zh: '将嵌入向量量化为字节，降低内存占用。', en: 'Quantize embeddings to bytes to reduce memory.' }
  }
]

export const mediapipeTextTools: NlpTool[] = [
  {
    id: 'mediapipe-text-classify',
    pages: ['text-classifier', 'mediapipe-text'],
    name: { zh: '文本分类', en: 'Text Classification' },
    description: {
      zh: 'MediaPipe Bert 文本分类器本地推理，按模型自带的标签空间给出各类别得分。它的标签空间与 Transformers 情感二分类不同，两边分数不可直接比较。',
      en: 'The MediaPipe Bert text classifier runs locally and scores the labels built into the model. Its label space differs from the Transformers sentiment head, so the two scores are not directly comparable.'
    },
    engine: 'mediapipe',
    section: {
      'mediapipe-text': 'nlp.sections.classify',
      'text-classifier': 'nlp.sections.mediapipe',
      '*': 'nlp.sections.classify'
    },
    inputs: textInputs(),
    // 例句取自原 nlp/[slug].vue 的 textSamples（分类分支），labelKey 原样复用
    examples: [
      { labelKey: 'samples.exSentimentPos', values: { text: 'I absolutely love this new feature, it works perfectly and saves me so much time!' } },
      { labelKey: 'samples.exSentimentNeg', values: { text: 'This was the worst experience ever, I am extremely disappointed with the service.' } },
      { labelKey: 'samples.exTopicNews', values: { text: 'The government announced new policies to boost the economy and create more jobs.' } }
    ],
    run: ctx => runTask('text-classifier', ctx)
  },
  {
    id: 'mediapipe-language-detect',
    pages: ['language-detector', 'mediapipe-text'],
    name: { zh: '语言检测', en: 'Language Detection' },
    description: {
      zh: 'MediaPipe Language Detector 识别输入文本的语言，按概率给出候选语言代码（如 en / zh / ja）。',
      en: 'The MediaPipe Language Detector identifies the language of the input text and ranks candidate language codes such as en / zh / ja by probability.'
    },
    engine: 'mediapipe',
    section: {
      'mediapipe-text': 'nlp.sections.langDetect',
      'language-detector': 'nlp.sections.mediapipe',
      '*': 'nlp.sections.langDetect'
    },
    inputs: textInputs(),
    // 例句取自原 nlp/[slug].vue 的 textSamples（detect 分支），labelKey 用 nlp.examples.*（四种语言名）
    examples: [
      { labelKey: 'nlp.examples.en', values: { text: 'Artificial intelligence is changing the way we live and work every single day.' } },
      { labelKey: 'nlp.examples.zh', values: { text: '人工智能正在以惊人的速度改变我们的生活方式。' } },
      { labelKey: 'nlp.examples.ja', values: { text: '人工知能は私たちの生活を急速に変えています。' } },
      { labelKey: 'nlp.examples.fr', values: { text: 'L\'intelligence artificielle transforme rapidement notre quotidien.' } }
    ],
    run: ctx => runTask('language-detector', ctx)
  },
  {
    // id 沿用搬移前的字面量：变的是引擎归属，工具身份（含 ?tool= 深链）不变
    id: 'transformers-embedder',
    pages: ['text-embedder', 'mediapipe-text'],
    name: { zh: '文本嵌入（余弦相似度）', en: 'Text Embedding (Cosine Similarity)' },
    description: {
      zh: '两段文本各自嵌入为向量并计算余弦相似度，越接近 1 越相关（MediaPipe Universal Sentence Encoder，首次使用需下载模型）。',
      en: 'Embed two texts as vectors and compare them with cosine similarity; closer to 1 means more related (MediaPipe Universal Sentence Encoder, first run downloads the model).'
    },
    engine: 'mediapipe',
    section: {
      'mediapipe-text': 'nlp.sections.embed',
      'text-embedder': 'nlp.sections.mediapipe',
      '*': 'nlp.sections.embed'
    },
    inputs: [
      { key: 'text1', labelKey: 'textEmbedder.textA', type: 'textarea' },
      { key: 'text2', labelKey: 'textEmbedder.textB', type: 'textarea' }
    ],
    params: embedderParams,
    run: runEmbedder
  }
]
